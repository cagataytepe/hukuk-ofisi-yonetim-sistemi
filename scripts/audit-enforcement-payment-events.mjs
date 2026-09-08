import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { SupabaseRepository } from "../repositories/SupabaseRepository.js";
import {
  accountDateInTimeZone,
  calculateMobileEnforcementAccount
} from "../src/calculations/enforcementAccountAdapters.js";
import {
  calculateIndependentReference,
  calculateLegacyEndDeduction,
  independentInputFromFile
} from "../tests/support/independentEnforcementReference.js";

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(line => line && !line.trim().startsWith("#") && line.includes("="))
      .map(line => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")
        ];
      })
  );
}

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function enforcementFile(file = {}) {
  return [file.record_kind, file.file_type, file.follow_type]
    .some(value => {
      const normalized = String(value || "").toLocaleLowerCase("tr-TR");
      return normalized.includes("icra") || normalized.includes("enforcement");
    });
}

function safeLegacyId(file = {}) {
  const value = String(file.display_id || file.legacy_id || "Etiketsiz icra dosyası");
  return /^[A-ZİIÇĞÖŞÜ]-?\d+$/iu.test(value) ? value : "Etiketsiz icra dosyası";
}

async function waitForJwtAcceptance(supabase) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await supabase.from("profiles").select("id").limit(1);
    if (!result.error) return;
    if (result.error.code !== "PGRST303" || attempt === 5) throw result.error;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}

function productionParity(reference, production) {
  const fields = [
    "principalOutstanding",
    "postEnforcementInterest",
    "postEnforcementInterestAccrued",
    "eligibleCostsOutstanding",
    "enforcementAttorneyFeeOutstanding",
    "collectionFeeOutstanding",
    "paymentsAppliedToFeriler",
    "paymentsAppliedToPrincipal",
    "currentDebt"
  ];
  const differences = Object.fromEntries(fields.map(field => [field, cents(production[field]) - cents(reference[field])]));
  return {
    matches: Object.values(differences).every(value => value === 0),
    differencesInCents: differences
  };
}

function categoryLabels(row) {
  const labels = [];
  if (row.paymentCount === 1) labels.push("single-payment");
  if (row.distinctPaymentDateCount >= 2) labels.push("multiple-payment-dates");
  if (row.paymentsAppliedToPrincipal > 0) labels.push("payment-reaches-principal");
  if (row.crossesStatutoryBoundary) labels.push("crosses-2026-07-31-boundary");
  if (row.fullOrHighPayment) labels.push("full-or-high-payment");
  return labels;
}

function selectAuditRows(rows) {
  const selected = [];
  const add = row => {
    if (row && !selected.includes(row)) selected.push(row);
  };
  add(rows.find(row => row.categories.includes("single-payment")));
  add(rows.find(row => row.categories.includes("multiple-payment-dates")));
  add(rows.find(row => row.categories.includes("payment-reaches-principal")));
  add(rows.find(row => row.categories.includes("crosses-2026-07-31-boundary")));
  add(rows.find(row => row.categories.includes("full-or-high-payment")));
  rows.forEach(row => {
    if (selected.length < 5) add(row);
  });
  return selected.slice(0, Math.max(5, selected.length));
}

