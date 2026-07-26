import {
  asArray,
  canonicalFilesFromState,
  createSupabaseClient,
  hashValue,
  isEnforcementFile,
  loadEnvFile,
  normalizeDate,
  normalizeName,
  normalizeResponsibleNameKey,
  normalizeTaxId,
  normalizeText,
  readStateFromFile,
  readStateFromSupabase,
  safeJsonParse,
  writeJsonReport
} from "./files-migration-utils.mjs";
import {
  buildFileMaps,
  normalizeCourtCaseKey,
  normalizeFileLookupKey
} from "./deadlines-migration-utils.mjs";

export const defaultPartiesDryRunReportPath = "work/parties-migration-dry-run-report.json";

export const partyRoleMapping = [
  { source: "Davacı", partyType: "plaintiff", side: "represented", roleLabel: "Davacı", risk: "low" },
  { source: "Davalı", partyType: "defendant", side: "opposing", roleLabel: "Davalı", risk: "low" },
  { source: "Alacaklı", partyType: "creditor", side: "represented", roleLabel: "Alacaklı", risk: "low" },
  { source: "Borçlu", partyType: "debtor", side: "opposing", roleLabel: "Borçlu", risk: "low" },
  { source: "Müşteki / Şikayetçi / Mağdur", partyType: "complainant", side: "represented", roleLabel: "Müşteki", risk: "medium" },
  { source: "Sanık", partyType: "accused", side: "represented_or_opposing", roleLabel: "Sanık", risk: "medium" },
  { source: "Şüpheli", partyType: "suspect", side: "represented_or_opposing", roleLabel: "Şüpheli", risk: "medium" },
  { source: "Tanık", partyType: "witness", side: "neutral", roleLabel: "Tanık", risk: "medium" },
  { source: "Müvekkil", partyType: "client", side: "represented", roleLabel: "Müvekkil", risk: "medium" },
  { source: "Karşı Taraf", partyType: "opponent", side: "opposing", roleLabel: "Karşı Taraf", risk: "medium" },
  { source: "Diğer / bilinmeyen", partyType: "other", side: "other", roleLabel: "Diğer", risk: "manual_review" }
];

export const partyFieldMapping = [
  { source: "state.files[].clientParties", target: "clients + file_parties", priority: 1, risk: "Yapilandirilmis dava muvekkil tarafi oldugu icin birincil kaynaktir." },
  { source: "state.files[].opponentParties", target: "clients + file_parties", priority: 1, risk: "Yapilandirilmis karsi taraf oldugu icin birincil kaynaktir." },
  { source: "state.files[].creditorParties", target: "clients + file_parties", priority: 1, risk: "Icra dosyalari icin alacakli taraf kaynagidir." },
  { source: "state.files[].debtors", target: "clients + file_parties", priority: 1, risk: "Icra dosyalari icin borclu taraf kaynagidir." },
  { source: "plaintiffs / defendants / complainants / suspects / accused / witnesses / otherParties", target: "file_parties.party_type, side, role_label", priority: 2, risk: "Eski metadata alanlarindan gelir; rol yorumu manuel kontrol gerektirebilir." },
  { source: "public.files.client_name / opponent_name", target: "clients + file_parties", priority: 3, risk: "Ozet alan oldugu icin coklu taraf ayrintisini tasimayabilir." },
  { source: "clientName / opponentName fallback", target: "clients + file_parties", priority: 4, risk: "Eski duz metin alanidir; TC/VKN yoksa isim bazli eslesme riski vardir." }
];

const structuredArrayNames = [
  "clientParties",
  "opponentParties",
  "creditorParties",
  "debtors",
  "plaintiffs",
  "defendants",
  "complainants",
  "suspects",
  "accused",
  "witnesses",
  "otherParties"
];

