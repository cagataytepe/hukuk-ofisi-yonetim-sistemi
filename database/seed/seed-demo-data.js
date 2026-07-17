import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnvFile();

const args = process.argv.slice(2);
const isBootstrap = args.includes("--bootstrap");
const forceBootstrap = args.includes("--force-bootstrap");
const inputArg = args.find(arg => !arg.startsWith("--"));
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseKey = isBootstrap ? supabaseServiceRoleKey : supabaseAnonKey;
const inputPath = inputArg || path.join(process.cwd(), "database", "seed", "localstorage-export.json");
const bootstrapMigrationKey = "localstorage-bootstrap-import";
const regularMigrationKey = "localstorage-anon-import";

const appStateStorageKey = "hukukBurosuTakipDemo.v2";
const appUsersStorageKey = "hukukBurosuKullanicilar.v1";
const rememberedSessionStorageKey = "hukukBurosuHatirlananOturum.v1";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
}

if (isBootstrap && !supabaseServiceRoleKey) {
  throw new Error("Bootstrap import requires SUPABASE_SERVICE_ROLE_KEY. Use it only locally for first setup, then remove it from .env.");
}

if (!isBootstrap && supabaseServiceRoleKey) {
  console.warn("SUPABASE_SERVICE_ROLE_KEY is present but ignored. Normal import/runtime uses only SUPABASE_ANON_KEY plus an authenticated user session.");
}

if (!fs.existsSync(inputPath)) {
  throw new Error(`LocalStorage export file not found: ${inputPath}`);
}

const supabaseOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
};

if (!isBootstrap && supabaseAccessToken) {
  supabaseOptions.global = {
    headers: { Authorization: `Bearer ${supabaseAccessToken}` }
  };
}

