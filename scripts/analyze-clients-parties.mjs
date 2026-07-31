import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createSupabaseClient,
  loadEnvFile,
  parseArgs,
  writeJsonReport
} from "./files-migration-utils.mjs";

export const defaultClientsPartiesReport = path.join(process.cwd(), "work", "clients-parties-analysis.json");

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function comparable(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidTckn(value) {
  const number = digits(value);
  if (!/^[1-9]\d{10}$/.test(number)) return false;
  const values = [...number].map(Number);
  const odd = values[0] + values[2] + values[4] + values[6] + values[8];
  const even = values[1] + values[3] + values[5] + values[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === values[9]
    && values.slice(0, 10).reduce((sum, item) => sum + item, 0) % 10 === values[10];
}

function isPhoneLike(value) {
  const number = digits(value);
  return /^0?5\d{9}$/.test(number);
}

function explicitRepresentation(metadata = {}) {
  for (const key of ["representedByOffice", "represented_by_office", "isClient", "is_client"]) {
    if (typeof metadata?.[key] === "boolean") return metadata[key];
  }
  return null;
}

function legacyRepresentedParty(file = {}, party = {}) {
  if (file.record_kind === "İcra" || file.file_type === "İcra Dosyası") return false;
  const legacy = file.metadata?.legacy || {};
  const explicitClients = Array.isArray(legacy.clientParties) && legacy.clientParties.length
    ? legacy.clientParties
    : [{
        name: legacy.clientName || legacy.client || "",
        taxId: legacy.taxId || ""
      }];
  const partyName = comparable(party.name);
  const partyIdentifier = digits(party.tax_id || party.metadata?.taxId || party.metadata?.nationalId);
  return explicitClients.some(client => {
    const nameMatches = partyName && comparable(client?.name) === partyName;
    if (!nameMatches) return false;
    const clientIdentifier = digits(client?.taxId || client?.nationalId);
    return !partyIdentifier || !clientIdentifier || partyIdentifier === clientIdentifier;
  });
}

function duplicateGroups(rows, keyFactory) {
  const groups = new Map();
  rows.forEach(row => {
    const key = keyFactory(row);
    if (!key) return;
    const values = groups.get(key) || [];
    values.push(row.id);
    groups.set(key, values);
  });
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, count: ids.length, ids }));
}