export function normalizeComparableText(value) {
  return normalizeText(value)
    .replace(/[İIı]/g, "i")
    .replace(/[Çç]/g, "c")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Öö]/g, "o")
    .replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePartyName(value) {
  return normalizeComparableText(value)
    .replace(/^(avukat|av)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value) {
  const digits = normalizeText(value).replace(/[^\d+]/g, "");
  return digits || "";
}

export function normalizeEmail(value) {
  return normalizeText(value).toLocaleLowerCase("tr-TR");
}

export function normalizedIdentifier(value) {
  return normalizeText(value).replace(/[^\d]/g, "");
}

export function splitNationalAndTaxId(value) {
  const digits = normalizedIdentifier(value);
  if (!digits) return { nationalId: "", taxId: "", rawIdentifier: normalizeText(value), invalid: false };
  if (digits.length === 11) return { nationalId: digits, taxId: "", rawIdentifier: normalizeText(value), invalid: false };
  if (digits.length === 10) return { nationalId: "", taxId: digits, rawIdentifier: normalizeText(value), invalid: false };
  return { nationalId: "", taxId: digits, rawIdentifier: normalizeText(value), invalid: true };
}

export function inferClientTypeFromParty(party = {}) {
  const explicit = normalizeComparableText(party.clientType || party.client_type || party.type || party.partyKind || party.kind);
  if (["person", "kisi", "kişi", "gercek kisi", "gerçek kişi"].includes(explicit)) return "person";
  if (["company", "sirket", "şirket", "tuzel kisi", "tüzel kişi"].includes(explicit)) return "company";
  if (["institution", "kurum"].includes(explicit)) return "institution";
  const ids = splitNationalAndTaxId(party.taxId || party.tcVkn || party.tax_id || party.nationalId || party.national_id || party.vkn || party.tc);
  if (ids.nationalId) return "person";
  if (ids.taxId && ids.taxId.length === 10) return "company";
  return "unknown";
}

export function normalizeRoleLabel(value, fallback) {
  const original = normalizeText(value || fallback);
  const key = normalizeComparableText(original);
  const map = new Map([
    ["davaci", "Davacı"],
    ["davali", "Davalı"],
    ["alacakli", "Alacaklı"],
    ["borclu", "Borçlu"],
    ["sikayetci", "Müşteki"],
    ["musteki", "Müşteki"],
    ["magdur", "Mağdur"],
    ["sanik", "Sanık"],
    ["supheli", "Şüpheli"],
    ["tanik", "Tanık"],
    ["muvekkil", "Müvekkil"],
    ["karsi taraf", "Karşı Taraf"],
    ["lehtar", "Lehtar"],
    ["kesideci", "Keşideci"]
  ]);
  return map.get(key) || original || fallback || "Diğer";
}

export function canonicalPartyType(roleLabel, fallbackType = "other") {
  const key = normalizeComparableText(roleLabel);
  if (key.includes("davaci")) return "plaintiff";
  if (key.includes("davali")) return "defendant";
  if (key.includes("alacakli")) return "creditor";
  if (key.includes("borclu")) return "debtor";
  if (key.includes("musteki") || key.includes("sikayetci") || key.includes("magdur")) return "complainant";
  if (key.includes("sanik")) return "accused";
  if (key.includes("supheli")) return "suspect";
  if (key.includes("tanik")) return "witness";
  if (key.includes("muvekkil")) return "client";
  if (key.includes("karsi taraf")) return "opponent";
  return fallbackType || "other";
}

export function sideForParty({ partyType, sourceSide, sourceRole }) {
  const side = normalizeComparableText(sourceSide);
  if (["represented", "client", "creditor", "plaintiff", "complainant"].includes(side)) return "represented";
  if (["opposing", "opponent", "debtor", "defendant"].includes(side)) return "opposing";
  if (["neutral", "witness"].includes(side)) return "neutral";
  if (["creditor", "plaintiff", "client", "complainant"].includes(partyType)) return "represented";
  if (["debtor", "defendant", "opponent"].includes(partyType)) return "opposing";
  if (partyType === "witness") return "neutral";
  const role = normalizeComparableText(sourceRole);
  if (role.includes("sanik") || role.includes("supheli")) return "represented";
  return "other";
}

function partyNameFromSource(party = {}) {
  return normalizeText(
    party.name
    || party.fullName
    || party.title
    || party.client
    || party.opponent
    || party.creditor
    || party.debtor
    || party.plaintiff
    || party.defendant
    || party.complainant
    || party.suspect
    || party.accused
    || party.witness
    || party.partyName
  );
}

function identifierFromSource(party = {}) {
  return normalizeText(
    party.nationalId
    || party.national_id
    || party.tc
    || party.tcNo
    || party.tcVkn
    || party.taxId
    || party.tax_id
    || party.vkn
    || party.creditorTaxId
    || party.debtorTaxId
    || party.identityNo
  );
}

export function normalizePartySource(party = {}, {
  fallbackRole = "Diğer",
  fallbackType = "other",
  sourceSide = "other",
  sourceField = "",
  sourcePriority = 9,
  sourceIndex = 0
} = {}) {
  const name = partyNameFromSource(party);
  const identifiers = splitNationalAndTaxId(identifierFromSource(party));
  const email = normalizeEmail(party.email || party.mail);
  const phone = normalizePhone(party.phone || party.gsm || party.mobile);
  const roleLabel = normalizeRoleLabel(party.role || party.partyRole || party.roleLabel, fallbackRole);
  const partyType = canonicalPartyType(roleLabel, fallbackType);
  const side = sideForParty({ partyType, sourceSide, sourceRole: roleLabel });
  const clientType = inferClientTypeFromParty({
    ...party,
    taxId: identifiers.nationalId || identifiers.taxId || identifiers.rawIdentifier
  });

  return {
    name,
    nationalId: identifiers.nationalId,
    taxId: identifiers.taxId,
    rawIdentifier: identifiers.rawIdentifier,
    invalidIdentifier: identifiers.invalid,
    email,
    phone,
    roleLabel,
    partyType,
    side,
    clientType,
    sourceField,
    sourcePriority,
    sourceIndex,
    explicitPrimary: Boolean(party.isPrimary || party.primary || party.is_primary)
  };
}

function readMetadataObject(fileRow = {}) {
  return safeJsonParse(fileRow.metadata) || {};
}

function buildPublicSourceRecord(fileRow = {}) {
  const metadata = readMetadataObject(fileRow);
  const legacyFlatFields = metadata.legacyFlatFields && typeof metadata.legacyFlatFields === "object"
    ? metadata.legacyFlatFields
    : {};

  return {
    ...legacyFlatFields,
    ...metadata,
    legacy_id: fileRow.legacy_id || metadata.legacy_id || metadata.legacyId,
    legacyId: fileRow.legacy_id || metadata.legacyId,
    display_id: fileRow.display_id || metadata.display_id || metadata.displayId,
    displayId: fileRow.display_id || metadata.displayId,
    id: fileRow.legacy_id || fileRow.display_id || fileRow.id,
    fileType: fileRow.file_type || metadata.fileType,
    recordKind: fileRow.record_kind || metadata.recordKind,
    followType: fileRow.follow_type || metadata.followType,
    fileNo: fileRow.file_no || metadata.fileNo || legacyFlatFields.fileNo,
    courtOrOffice: fileRow.court_or_office || metadata.courtOrOffice || legacyFlatFields.courtOrOffice,
    clientName: fileRow.client_name || metadata.clientName || legacyFlatFields.clientName || metadata.client,
    opponentName: fileRow.opponent_name || metadata.opponentName || legacyFlatFields.opponentName || metadata.opponent,
    client: fileRow.client_name || metadata.client || legacyFlatFields.client,
    opponent: fileRow.opponent_name || metadata.opponent || legacyFlatFields.opponent,
    creditor: metadata.creditor || legacyFlatFields.creditor || fileRow.client_name,
    debtor: metadata.debtor || legacyFlatFields.debtor || fileRow.opponent_name,
    taxId: metadata.taxId || legacyFlatFields.taxId,
    opponentTaxId: metadata.opponentTaxId || legacyFlatFields.opponentTaxId,
    creditorTaxId: metadata.creditorTaxId || legacyFlatFields.creditorTaxId,
    debtorTaxId: metadata.debtorTaxId || legacyFlatFields.debtorTaxId,
    partyRole: metadata.partyRole || legacyFlatFields.partyRole,
    metadata
  };
}

function sourceArray(record = {}, fieldName) {
  const direct = asArray(record[fieldName]);
  if (direct.length) return direct;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  return asArray(metadata[fieldName]);
}

function partyDedupKey(party) {
  return [
    party.side,
    party.partyType,
    party.nationalId || "",
    party.taxId || "",
    party.email || "",
    party.phone || "",
    normalizePartyName(party.name),
    normalizeComparableText(party.roleLabel)
  ].join("|");
}

function pushParty(target, seen, party) {
  if (!party.name && !party.nationalId && !party.taxId && !party.email && !party.phone) return false;
  const key = partyDedupKey(party);
  if (seen.has(key)) return false;
  seen.add(key);
  target.push(party);
  return true;
}

function normalizeArrayParties(record, fieldName, options) {
  return sourceArray(record, fieldName).map((party, index) => normalizePartySource(party, {
    ...options,
    sourceField: fieldName,
    sourceIndex: index
  }));
}

function appendSummaryFallback(parties, seen, record, {
  fieldName,
  name,
  identifier,
  role,
  fallbackType,
  sourceSide,
  sourcePriority
}) {
  const party = normalizePartySource({
    name,
    taxId: identifier,
    role
  }, {
    fallbackRole: role,
    fallbackType,
    sourceSide,
    sourceField: fieldName,
    sourcePriority,
    sourceIndex: parties.length
  });
  pushParty(parties, seen, party);
}

export function collectPartiesForMigration(record = {}, fileRow = {}) {
  const publicRecord = buildPublicSourceRecord(fileRow);
  const source = {
    ...publicRecord,
    ...record,
    metadata: {
      ...(publicRecord.metadata || {}),
      ...(record.metadata || {})
    }
  };
  const enforcement = isEnforcementFile(source) || normalizeComparableText(fileRow.record_kind) === "enforcement";
  const parties = [];
  const seen = new Set();

  if (enforcement) {
    normalizeArrayParties(source, "creditorParties", {
      fallbackRole: "Alacaklı",
      fallbackType: "creditor",
      sourceSide: "represented",
      sourcePriority: 1
    }).forEach(party => pushParty(parties, seen, party));

    normalizeArrayParties(source, "debtors", {
      fallbackRole: "Borçlu",
      fallbackType: "debtor",
      sourceSide: "opposing",
      sourcePriority: 1
    }).forEach(party => pushParty(parties, seen, party));
  } else {
    normalizeArrayParties(source, "clientParties", {
      fallbackRole: source.partyRole || "Davacı",
      fallbackType: "client",
      sourceSide: "represented",
      sourcePriority: 1
    }).forEach(party => pushParty(parties, seen, party));

    normalizeArrayParties(source, "opponentParties", {
      fallbackRole: "Davalı",
      fallbackType: "opponent",
      sourceSide: "opposing",
      sourcePriority: 1
    }).forEach(party => pushParty(parties, seen, party));
  }

  normalizeArrayParties(source, "plaintiffs", {
    fallbackRole: "Davacı",
    fallbackType: "plaintiff",
    sourceSide: "represented",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "defendants", {
    fallbackRole: "Davalı",
    fallbackType: "defendant",
    sourceSide: "opposing",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "complainants", {
    fallbackRole: "Müşteki",
    fallbackType: "complainant",
    sourceSide: "represented",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "suspects", {
    fallbackRole: "Şüpheli",
    fallbackType: "suspect",
    sourceSide: "represented",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "accused", {
    fallbackRole: "Sanık",
    fallbackType: "accused",
    sourceSide: "represented",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "witnesses", {
    fallbackRole: "Tanık",
    fallbackType: "witness",
    sourceSide: "neutral",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  normalizeArrayParties(source, "otherParties", {
    fallbackRole: "Diğer",
    fallbackType: "other",
    sourceSide: "other",
    sourcePriority: 2
  }).forEach(party => pushParty(parties, seen, party));

  const representedExists = parties.some(party => party.side === "represented");
  const opposingExists = parties.some(party => party.side === "opposing");

  if (enforcement && !representedExists) {
    appendSummaryFallback(parties, seen, source, {
      fieldName: "public.files.client_name/clientName/creditor fallback",
      name: source.clientName || source.creditor || source.client,
      identifier: source.creditorTaxId || source.taxId,
      role: "Alacaklı",
      fallbackType: "creditor",
      sourceSide: "represented",
      sourcePriority: 3
    });
  }

  if (enforcement && !opposingExists) {
    appendSummaryFallback(parties, seen, source, {
      fieldName: "public.files.opponent_name/opponentName/debtor fallback",
      name: source.opponentName || source.debtor || source.opponent,
      identifier: source.debtorTaxId || source.opponentTaxId,
      role: "Borçlu",
      fallbackType: "debtor",
      sourceSide: "opposing",
      sourcePriority: 3
    });
  }

  if (!enforcement && !representedExists) {
    appendSummaryFallback(parties, seen, source, {
      fieldName: "public.files.client_name/clientName fallback",
      name: source.clientName || source.client,
      identifier: source.taxId || source.clientTaxId,
      role: source.partyRole || "Davacı",
      fallbackType: "client",
      sourceSide: "represented",
      sourcePriority: 3
    });
  }

  if (!enforcement && !opposingExists) {
    appendSummaryFallback(parties, seen, source, {
      fieldName: "public.files.opponent_name/opponentName fallback",
      name: source.opponentName || source.opponent,
      identifier: source.opponentTaxId,
      role: "Davalı",
      fallbackType: "opponent",
      sourceSide: "opposing",
      sourcePriority: 3
    });
  }

  const primaryBySide = new Set();
  return parties
    .sort((left, right) => left.sourcePriority - right.sourcePriority || left.sourceIndex - right.sourceIndex)
    .map((party, index) => {
      const sideKey = party.side || "other";
      const shouldBePrimary = party.explicitPrimary || (["represented", "opposing"].includes(sideKey) && !primaryBySide.has(sideKey));
      if (shouldBePrimary) primaryBySide.add(sideKey);
      return {
        ...party,
        isPrimary: shouldBePrimary,
        sourceIndex: index
      };
    });
}

function addToMultiMap(map, key, value) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function uniqueById(items = []) {
  return [...new Map(items.filter(Boolean).map(item => [item.id, item])).values()];
}

function resolveFileForStateRecord(record, legacyId, fileMaps) {
  const attempts = [
    { source: "old fileId/id -> files.legacy_id", key: normalizeFileLookupKey(legacyId), map: fileMaps.byLegacyId },
    { source: "old display/id -> files.display_id/legacy_id/file_no", key: normalizeFileLookupKey(record.display_id || record.displayId || record.id || record.fileId), map: fileMaps.byDisplayOrLegacyOrNo },
    { source: "court+file_no", key: normalizeCourtCaseKey(record.courtOrOffice || record.court || record.office, record.fileNo || record.file), map: fileMaps.byCourtCase }
  ];

  for (const attempt of attempts) {
    const matches = uniqueById((attempt.map.get(attempt.key) || []).map(item => item.file));
    if (matches.length === 1) {
      return { file: matches[0], matchType: attempt.source, lookupKey: attempt.key };
    }
    if (matches.length > 1) {
      return {
        file: null,
        matchType: "ambiguous",
        attemptedBy: attempt.source,
        lookupKey: attempt.key,
        candidates: matches.map(file => ({
          id: file.id,
          legacyId: file.legacy_id || null,
          displayId: file.display_id || null,
          fileNo: file.file_no || null,
          courtOrOffice: file.court_or_office || null
        }))
      };
    }
  }

  return {
    file: null,
    matchType: "unmatched",
    lookupKey: normalizeFileLookupKey(legacyId || record.id || record.fileId || record.displayId || record.fileNo || "")
  };
}

export async function readFilesForParties({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("files")
    .select("id, legacy_id, display_id, record_kind, file_type, follow_type, file_no, court_or_office, client_name, opponent_name, metadata, created_at, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`files okunamadi: ${error.message}`);
  return data || [];
}

export async function readExistingClients({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const extendedSelect = "id, legacy_id, name, tax_id, national_id, phone, email, client_type, import_batch_id, metadata, created_at, updated_at, deleted_at";
  const baseSelect = "id, legacy_id, name, tax_id, phone, email, client_type, metadata, created_at, updated_at, deleted_at";
  const result = await supabase
    .from("clients")
    .select(extendedSelect)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (result.error && /national_id|import_batch_id/i.test(result.error.message || "")) {
    const fallback = await supabase
      .from("clients")
      .select(baseSelect)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (fallback.error) throw new Error(`clients okunamadi: ${fallback.error.message}`);
    return (fallback.data || []).map(row => ({ ...row, national_id: null, import_batch_id: null }));
  }

  if (result.error) throw new Error(`clients okunamadi: ${result.error.message}`);
  return result.data || [];
}

export async function readExistingFileParties({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const extendedSelect = "id, legacy_id, file_id, client_id, party_type, side, role, role_label, name, tax_id, phone, email, is_primary, import_batch_id, metadata, created_at, updated_at, deleted_at";
  const baseSelect = "id, legacy_id, file_id, client_id, party_type, side, role, name, tax_id, phone, email, is_primary, metadata, created_at, updated_at, deleted_at";
  const result = await supabase
    .from("file_parties")
    .select(extendedSelect)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (result.error && /role_label|import_batch_id/i.test(result.error.message || "")) {
    const fallback = await supabase
      .from("file_parties")
      .select(baseSelect)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (fallback.error) throw new Error(`file_parties okunamadi: ${fallback.error.message}`);
    return (fallback.data || []).map(row => ({ ...row, role_label: row.role || null, import_batch_id: null }));
  }

  if (result.error) throw new Error(`file_parties okunamadi: ${result.error.message}`);
  return result.data || [];
}

function clientStrongKeys(row = {}) {
  const ids = splitNationalAndTaxId(row.tax_id || row.taxId || row.national_id || row.nationalId);
  return {
    legacy: normalizeText(row.legacy_id || row.legacyId),
    national: normalizeTaxId(row.national_id || row.nationalId || ids.nationalId),
    tax: normalizeTaxId(row.tax_id || row.taxId || ids.taxId),
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone)
  };
}

export function buildExistingClientMaps(clients = []) {
  const byLegacyId = new Map();
  const byNationalId = new Map();
  const byTaxId = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  const byNameType = new Map();
  const byName = new Map();

  clients
    .filter(client => client && client.deleted_at == null)
    .forEach(client => {
      const keys = clientStrongKeys(client);
      addToMultiMap(byLegacyId, keys.legacy, client);
      addToMultiMap(byNationalId, keys.national, client);
      addToMultiMap(byTaxId, keys.tax, client);
      addToMultiMap(byEmail, keys.email, client);
      addToMultiMap(byPhone, keys.phone, client);
      addToMultiMap(byNameType, `${normalizePartyName(client.name)}|${normalizeComparableText(client.client_type || "unknown")}`, client);
      addToMultiMap(byName, normalizePartyName(client.name), client);
    });

  return { byLegacyId, byNationalId, byTaxId, byEmail, byPhone, byNameType, byName };
}

function deterministicClientLegacyId(party) {
  if (party.nationalId) return `tc-${party.nationalId}`;
  if (party.taxId) return `vkn-${party.taxId}`;
  if (party.email) return `email-${hashValue(party.email, 16)}`;
  if (party.phone) return `phone-${hashValue(party.phone, 16)}`;
  return `name-${hashValue(`${normalizePartyName(party.name)}|${party.clientType}`, 16)}`;
}

function clientLegacyIdCandidates(party) {
  const candidates = [
    deterministicClientLegacyId(party)
  ];
  const identifier = party.nationalId || party.taxId;
  if (identifier) candidates.push(`tax-${identifier}`);
  if (party.name) candidates.push(`name-${hashValue(normalizeName(party.name), 16)}`);
  return [...new Set(candidates.filter(Boolean))];
}

function oldSourceSideForParty(party) {
  const field = normalizeComparableText(party.sourceField);
  if (field.includes("clientparties")) return "client";
  if (field.includes("opponentparties")) return "opponent";
  if (field.includes("creditorparties")) return "creditor";
  if (field.includes("debtors")) return "debtor";
  if (field.includes("plaintiffs")) return "client";
  if (field.includes("defendants")) return "opponent";
  if (field.includes("complainants")) return "client";
  if (field.includes("suspects") || field.includes("accused")) return "client";
  return party.side;
}

function deterministicPartyLegacyIds(file, party, index) {
  const seed = [
    file.legacy_id || file.display_id || file.id,
    party.side,
    party.partyType,
    party.roleLabel,
    party.nationalId,
    party.taxId,
    party.email,
    party.phone,
    party.name,
    index
  ].join("|");
  const base = file.legacy_id || file.display_id || file.id;
  const oldIdentifier = party.nationalId || party.taxId;
  const oldSeed = `${party.partyType}|${oldSourceSideForParty(party)}|${party.name}|${oldIdentifier}`;
  return [
    `${base}:party:${hashValue(seed, 16)}`,
    `${base}:party:${index + 1}:${hashValue(oldSeed, 10)}`
  ];
}

function deterministicPartyLegacyId(file, party, index) {
  return deterministicPartyLegacyIds(file, party, index)[0];
}

function resolveClientForParty(party, clientMaps) {
  const clientLegacyId = deterministicClientLegacyId(party);
  const legacyAttempts = clientLegacyIdCandidates(party).map(key => ({
    matchType: "legacy_id",
    key,
    map: clientMaps.byLegacyId
  }));
  const attempts = [
    ...legacyAttempts,
    { matchType: "national_id", key: party.nationalId, map: clientMaps.byNationalId },
    { matchType: "tax_id", key: party.taxId, map: clientMaps.byTaxId },
    { matchType: "email", key: party.email, map: clientMaps.byEmail },
    { matchType: "phone", key: party.phone, map: clientMaps.byPhone },
    { matchType: "name_client_type", key: `${normalizePartyName(party.name)}|${normalizeComparableText(party.clientType || "unknown")}`, map: clientMaps.byNameType },
    { matchType: "name_single", key: normalizePartyName(party.name), map: clientMaps.byName }
  ];

  for (const attempt of attempts) {
    if (!attempt.key) continue;
    const matches = uniqueById(attempt.map.get(attempt.key) || []);
    if (matches.length === 1) {
      return {
        client: matches[0],
        matchType: attempt.matchType,
        lookupKey: attempt.key,
        ambiguous: false
      };
    }
    if (matches.length > 1) {
      return {
        client: null,
        matchType: "ambiguous",
        attemptedBy: attempt.matchType,
        lookupKey: attempt.key,
        ambiguous: true,
        candidates: matches.map(client => ({
          id: client.id,
          legacyId: client.legacy_id || null,
          name: client.name || null,
          clientType: client.client_type || null,
          nationalId: client.national_id || null,
          taxId: client.tax_id || null,
          email: client.email || null
        }))
      };
    }
  }

  return {
    client: null,
    matchType: "new",
    lookupKey: clientLegacyId,
    ambiguous: false
  };
}

function clientRowFromParty(party, batchId) {
  return {
    legacy_id: deterministicClientLegacyId(party),
    name: party.name || "İsimsiz taraf",
    tax_id: party.taxId || null,
    national_id: party.nationalId || null,
    phone: party.phone || null,
    email: party.email || null,
    client_type: party.clientType || "unknown",
    notes: null,
    import_batch_id: batchId,
    metadata: {
      source: "parties-migration",
      importBatchId: batchId,
      createdByImportBatchId: batchId,
      matchStrategy: party.nationalId ? "national_id" : party.taxId ? "tax_id" : party.email ? "email" : party.phone ? "phone" : "name_client_type",
      rawIdentifier: party.rawIdentifier || null,
      nameOnlyMergeRisk: !party.nationalId && !party.taxId && !party.email && !party.phone
    }
  };
}

function filePartyRowFromParty({ file, party, clientId = null, batchId, index }) {
  return {
    legacy_id: deterministicPartyLegacyId(file, party, index),
    file_id: file.id,
    client_id: clientId,
    party_type: party.partyType || "other",
    side: party.side || "other",
    role: party.roleLabel || null,
    role_label: party.roleLabel || null,
    name: party.name || "İsimsiz taraf",
    tax_id: party.nationalId || party.taxId || null,
    phone: party.phone || null,
    email: party.email || null,
    is_primary: Boolean(party.isPrimary),
    import_batch_id: batchId,
    metadata: {
      source: "parties-migration",
      importBatchId: batchId,
      createdByImportBatchId: batchId,
      sourceField: party.sourceField,
      sourcePriority: party.sourcePriority,
      originalIdentifier: party.rawIdentifier || null,
      nationalId: party.nationalId || null,
      taxId: party.taxId || null,
      clientType: party.clientType || "unknown"
    }
  };
}

function buildExistingFilePartyMaps(existingFileParties = []) {
  const byLegacyId = new Map();
  const byComposite = new Map();
  const byLooseComposite = new Map();
  const byFileClientName = new Map();
  existingFileParties
    .filter(row => row && row.deleted_at == null)
    .forEach(row => {
      const legacy = normalizeText(row.legacy_id);
      if (legacy) byLegacyId.set(legacy, row);
      const composite = [
        row.file_id || "",
        row.client_id || "",
        normalizeComparableText(row.party_type),
        normalizeComparableText(row.role_label || row.role),
        normalizePartyName(row.name)
      ].join("|");
      if (!byComposite.has(composite)) byComposite.set(composite, row);
      const looseComposite = [
        row.file_id || "",
        row.client_id || "",
        normalizeComparableText(row.party_type),
        normalizePartyName(row.name)
      ].join("|");
      if (!byLooseComposite.has(looseComposite)) byLooseComposite.set(looseComposite, row);
      const fileClientName = [
        row.file_id || "",
        row.client_id || "",
        normalizePartyName(row.name)
      ].join("|");
      if (!byFileClientName.has(fileClientName)) byFileClientName.set(fileClientName, row);
    });
  return { byLegacyId, byComposite, byLooseComposite, byFileClientName };
}

function existingFilePartyMatches(row = {}, existing = {}) {
  return normalizeText(row.file_id) === normalizeText(existing.file_id)
    && normalizeText(row.client_id) === normalizeText(existing.client_id)
    && normalizeComparableText(row.party_type) === normalizeComparableText(existing.party_type)
    && normalizeComparableText(row.side) === normalizeComparableText(existing.side)
    && normalizeComparableText(row.role_label || row.role) === normalizeComparableText(existing.role_label || existing.role)
    && normalizePartyName(row.name) === normalizePartyName(existing.name)
    && normalizeTaxId(row.tax_id) === normalizeTaxId(existing.tax_id)
    && normalizePhone(row.phone) === normalizePhone(existing.phone)
    && normalizeEmail(row.email) === normalizeEmail(existing.email)
    && Boolean(row.is_primary) === Boolean(existing.is_primary);
}

function sourceFieldsFromState(state = {}) {
  return [...new Set(asArray(state.files).concat(asArray(state.cases)).flatMap(file => Object.keys(file || {})))].sort((a, b) => a.localeCompare(b, "tr"));
}

function getFileDisplay(file = {}) {
  return {
    id: file.id,
    legacyId: file.legacy_id || null,
    displayId: file.display_id || null,
    fileNo: file.file_no || null,
    courtOrOffice: file.court_or_office || null
  };
}

function incrementMap(map, key) {
  const safeKey = key || "unknown";
  map.set(safeKey, (map.get(safeKey) || 0) + 1);
}

export function buildPartiesMigrationPlan(state = {}, {
  files = [],
  existingClients = [],
  existingFileParties = [],
  batchId = "parties-dry-run"
} = {}) {
  const source = canonicalFilesFromState(state);
  const fileMaps = buildFileMaps(files);
  const clientMaps = buildExistingClientMaps(existingClients);
  const existingFilePartyMaps = buildExistingFilePartyMaps(existingFileParties);
  const processedFileIds = new Set();
  const rows = [];
  const clientsToCreate = new Map();
  const clientCreationByLegacy = new Map();
  const unmatchedFiles = [];
  const ambiguousFiles = [];
  const emptyNameParties = [];
  const invalidTaxIds = [];
  const ambiguousClients = [];
  const nameOnlyClientMatches = [];
  const skipped = [];
  const matchedFiles = [];
  const sourcePriorityCounts = new Map();
  const clientTypeCounts = new Map();
  let createFilePartyCount = 0;
  let updateFilePartyCount = 0;
  let alreadyExistingFilePartyCount = 0;

  function addPartyRowsForFile({ sourceRecord, file, sourceName, originalIndex }) {
    const parties = collectPartiesForMigration(sourceRecord, file);
    processedFileIds.add(file.id);
    parties.forEach((party, partyIndex) => {
      incrementMap(sourcePriorityCounts, String(party.sourcePriority));
      incrementMap(clientTypeCounts, party.clientType);
      if (!party.name) emptyNameParties.push({ file: getFileDisplay(file), partyType: party.partyType, side: party.side, sourceField: party.sourceField });
      if (party.invalidIdentifier) invalidTaxIds.push({ file: getFileDisplay(file), name: party.name, identifier: party.rawIdentifier, sourceField: party.sourceField });

      const clientResolution = resolveClientForParty(party, clientMaps);
      if (clientResolution.ambiguous) {
        ambiguousClients.push({
          file: getFileDisplay(file),
          name: party.name,
          roleLabel: party.roleLabel,
          attemptedBy: clientResolution.attemptedBy,
          lookupKey: clientResolution.lookupKey,
          candidates: clientResolution.candidates
        });
        skipped.push({
          type: "file_party",
          file: getFileDisplay(file),
          name: party.name,
          reason: "client_ambiguous"
        });
        return;
      }

      let plannedClient = null;
      let clientId = clientResolution.client?.id || null;
      if (!clientId) {
        const clientRow = clientRowFromParty(party, batchId);
        if (!clientsToCreate.has(clientRow.legacy_id)) {
          clientsToCreate.set(clientRow.legacy_id, {
            row: clientRow,
            sourceParty: party,
            action: "create"
          });
        }
        plannedClient = clientsToCreate.get(clientRow.legacy_id);
        clientCreationByLegacy.set(clientRow.legacy_id, plannedClient);
      } else if (["name_client_type", "name_single"].includes(clientResolution.matchType)) {
        nameOnlyClientMatches.push({
          file: getFileDisplay(file),
          name: party.name,
          clientId,
          clientType: party.clientType,
          risk: "No TC/VKN/e-posta/telefon strong key; matched by normalized name + client_type only."
        });
      }

      const pseudoClientId = clientId || `planned:${plannedClient?.row.legacy_id}`;
      const row = filePartyRowFromParty({
        file,
        party,
        clientId: clientId || null,
        batchId,
        index: partyIndex
      });
      const composite = [
        row.file_id,
        pseudoClientId,
        normalizeComparableText(row.party_type),
        normalizeComparableText(row.role_label || row.role),
        normalizePartyName(row.name)
      ].join("|");
      const legacyCandidates = deterministicPartyLegacyIds(file, party, partyIndex);
      const existingByLegacy = legacyCandidates.map(legacyId => existingFilePartyMaps.byLegacyId.get(legacyId)).find(Boolean);
      const existing = existingByLegacy
        || (clientId ? existingFilePartyMaps.byComposite.get([
          row.file_id,
          clientId,
          normalizeComparableText(row.party_type),
          normalizeComparableText(row.role_label || row.role),
          normalizePartyName(row.name)
        ].join("|")) : null)
        || (clientId ? existingFilePartyMaps.byLooseComposite.get([
          row.file_id,
          clientId,
          normalizeComparableText(row.party_type),
          normalizePartyName(row.name)
        ].join("|")) : null)
        || (clientId ? existingFilePartyMaps.byFileClientName.get([
          row.file_id,
          clientId,
          normalizePartyName(row.name)
        ].join("|")) : null);

      let action = "create";
      if (existing) {
        if (existingFilePartyMatches(row, existing)) {
          action = "existing";
          alreadyExistingFilePartyCount += 1;
        } else {
          action = "update";
          updateFilePartyCount += 1;
        }
      } else {
        createFilePartyCount += 1;
      }

      rows.push({
        row,
        sourceRecord,
        sourceName,
        originalIndex,
        action,
        existingId: existing?.id || null,
        existingRecord: existing || null,
        plannedClientLegacyId: plannedClient?.row.legacy_id || null,
        clientMatch: clientResolution,
        compositeKey: composite
      });
    });
  }

  source.canonical.forEach(({ record, sourceName, index, legacyId }) => {
    const resolved = resolveFileForStateRecord(record, legacyId, fileMaps);
    if (resolved.file) {
      matchedFiles.push({ legacyId, file: getFileDisplay(resolved.file), matchType: resolved.matchType });
      addPartyRowsForFile({ sourceRecord: record, file: resolved.file, sourceName, originalIndex: index });
      return;
    }
    if (resolved.matchType === "ambiguous") {
      ambiguousFiles.push({ legacyId, sourceName, originalIndex: index, ...resolved });
      return;
    }
    unmatchedFiles.push({ legacyId, sourceName, originalIndex: index, ...resolved });
  });

  files
    .filter(file => file && file.deleted_at == null && !processedFileIds.has(file.id))
    .forEach((file, index) => {
      addPartyRowsForFile({
        sourceRecord: buildPublicSourceRecord(file),
        file,
        sourceName: "public.files fallback",
        originalIndex: index
      });
    });

  const activeExistingClients = existingClients.filter(row => row && row.deleted_at == null);
  const activeExistingFileParties = existingFileParties.filter(row => row && row.deleted_at == null);
  const sourceFields = sourceFieldsFromState(state);
  const manualDecisionItems = [
    ...ambiguousFiles.map(item => ({ type: "ambiguous_file", legacyId: item.legacyId, candidates: item.candidates })),
    ...unmatchedFiles.map(item => ({ type: "unmatched_file", legacyId: item.legacyId, lookupKey: item.lookupKey })),
    ...ambiguousClients.map(item => ({ type: "ambiguous_client", file: item.file, name: item.name, candidates: item.candidates })),
    ...invalidTaxIds.map(item => ({ type: "invalid_identifier", file: item.file, name: item.name, identifier: item.identifier })),
    ...emptyNameParties.map(item => ({ type: "empty_party_name", file: item.file, partyType: item.partyType, side: item.side }))
  ];

  return {
    summary: {
      stateFilesCount: source.files.length,
      stateCasesCount: source.cases.length,
      sourceUniqueFileCount: source.canonical.length,
      sourceDuplicateFileCount: source.duplicates.length,
      publicFilesCount: files.filter(file => file && file.deleted_at == null).length,
      sourceMatchedFileCount: matchedFiles.length,
      sourceUnmatchedFileCount: unmatchedFiles.length,
      sourceAmbiguousFileCount: ambiguousFiles.length,
      existingClientCount: activeExistingClients.length,
      existingFilePartyCount: activeExistingFileParties.length,
      plannedClientCreateCount: clientsToCreate.size,
      plannedFilePartyCreateCount: createFilePartyCount,
      plannedFilePartyUpdateCount: updateFilePartyCount,
      alreadyExistingFilePartyCount,
      plannedFilePartyRowCount: rows.length,
      skippedCount: skipped.length,
      ambiguousClientCount: ambiguousClients.length,
      invalidIdentifierCount: invalidTaxIds.length,
      emptyNamePartyCount: emptyNameParties.length,
      nameOnlyClientMatchCount: nameOnlyClientMatches.length,
      manualDecisionCount: manualDecisionItems.length
    },
    source,
    rows,
    clientsToCreate: [...clientsToCreate.values()],
    matchedFiles,
    unmatchedFiles,
    ambiguousFiles,
    ambiguousClients,
    invalidTaxIds,
    emptyNameParties,
    nameOnlyClientMatches,
    skipped,
    sourceFields,
    clientTypeDistribution: Object.fromEntries(clientTypeCounts),
    sourcePriorityDistribution: Object.fromEntries(sourcePriorityCounts),
    manualDecisionItems,
    fieldMapping: partyFieldMapping,
    roleMapping: partyRoleMapping,
    schemaExpectations: {
      clients: ["id", "legacy_id", "name", "national_id", "tax_id", "phone", "email", "client_type", "import_batch_id", "metadata", "deleted_at"],
      file_parties: ["id", "file_id", "client_id", "legacy_id", "party_type", "side", "role", "role_label", "name", "tax_id", "is_primary", "import_batch_id", "metadata", "deleted_at"],
      files: ["id", "legacy_id", "display_id", "file_no", "court_or_office", "client_name", "opponent_name", "metadata", "deleted_at"]
    }
  };
}

export function publicPartiesPlanReport(plan) {
  return {
    summary: plan.summary,
    schemaExpectations: plan.schemaExpectations,
    sourceFields: plan.sourceFields,
    fieldMapping: plan.fieldMapping,
    roleMapping: plan.roleMapping,
    clientTypeDistribution: plan.clientTypeDistribution,
    sourcePriorityDistribution: plan.sourcePriorityDistribution,
    duplicateSourceFiles: plan.source.duplicates,
    generatedSourceLegacyIds: plan.source.generatedLegacyIds,
    matchedFiles: plan.matchedFiles.slice(0, 50),
    unmatchedFiles: plan.unmatchedFiles,
    ambiguousFiles: plan.ambiguousFiles,
    ambiguousClients: plan.ambiguousClients,
    invalidTaxIds: plan.invalidTaxIds,
    emptyNameParties: plan.emptyNameParties,
    nameOnlyClientMatches: plan.nameOnlyClientMatches,
    skipped: plan.skipped,
    manualDecisionItems: plan.manualDecisionItems,
    plannedClients: plan.clientsToCreate.map(item => ({
      legacyId: item.row.legacy_id,
      name: item.row.name,
      clientType: item.row.client_type,
      nationalId: item.row.national_id,
      taxId: item.row.tax_id,
      email: item.row.email,
      phone: item.row.phone,
      action: item.action
    })),
    plannedFileParties: plan.rows.map(item => ({
      legacyId: item.row.legacy_id,
      action: item.action,
      fileId: item.row.file_id,
      clientId: item.row.client_id,
      plannedClientLegacyId: item.plannedClientLegacyId,
      name: item.row.name,
      partyType: item.row.party_type,
      side: item.row.side,
      roleLabel: item.row.role_label,
      isPrimary: item.row.is_primary,
      clientMatchType: item.clientMatch.matchType,
      sourceName: item.sourceName
    }))
  };
}

export async function readPartiesMigrationInputs({
  inputPath = "",
  useServiceRole = true,
  includeExisting = true
} = {}) {
  const state = inputPath
    ? readStateFromFile(inputPath)
    : await readStateFromSupabase({ serviceRole: useServiceRole });

  let files = [];
  let existingClients = [];
  let existingFileParties = [];
  const warnings = [];

  try {
    files = await readFilesForParties({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Dosya listesi okunamadi: ${error.message}`);
  }

  if (includeExisting) {
    try {
      existingClients = await readExistingClients({ serviceRole: useServiceRole });
    } catch (error) {
      warnings.push(`Mevcut clients okunamadi: ${error.message}`);
    }

    try {
      existingFileParties = await readExistingFileParties({ serviceRole: useServiceRole });
    } catch (error) {
      warnings.push(`Mevcut file_parties okunamadi: ${error.message}`);
    }
  }

  return { state, files, existingClients, existingFileParties, warnings };
}

export function metadataForInsert(row = {}, batchId) {
  return {
    ...(row.metadata || {}),
    importBatchId: batchId,
    createdByImportBatchId: batchId
  };
}

export function metadataForUpdate(existing = {}, row = {}, batchId) {
  return {
    ...(existing.metadata || {}),
    ...(row.metadata || {}),
    importBatchId: existing.metadata?.importBatchId || row.metadata?.importBatchId || batchId,
    lastPartiesImportBatchId: batchId
  };
}

export { loadEnvFile, writeJsonReport };