const supabase = createClient(supabaseUrl, supabaseKey, supabaseOptions);

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const exportedStorage = raw.localStorage || raw.settings || {};
const state = raw.data || parseStorageJson(exportedStorage[appStateStorageKey]) || raw;
const exportedUsers = raw.users || parseStorageJson(exportedStorage[appUsersStorageKey]) || [];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function parseStorageJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function numberValue(value) {
  let text = String(value ?? "").trim();
  if (!text) return 0;
  text = text.replace(/[^\d,.-]/g, "");
  if (text.includes(",") && text.lastIndexOf(",") > text.lastIndexOf(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function isEnforcementFile(file) {
  return [file.recordKind, file.fileType, file.type]
    .filter(Boolean)
    .some(value => String(value).toLocaleLowerCase("tr-TR").includes("icra"));
}

function clientParties(file) {
  if (Array.isArray(file.clientParties) && file.clientParties.length) return file.clientParties;
  if (Array.isArray(file.creditorParties) && file.creditorParties.length) {
    return file.creditorParties.map(party => ({ ...party, role: "AlacaklÄ±" }));
  }
  const name = file.clientName || file.client || file.creditor || "";
  return name ? [{ name, taxId: file.taxId || file.creditorTaxId || "", role: file.partyRole || "MÃ¼vekkil" }] : [];
}

function opponentParties(file) {
  if (Array.isArray(file.opponentParties) && file.opponentParties.length) return file.opponentParties;
  if (Array.isArray(file.debtors) && file.debtors.length) {
    return file.debtors.map(party => ({ ...party, role: "BorÃ§lu" }));
  }
  const name = file.opponentName || file.opponent || file.debtor || "";
  return name ? [{ name, taxId: file.opponentTaxId || file.debtorTaxId || "", role: "KarÅŸÄ± Taraf" }] : [];
}

function fileLegacyId(record) {
  return record.fileId || record.file || "";
}

function appSettingRows() {
  const rows = [{
    setting_key: appStateStorageKey,
    setting_value: state,
    description: "Tek HTML uygulamasinin Supabase birincil state kaydi"
  }];

  if (Array.isArray(exportedUsers) && exportedUsers.length) {
    rows.push({
      setting_key: appUsersStorageKey,
      setting_value: exportedUsers,
      description: "Tek HTML uygulamasinin kullanici kayitlari"
    });
  }

  if (exportedStorage[rememberedSessionStorageKey]) {
    rows.push({
      setting_key: rememberedSessionStorageKey,
      setting_value: parseStorageJson(exportedStorage[rememberedSessionStorageKey]),
      description: "Hatirlanan son oturum"
    });
  }

  return rows;
}

async function upsertOne(table, row, onConflict) {
  const { data, error } = await supabase
    .from(table)
    .upsert(row, { onConflict })
    .select()
    .single();

  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  return data;
}

async function upsertMany(table, rows, onConflict) {
  const filteredRows = rows.filter(Boolean);
  if (!filteredRows.length) return [];

  const { data, error } = await supabase
    .from(table)
    .upsert(filteredRows, { onConflict })
    .select();

  if (error) throw new Error(`${table} bulk upsert failed: ${error.message}`);
  return data || [];
}

async function assertBootstrapAllowed() {
  if (!isBootstrap || forceBootstrap) return;

  const { data: completedLog, error: logError } = await supabase
    .from("migration_logs")
    .select("id, finished_at")
    .eq("migration_key", bootstrapMigrationKey)
    .eq("status", "completed")
    .maybeSingle();

  if (logError) {
    throw new Error(`Bootstrap log kontrolu basarisiz: ${logError.message}`);
  }

  if (completedLog) {
    throw new Error("Bootstrap import daha once tamamlanmis. Guvenlik icin service role tekrar kullanilmadi. Gercekten yeniden calistirmaniz gerekiyorsa --force-bootstrap kullanin.");
  }
}

async function seed() {
  await assertBootstrapAllowed();

  await upsertMany("settings", appSettingRows(), "setting_key");

  const roleRows = await upsertMany("roles", [
    { legacy_id: "role-full", name: "Tam Yetkili", is_system: true },
    { legacy_id: "role-view", name: "YalnÄ±zca GÃ¶rÃ¼ntÃ¼leme", is_system: true }
  ], "name");

  const roleByName = new Map(roleRows.map(role => [role.name, role.id]));

  await upsertMany("user_permissions", ["create", "edit", "delete", "reports", "manageUsers"].map(permissionKey => ({
    role_id: roleByName.get("Tam Yetkili"),
    permission_key: permissionKey,
    allowed: true
  })), "profile_id,role_id,permission_key");

  const files = asArray(state.files || state.cases);
  const clientRows = [];
  const clientKeySet = new Set();

  files.forEach(file => {
    clientParties(file).forEach(party => {
      const name = String(party.name || "").trim();
      if (!name || clientKeySet.has(name)) return;
      clientKeySet.add(name);
      clientRows.push({
        legacy_id: `client:${name}`,
        name,
        tax_id: party.taxId || ""
      });
    });
  });

  const clients = await upsertMany("clients", clientRows, "legacy_id");
  const clientByLegacy = new Map(clients.map(client => [client.legacy_id, client]));

  const fileRows = files.map(file => {
    const enforcement = isEnforcementFile(file);
    const primaryClient = clientParties(file)[0] || {};
    const client = clientByLegacy.get(`client:${primaryClient.name}`);
    return {
      client_id: client?.id || null,
      legacy_id: file.id,
      display_id: file.id,
      record_kind: file.recordKind || (enforcement ? "Ä°cra" : "Dava"),
      file_type: file.fileType || (enforcement ? "Ä°cra DosyasÄ±" : file.type === "Ceza" ? "Ceza DosyasÄ±" : "Hukuk DosyasÄ±"),
      follow_type: file.followType || file.followUpType || null,
      file_no: file.fileNo || file.file || file.trackingNo || null,
      court_or_office: file.courtOrOffice || file.court || file.office || null,
      decision_no: file.decision || null,
      subject: file.subject || null,
      status: file.status || "AÃ§Ä±k",
      opening_date: normalizeDate(file.openingDate || file.followUpDate),
      responsible_name: file.responsibleLawyer || file.lawyer || null,
      client_name: file.clientName || file.client || file.creditor || null,
      opponent_name: file.opponentName || file.opponent || file.debtor || null,
      description: file.description || null,
      account_info: file.accountInfo || {},
      instrument_info: file.instrumentInfo || {},
      metadata: { source: "localStorage", legacy: file }
    };
  }).filter(row => row.legacy_id);

  const insertedFiles = await upsertMany("files", fileRows, "legacy_id");
  const fileByLegacy = new Map(insertedFiles.map(file => [file.legacy_id, file]));

  const fileParties = [];
  files.forEach(file => {
    const dbFile = fileByLegacy.get(file.id);
    if (!dbFile) return;
    const enforcement = isEnforcementFile(file);
    clientParties(file).forEach((party, index) => fileParties.push({
      file_id: dbFile.id,
      client_id: clientByLegacy.get(`client:${party.name}`)?.id || null,
      legacy_id: `${file.id}:client:${index + 1}`,
      party_type: "client",
      side: enforcement ? "creditor" : "client",
      role: party.role || file.partyRole || "",
      name: party.name || "",
      tax_id: party.taxId || "",
      is_primary: index === 0
    }));
    opponentParties(file).forEach((party, index) => fileParties.push({
      file_id: dbFile.id,
      legacy_id: `${file.id}:opponent:${index + 1}`,
      party_type: "opponent",
      side: enforcement ? "debtor" : "opponent",
      role: party.role || "",
      name: party.name || "",
      tax_id: party.taxId || "",
      is_primary: index === 0
    }));
  });
  await upsertMany("file_parties", fileParties, "legacy_id");

  await upsertMany("hearings", asArray(state.hearings).map(row => ({
    file_id: fileByLegacy.get(fileLegacyId(row))?.id,
    legacy_id: row.id,
    court: row.court || null,
    case_file_no: row.caseFile || null,
    hearing_date: normalizeDate(row.date),
    hearing_time: row.time || null,
    client_name: row.client || null,
    party_role: row.partyRole || null,
    excuse_type: row.excuseType || null,
    attendee_name: row.person || null,
    note: row.note || null,
    outcome: row.outcome || {}
  })).filter(row => row.file_id && row.hearing_date), "legacy_id");

  await upsertMany("deadlines", asArray(state.deadlines).map(row => ({
    file_id: fileByLegacy.get(fileLegacyId(row))?.id,
    legacy_id: row.id,
    title: row.task || row.title || "",
    description: row.description || null,
    responsible_name: row.lawyer || row.responsible || null,
    start_date: normalizeDate(row.start),
    due_date: normalizeDate(row.due),
    status: row.status || "Aktif",
    completed_at: row.completedAt || null,
    completed_late: Boolean(row.completedLate)
  })).filter(row => row.file_id && row.title && row.due_date), "legacy_id");

  await upsertMany("tasks", asArray(state.tasks).map(row => ({
    file_id: row.fileId ? fileByLegacy.get(row.fileId)?.id || null : null,
    legacy_id: row.id,
    task_type: row.taskType || (row.fileId ? "file" : "office"),
    title: row.title || "",
    description: row.description || null,
    responsible_name: row.responsible || null,
    due_date: normalizeDate(row.dueDate),
    status: row.status || "Aktif",
    completed_at: row.completedAt || null
  })).filter(row => row.title), "legacy_id");

  await upsertMany("documents", asArray(state.documents).map((row, index) => ({
    file_id: row.fileId ? fileByLegacy.get(row.fileId)?.id || null : null,
    legacy_id: row.id || `document:${index + 1}`,
    name: row.name || row.fileName || "Belge",
    category: row.category || null,
    document_date: normalizeDate(row.date),
    description: row.description || null,
    file_name: row.fileName || null,
    metadata: { source: "localStorage", hasInlineFileData: Boolean(row.fileData), legacy: row }
  })), "legacy_id");

  const paymentPlans = asArray(state.paymentPlans);
  const insertedPaymentPlans = await upsertMany("payment_plans", paymentPlans.map(row => ({
    file_id: row.fileId ? fileByLegacy.get(row.fileId)?.id || null : null,
    legacy_id: row.id,
    plan_type: row.type || "Ã–deme PlanÄ±",
    party_name: row.partyName || "",
    agreement_amount: numberValue(row.agreementAmount),
    initial_payment: numberValue(row.initialPayment),
    installment_count: Number(row.installmentCount) || asArray(row.installments).length || 1,
    first_due_date: normalizeDate(row.firstDueDate),
    currency: row.currency || "TRY",
    status: row.status || "Aktif",
    description: row.description || null,
    metadata: { source: "localStorage", legacy: row }
  })).filter(row => row.legacy_id && row.party_name), "legacy_id");
  const paymentPlanByLegacy = new Map(insertedPaymentPlans.map(row => [row.legacy_id, row]));

  const paymentInstallmentRows = paymentPlans.flatMap(plan => {
    const dbPlan = paymentPlanByLegacy.get(plan.id);
    if (!dbPlan) return [];
    return asArray(plan.installments).map((installment, index) => ({
      payment_plan_id: dbPlan.id,
      legacy_id: installment.id || `${plan.id}:${index + 1}`,
      sequence_no: Number(installment.sequenceNo) || index + 1,
      due_date: normalizeDate(installment.dueDate || installment.date),
      amount: numberValue(installment.amount),
      paid_amount: numberValue(installment.paidAmount),
      paid_date: normalizeDate(installment.paidDate),
      status: installment.status || "Bekliyor",
      payments: asArray(installment.payments),
      metadata: { source: "localStorage", legacy: installment }
    })).filter(row => row.due_date);
  });
  const insertedInstallments = await upsertMany("payment_installments", paymentInstallmentRows, "payment_plan_id,sequence_no");
  const installmentByLegacy = new Map(insertedInstallments.map(row => [row.legacy_id, row]));

  await upsertMany("collections", asArray(state.collections).map(row => ({
    file_id: row.fileId ? fileByLegacy.get(row.fileId)?.id || null : null,
    payment_plan_id: row.paymentPlanId ? paymentPlanByLegacy.get(row.paymentPlanId)?.id || null : null,
    payment_installment_id: row.installmentId ? installmentByLegacy.get(row.installmentId)?.id || null : null,
    legacy_id: row.id,
    amount: numberValue(row.amount),
    currency: row.currency || "TRY",
    collection_date: normalizeDate(row.date || row.collectionDate || row.createdAt) || new Date().toISOString().slice(0, 10),
    payment_kind: row.paymentKind || null,
    description: row.description || null,
    metadata: { source: "localStorage", legacy: row }
  })).filter(row => row.legacy_id), "legacy_id");

  await upsertMany("interest_rates", asArray(state.calculationSettings?.interestRates).map(row => ({
    legacy_id: row.id,
    interest_type: row.type || "Faiz",
    from_date: normalizeDate(row.from || row.fromDate),
    to_date: normalizeDate(row.to || row.toDate),
    rate: numberValue(row.rate),
    source: row.source || null,
    metadata: { source: "localStorage", legacy: row }
  })).filter(row => row.legacy_id && row.from_date), "legacy_id");

  const attorneyFeeTariffs = asArray(state.calculationSettings?.attorneyFeeTariffs);
  const insertedTariffs = await upsertMany("attorney_fee_tariffs", attorneyFeeTariffs.map(row => ({
    legacy_id: row.id,
    name: row.name || "Vekalet Ãœcreti Tarifesi",
    from_date: normalizeDate(row.from || row.fromDate),
    to_date: normalizeDate(row.to || row.toDate),
    regular_minimum: numberValue(row.regularMinimum || row.minimum || row.minFee),
    eviction_minimum: numberValue(row.evictionMinimum || row.evictionMinFee),
    metadata: { source: "localStorage", legacy: row }
  })).filter(row => row.legacy_id && row.from_date), "legacy_id");
  const tariffByLegacy = new Map(insertedTariffs.map(row => [row.legacy_id, row]));

  await upsertMany("attorney_fee_brackets", attorneyFeeTariffs.flatMap(tariff => {
    const dbTariff = tariffByLegacy.get(tariff.id);
    if (!dbTariff) return [];
    return asArray(tariff.brackets).map((bracket, index) => ({
      tariff_id: dbTariff.id,
      sequence_no: index + 1,
      limit_amount: bracket.limit === null || bracket.limit === undefined || bracket.limit === "" ? null : numberValue(bracket.limit),
      rate: numberValue(bracket.rate),
      metadata: { source: "localStorage", legacy: bracket }
    }));
  }), "tariff_id,sequence_no");

  await upsertMany("enforcement_accounts", files.map(file => {
    const dbFile = fileByLegacy.get(file.id);
    const account = file.accountInfo || {};
    if (!dbFile || !isEnforcementFile(file)) return null;
    return {
      file_id: dbFile.id,
      legacy_id: file.id,
      principal: numberValue(account.principal || file.principal),
      pre_interest: numberValue(account.preInterest || file.preInterest),
      finalized_amount: numberValue(account.finalizedAmount || file.finalizedAmount),
      interest_type: account.interestType || file.interestType || null,
      interest_rate: numberValue(account.interestRate || file.interestRate),
      interest_start: normalizeDate(account.interestStart || file.interestStart || file.followUpDate),
      account_date: normalizeDate(account.accountDate || file.accountDate),
      post_interest: numberValue(account.postInterest || file.postInterest),
      fee_rate: numberValue(account.feeRate || file.feeRate),
      fees: numberValue(account.fees || file.fees),
      expenses: numberValue(account.expenses || file.expenses),
      attorney_fee: numberValue(account.attorneyFee || file.attorneyFee),
      payments: numberValue(account.payments || file.payments),
      instrument_charge: numberValue(account.instrumentCharge || file.instrumentCharge),
      instrument_charge_label: account.instrumentChargeLabel || file.instrumentChargeLabel || null,
      current_debt: numberValue(account.currentDebt || file.currentDebt),
      currency: account.currency || file.currency || "TRY",
      metadata: { source: "localStorage", legacy: account }
    };
  }), "file_id");

  await upsertMany("supporting_documents", files.flatMap(file => {
    const dbFile = fileByLegacy.get(file.id);
    if (!dbFile) return [];
    return asArray(file.supportingDocuments).map((document, index) => ({
      file_id: dbFile.id,
      legacy_id: document.id || `${file.id}:supporting:${index + 1}`,
      document_type: document.type || document.documentType || "DiÄŸer",
      title: document.title || null,
      bank: document.bank || null,
      branch: document.branch || null,
      document_no: document.number || document.documentNo || null,
      issue_date: normalizeDate(document.issueDate),
      due_date: normalizeDate(document.dueDate),
      issue_place: document.issuePlace || null,
      issuer: document.issuer || null,
      beneficiary: document.beneficiary || null,
      amount: numberValue(document.amount),
      original_with_client: Boolean(document.originalWithClient),
      file_name: document.fileName || null,
      description: document.description || null,
      metadata: { source: "localStorage", hasInlineFileData: Boolean(document.fileData), legacy: document }
    }));
  }), "legacy_id");

  await upsertMany("file_notes", files.flatMap(file => {
    const dbFile = fileByLegacy.get(file.id);
    if (!dbFile) return [];
    return asArray(file.notes).map((note, index) => ({
      file_id: dbFile.id,
      legacy_id: note.id || `${file.id}:note:${index + 1}`,
      note_text: note.text || String(note || ""),
      author_name: note.user || null,
      created_at: note.date || new Date().toISOString(),
      metadata: { source: "localStorage", legacy: note }
    })).filter(row => row.note_text);
  }), "legacy_id");

  await upsertMany("timeline_events", files.flatMap(file => {
    const dbFile = fileByLegacy.get(file.id);
    if (!dbFile) return [];
    return asArray(file.timeline).map((event, index) => ({
      file_id: dbFile.id,
      legacy_id: event.id || `${file.id}:timeline:${index + 1}`,
      event_type: event.type || "manual",
      title: event.title || "Zaman Ã§izelgesi kaydÄ±",
      description: event.description || null,
      event_date: event.date || new Date().toISOString(),
      actor_name: event.user || null,
      metadata: { source: "localStorage", legacy: event }
    })).filter(row => row.title);
  }), "legacy_id");

  await upsertMany("migration_logs", [{
    migration_key: isBootstrap ? bootstrapMigrationKey : regularMigrationKey,
    source: inputPath,
    status: "completed",
    summary: {
      mode: isBootstrap ? "bootstrap-service-role" : "authenticated-anon",
      files: files.length,
      hearings: asArray(state.hearings).length,
      deadlines: asArray(state.deadlines).length,
      tasks: asArray(state.tasks).length,
      documents: asArray(state.documents).length,
      paymentPlans: paymentPlans.length,
      paymentInstallments: paymentInstallmentRows.length,
      collections: asArray(state.collections).length,
      interestRates: asArray(state.calculationSettings?.interestRates).length,
      attorneyFeeTariffs: attorneyFeeTariffs.length
    },
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString()
  }], "migration_key");

  console.log(`LocalStorage import completed in ${isBootstrap ? "bootstrap" : "anon"} mode.`);
  if (isBootstrap) {
    console.log("Bootstrap completed. Remove SUPABASE_SERVICE_ROLE_KEY from .env and never expose it to browser/runtime code.");
  }
}

seed().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