export async function analyzeClientsParties({ reportPath = defaultClientsPartiesReport, write = true } = {}) {
  loadEnvFile();
  const supabase = createSupabaseClient({ serviceRole: true });
  const [clientResult, partyResult, fileResult] = await Promise.all([
    supabase.from("clients").select("*").is("deleted_at", null).order("created_at"),
    supabase.from("file_parties").select("*").is("deleted_at", null).order("created_at"),
    supabase.from("files").select("id,record_kind,file_type,file_no,court_or_office,metadata,deleted_at").is("deleted_at", null)
  ]);
  for (const result of [clientResult, partyResult, fileResult]) {
    if (result.error) throw result.error;
  }

  const clients = clientResult.data || [];
  const parties = partyResult.data || [];
  const files = fileResult.data || [];
  const filesById = new Map(files.map(file => [file.id, file]));
  const types = clients.reduce((result, client) => {
    const type = ["person", "organization"].includes(client.client_type) ? client.client_type : "unknown";
    result[type] += 1;
    return result;
  }, { person: 0, organization: 0, unknown: 0 });

  const phoneNationalIdCandidates = clients
    .filter(client => client.client_type === "person"
      && !digits(client.national_id)
      && isValidTckn(client.phone)
      && !isPhoneLike(client.phone))
    .map(client => ({ id: client.id, candidate: "national_id" }));
  const phoneTaxIdCandidates = clients
    .filter(client => client.client_type === "organization"
      && !digits(client.tax_id)
      && /^\d{10}$/.test(digits(client.phone))
      && !isPhoneLike(client.phone))
    .map(client => ({ id: client.id, candidate: "tax_id" }));
  const missingRepresentation = parties
    .filter(party => typeof party.represented_by_office !== "boolean")
    .map(party => ({
      id: party.id,
      fileId: party.file_id,
      clientId: party.client_id,
      role: party.role_label || party.role || null,
      side: party.side || null
    }));
  const explicitRepresentationCandidates = parties
    .filter(party => typeof party.represented_by_office !== "boolean")
    .map(party => {
      const metadataValue = explicitRepresentation(party.metadata);
      if (typeof metadataValue === "boolean") {
        return { id: party.id, representedByOffice: metadataValue, reason: "explicit_file_party_metadata" };
      }
      const file = filesById.get(party.file_id);
      if (file && legacyRepresentedParty(file, party)) {
        return { id: party.id, representedByOffice: true, reason: "explicit_legacy_client_field" };
      }
      return null;
    })
    .filter(Boolean);
  const ambiguousEnforcementFiles = files
    .filter(file => file.record_kind === "enforcement" || file.file_type === "İcra Dosyası")
    .filter(file => {
      const linked = parties.filter(party => party.file_id === file.id);
      return linked.length > 0 && !linked.some(party => party.represented_by_office === true);
    })
    .map(file => ({
      id: file.id,
      fileNo: file.file_no || null,
      courtOrOffice: file.court_or_office || null,
      reason: "Manuel müvekkil seçimi gerekli"
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    warning: "Veritabanına yazma yapılmadı. Kimlik değerleri raporda gösterilmez.",
    schema: {
      clients: {
        clientType: clients.length ? Object.hasOwn(clients[0], "client_type") : null,
        nationalId: clients.length ? Object.hasOwn(clients[0], "national_id") : null,
        taxId: clients.length ? Object.hasOwn(clients[0], "tax_id") : null,
        phone: clients.length ? Object.hasOwn(clients[0], "phone") : null,
        email: clients.length ? Object.hasOwn(clients[0], "email") : null
      },
      fileParties: {
        role: parties.length ? Object.hasOwn(parties[0], "role_label") || Object.hasOwn(parties[0], "role") : null,
        side: parties.length ? Object.hasOwn(parties[0], "side") : null,
        representedByOffice: parties.length ? Object.hasOwn(parties[0], "represented_by_office") : null,
        clientId: parties.length ? Object.hasOwn(parties[0], "client_id") : null,
        fileId: parties.length ? Object.hasOwn(parties[0], "file_id") : null
      }
    },
    summary: {
      totalClients: clients.length,
      ...types,
      phoneNationalIdCandidates: phoneNationalIdCandidates.length,
      phoneTaxIdCandidates: phoneTaxIdCandidates.length,
      missingRepresentation: missingRepresentation.length,
      explicitRepresentationCandidates: explicitRepresentationCandidates.length,
      ambiguousEnforcementFiles: ambiguousEnforcementFiles.length
    },
    phoneNationalIdCandidates,
    phoneTaxIdCandidates,
    missingRepresentation,
    explicitRepresentationCandidates,
    ambiguousEnforcementFiles,
    duplicateCandidates: {
      nationalId: duplicateGroups(clients, client => digits(client.national_id)),
      taxId: duplicateGroups(clients, client => digits(client.tax_id)),
      nameAndType: duplicateGroups(clients, client => {
        const name = comparable(client.name);
        return name ? `${client.client_type || "unknown"}|${name}` : "";
      })
    },
    unclearClientAcceptance: missingRepresentation.filter(row => {
      const file = filesById.get(row.fileId);
      return file && !explicitRepresentationCandidates.some(candidate => candidate.id === row.id);
    })
  };

  if (write) writeJsonReport(reportPath, report);
  return { report, raw: { clients, parties, files } };
}

async function main() {
  const args = parseArgs();
  const reportPath = args.values.report || defaultClientsPartiesReport;
  const { report } = await analyzeClientsParties({ reportPath });
  console.log("Müvekkil/taraf analizi tamamlandı. Veri yazılmadı.");
  console.log(`Toplam client: ${report.summary.totalClients}`);
  console.log(`Person / organization / unknown: ${report.summary.person} / ${report.summary.organization} / ${report.summary.unknown}`);
  console.log(`Telefon alanında yüksek güvenli kimlik adayı: ${report.summary.phoneNationalIdCandidates + report.summary.phoneTaxIdCandidates}`);
  console.log(`Temsil kararı eksik file_party: ${report.summary.missingRepresentation}`);
  console.log(`Manuel karar gereken icra dosyası: ${report.summary.ambiguousEnforcementFiles}`);
  console.log(`Rapor: ${reportPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