const env = { ...readEnv(path.resolve(".env.test.local")), ...process.env };
const configSource = fs.readFileSync(path.resolve("outputs/supabase-config.js"), "utf8");
const url = configSource.match(/url:\s*["']([^"']+)/)?.[1];
const publishableKey = configSource.match(/publishableKey:\s*["']([^"']+)/)?.[1];
const accountDate = argument("account-date", accountDateInTimeZone());
const outputPath = path.resolve(argument("output", "test-artifacts/enforcement-payment-audit.json"));

if (!/^\d{4}-\d{2}-\d{2}$/.test(accountDate)) throw new Error("--account-date YYYY-MM-DD biçiminde olmalıdır.");
if (!url || !publishableKey || !env.E2E_USER_EMAIL || !env.E2E_USER_PASSWORD) {
  throw new Error("Read-only audit için E2E Supabase bağlantı bilgileri eksik.");
}

const supabase = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const { error: loginError } = await supabase.auth.signInWithPassword({
  email: env.E2E_USER_EMAIL,
  password: env.E2E_USER_PASSWORD
});
if (loginError) throw loginError;

try {
  await waitForJwtAcceptance(supabase);
  const repository = new SupabaseRepository(supabase);
  const [files, collections, tools, deletedCollectionsResult, enforcementAccountsResult] = await Promise.all([
    repository.getFiles(),
    repository.getCollections(),
    repository.getCalculationTools(),
    supabase.from("collections").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    supabase.from("enforcement_accounts").select("file_id,expenses,account_date").is("deleted_at", null)
  ]);
  if (deletedCollectionsResult.error) throw deletedCollectionsResult.error;
  if (enforcementAccountsResult.error) throw enforcementAccountsResult.error;

  const paymentsByFile = new Map();
  for (const collection of collections) {
    if (!collection.file_id) continue;
    if (!paymentsByFile.has(collection.file_id)) paymentsByFile.set(collection.file_id, []);
    paymentsByFile.get(collection.file_id).push(collection);
  }

  const audited = files
    .filter(enforcementFile)
    .map(file => {
      const paymentEvents = paymentsByFile.get(file.id) || [];
      if (!paymentEvents.length) return null;
      const production = calculateMobileEnforcementAccount({ ...file, payment_events: paymentEvents }, tools, accountDate);
      if (!production) return null;
      const independentInput = independentInputFromFile(file, tools, accountDate, paymentEvents);
      const reference = calculateIndependentReference(independentInput);
      const legacy = calculateLegacyEndDeduction(independentInput);
      const distinctDates = [...new Set(paymentEvents.map(payment => payment.collection_date))];
      const parity = productionParity(reference, production);
      const row = {
        legacyId: safeLegacyId(file),
        accountDate,
        enforcementStart: independentInput.interestStart,
        startingPrincipal: money(independentInput.principal),
        interestType: independentInput.interestType || "Belirtilmedi",
        paymentCount: paymentEvents.length,
        distinctPaymentDateCount: distinctDates.length,
        paymentDates: distinctDates.sort(),
        totalPayments: money(production.totalPayments),
        paymentsAppliedToPrincipal: money(production.paymentsAppliedToPrincipal),
        currentDebt: money(production.currentDebt),
        crossesStatutoryBoundary: independentInput.interestType === "Adi Kanuni Faiz"
          && independentInput.interestStart <= "2026-07-30"
          && accountDate >= "2026-07-31",
        fullOrHighPayment: production.currentDebt <= 0.005
          || production.totalPayments >= independentInput.principal * 0.5,
        referenceParity: parity,
        legacyComparison: {
          legacyResult: money(legacy.currentDebt),
          eventBasedResult: money(production.currentDebt),
          difference: money(legacy.currentDebt - production.currentDebt)
        },
        paymentLedger: production.paymentLedger.map(entry => ({
          paymentDate: entry.paymentDate,
          paymentAmount: money(entry.paymentAmount),
          principalBeforePayment: money(entry.principalBeforePayment),
          interestAccruedBeforePayment: money(entry.interestAccruedBeforePayment),
          eligibleOutstandingBeforePayment: money(entry.eligibleOutstandingBeforePayment),
          appliedToInterest: money(entry.appliedToInterest),
          appliedToCosts: money(entry.appliedToCosts),
          appliedToAttorneyFee: money(entry.appliedToAttorneyFee),
          appliedToPrincipal: money(entry.appliedToPrincipal),
          principalAfterPayment: money(entry.principalAfterPayment),
          nextPeriodInterestPrincipal: money(entry.principalAfterPayment),
          unappliedAmount: money(entry.unappliedAmount)
        }))
      };
      row.categories = categoryLabels(row);
      return row;
    })
    .filter(Boolean);

  const selected = selectAuditRows(audited);
  const preEnforcementRows = audited.filter(row => row.paymentDates.some(date => date < row.enforcementStart));
  const categoryCounts = Object.fromEntries([
    "single-payment",
    "multiple-payment-dates",
    "payment-reaches-principal",
    "crosses-2026-07-31-boundary",
    "full-or-high-payment"
  ].map(category => [category, audited.filter(row => row.categories.includes(category)).length]));
  const report = {
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    accountDate,
    productionWritePerformed: false,
    scanned: {
      activeFiles: files.length,
      activeEnforcementFiles: files.filter(enforcementFile).length,
      activeCollections: collections.length,
      enforcementFilesWithCollections: audited.length,
      softDeletedCollectionsExcludedByRepository: deletedCollectionsResult.count || 0,
      enforcementAccountRows: (enforcementAccountsResult.data || []).length
    },
    categoryCounts,
    selectedFileCount: selected.length,
    allReferenceComparisonsMatch: audited.every(row => row.referenceParity.matches),
    preEnforcementCollectionFileCount: preEnforcementRows.length,
    schemaFindings: {
      collectionEventDate: "public.collections.collection_date",
      enforcementCostStorage: "public.enforcement_accounts.expenses and files.account_info.expenses",
      enforcementCostEventDate: null,
      limitation: "Takip masrafları için ayrı bir muacceliyet/event tarihi bulunmuyor."
    },
    files: selected
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputPath,
    accountDate,
    scanned: report.scanned,
    categoryCounts,
    selectedFileCount: selected.length,
    allReferenceComparisonsMatch: report.allReferenceComparisonsMatch,
    preEnforcementCollectionFileCount: report.preEnforcementCollectionFileCount
  }, null, 2));
  if (!report.allReferenceComparisonsMatch) process.exitCode = 1;
} finally {
  await supabase.auth.signOut();
}
