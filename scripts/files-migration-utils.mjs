import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const appStateStorageKey = "hukukBurosuTakipDemo.v2";
export const defaultReportPath = path.join(process.cwd(), "work", "files-migration-dry-run-report.json");

export function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const result = { flags: new Set(), values: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (!result.values.input) result.values.input = arg;
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=");
    if (inlineValue !== undefined) {
      result.values[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result.values[rawKey] = next;
      index += 1;
    } else {
      result.flags.add(rawKey);
    }
  }
  return result;
}

export function safeJsonParse(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function ensureDir(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

export function writeJsonReport(filePath, report) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function createSupabaseClient({ serviceRole = false, accessToken = process.env.SUPABASE_ACCESS_TOKEN } = {}) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("SUPABASE_URL eksik.");
  const key = serviceRole ? serviceRoleKey : anonKey;
  if (!key) {
    throw new Error(serviceRole
      ? "SUPABASE_SERVICE_ROLE_KEY eksik. Bu anahtar yalnizca yerel .env icinden okunmalidir."
      : "SUPABASE_ANON_KEY eksik.");
  }

  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  };

  if (!serviceRole && accessToken) {
    options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
  }

  return createClient(url, key, options);
}

export async function readStateFromSupabase({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("settings")
    .select("setting_value")
    .eq("setting_key", appStateStorageKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`settings state okunamadi: ${error.message}`);
  if (!data?.setting_value) throw new Error(`${appStateStorageKey} settings kaydi bulunamadi.`);
  return data.setting_value;
}

export function readStateFromFile(inputPath) {
  const absolutePath = path.resolve(inputPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Input dosyasi bulunamadi: ${absolutePath}`);
  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const storage = raw.localStorage || raw.settings || {};
  return raw.data
    || raw.state
    || safeJsonParse(storage[appStateStorageKey])
    || raw.setting_value
    || raw;
}

export async function readProfiles({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, is_active, deleted_at")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  if (error) throw new Error(`profiles okunamadi: ${error.message}`);
  return data || [];
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeName(value) {
  return normalizeText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

export function normalizeResponsibleNameKey(value) {
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
    .trim()
    .replace(/^(avukat|av)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTaxId(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

export function hashValue(value, size = 12) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, size);
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];
  const tr = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (tr) {
    const [, day, month, year] = tr;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function isEnforcementFile(file = {}) {
  return [file.fileType, file.type, file.recordKind, file.followType, file.followUpType]
    .filter(Boolean)
    .some(value => normalizeName(value).includes("icra"));
}

export function normalizeFileType(file = {}) {
  const source = normalizeName(file.fileType || file.type || file.recordKind);
  if (source.includes("icra")) return "İcra Dosyası";
  if (source.includes("ceza")) return "Ceza Dosyası";
  return "Hukuk Dosyası";
}

export function normalizeRecordKind(file = {}) {
  return isEnforcementFile(file) ? "enforcement" : "lawsuit";
}

export function normalizePartyRole(role, fallback = "") {
  const text = normalizeText(role || fallback);
  const normalized = normalizeName(text);
  if (normalized.includes("davaci")) return "Davacı";
  if (normalized.includes("davali")) return "Davalı";
  if (normalized.includes("alacakli")) return "Alacaklı";
  if (normalized.includes("borclu")) return "Borçlu";
  if (normalized.includes("sanik")) return "Sanık";
  if (normalized.includes("musteki") || normalized.includes("sikayetci")) return "Müşteki";
  return text || fallback || "Diğer";
}

export function partyTypeFromRole(role, fallbackType) {
  const normalized = normalizeName(role);
  if (normalized.includes("davaci")) return "plaintiff";
  if (normalized.includes("davali")) return "defendant";
  if (normalized.includes("alacakli")) return "creditor";
  if (normalized.includes("borclu")) return "debtor";
  if (normalized.includes("sanik")) return "accused";
  if (normalized.includes("musteki") || normalized.includes("sikayetci")) return "complainant";
  return fallbackType || "other";
}

export function inferClientType(name, taxId) {
  const normalized = normalizeName(name);
  const normalizedTax = normalizeTaxId(taxId);
  if (/\b(a\.?s\.?|anonim|limited|ltd|sti|sirket|sanayi|ticaret|kooperatif|bankasi|belediyesi)\b/i.test(normalized)) {
    return "company";
  }
  if (normalizedTax.length === 10) return "company";
  if (normalizedTax.length === 11) return "person";
  return "unknown";
}

export function normalizeParty(party = {}, fallbackRole = "", fallbackType = "other", side = "other") {
  const name = normalizeText(party.name || party.client || party.opponent || party.creditor || party.debtor);
  const taxId = normalizeTaxId(party.taxId || party.tcVkn || party.tax_id || party.creditorTaxId || party.debtorTaxId);
  const roleLabel = normalizePartyRole(party.role || party.partyRole, fallbackRole);
  return {
    name,
    taxId,
    roleLabel,
    partyType: partyTypeFromRole(roleLabel, fallbackType),
    side,
    phone: normalizeText(party.phone),
    email: normalizeText(party.email)
  };
}

export function getClientParties(file = {}) {
  if (isEnforcementFile(file)) return [];
  if (asArray(file.clientParties).length) {
    return asArray(file.clientParties)
      .map(party => normalizeParty(party, file.partyRole || "Davacı", "client", "client"))
      .filter(party => party.name || party.taxId);
  }
  const party = normalizeParty({
    name: file.clientName || file.client,
    taxId: file.taxId || file.clientTaxId,
    role: file.partyRole
  }, file.partyRole || "Davacı", "client", "client");
  return party.name || party.taxId ? [party] : [];
}

export function getOpponentParties(file = {}) {
  if (isEnforcementFile(file)) return [];
  if (asArray(file.opponentParties).length) {
    return asArray(file.opponentParties)
      .map(party => normalizeParty(party, party.role || "Davalı", "opponent", "opponent"))
      .filter(party => party.name || party.taxId);
  }
  const party = normalizeParty({
    name: file.opponentName || file.opponent,
    taxId: file.opponentTaxId,
    role: file.opponentRole
  }, file.opponentRole || "Davalı", "opponent", "opponent");
  return party.name || party.taxId ? [party] : [];
}

export function getCreditorParties(file = {}) {
  if (!isEnforcementFile(file)) return [];
  if (asArray(file.creditorParties).length) {
    return asArray(file.creditorParties)
      .map(party => normalizeParty(party, "Alacaklı", "creditor", "creditor"))
      .filter(party => party.name || party.taxId);
  }
  const party = normalizeParty({
    name: file.clientName || file.creditor || file.client,
    taxId: file.creditorTaxId || file.taxId
  }, "Alacaklı", "creditor", "creditor");
  return party.name || party.taxId ? [party] : [];
}

export function getDebtorParties(file = {}) {
  if (!isEnforcementFile(file)) return [];
  if (asArray(file.debtors).length) {
    return asArray(file.debtors)
      .map(party => normalizeParty(party, "Borçlu", "debtor", "debtor"))
      .filter(party => party.name || party.taxId);
  }
  const party = normalizeParty({
    name: file.opponentName || file.debtor || file.opponent,
    taxId: file.debtorTaxId || file.opponentTaxId
  }, "Borçlu", "debtor", "debtor");
  return party.name || party.taxId ? [party] : [];
}

export function collectParties(file = {}) {
  return [
    ...getClientParties(file),
    ...getOpponentParties(file),
    ...getCreditorParties(file),
    ...getDebtorParties(file)
  ];
}

export function legacyIdForFile(file = {}, sourceName = "record", index = 0) {
  const explicit = normalizeText(file.legacy_id || file.legacyId || file.id || file.fileId || file.display_id || file.displayId);
  if (explicit) return explicit;
  const fallback = [
    file.fileType || file.type,
    file.courtOrOffice || file.court || file.office,
    file.fileNo || file.file,
    file.clientName || file.client || file.creditor,
    file.opponentName || file.opponent || file.debtor
  ].map(normalizeText).join("|");
  return `generated-${sourceName}-${index + 1}-${hashValue(fallback || JSON.stringify(file))}`;
}

export function canonicalFilesFromState(state = {}) {
  const files = asArray(state.files);
  const cases = asArray(state.cases);
  const seen = new Map();
  const duplicates = [];
  const generatedLegacyIds = [];

  function addRecord(record, sourceName, index) {
    const legacyId = legacyIdForFile(record, sourceName, index);
    const originalHadLegacyId = Boolean(normalizeText(record.legacy_id || record.legacyId || record.id || record.fileId || record.display_id || record.displayId));
    if (!originalHadLegacyId) generatedLegacyIds.push({ source: sourceName, index, legacyId });
    if (seen.has(legacyId)) {
      duplicates.push({
        legacyId,
        keptSource: seen.get(legacyId).sourceName,
        duplicateSource: sourceName,
        duplicateIndex: index
      });
      return;
    }
    seen.set(legacyId, { record, sourceName, index, legacyId });
  }

  files.forEach((record, index) => addRecord(record, "files", index));
  cases.forEach((record, index) => addRecord(record, "cases", index));

  return {
    files,
    cases,
    canonical: [...seen.values()],
    duplicates,
    generatedLegacyIds,
    canonicalSource: files.length ? "state.files, eksik eski kayitlar icin state.cases tamamlayici" : "state.cases"
  };
}

export function buildProfileMaps(profiles = []) {
  const byId = new Map();
  const byDisplayName = new Map();
  const byResponsibleNameKey = new Map();
  const duplicateDisplayNames = [];

  function addResponsibleKey(key, profile, source) {
    if (!key || !profile?.id) return;
    const existing = byResponsibleNameKey.get(key) || [];
    if (!existing.some(item => item.profile.id === profile.id)) {
      existing.push({ profile, source });
      byResponsibleNameKey.set(key, existing);
    }
  }

  profiles
    .filter(profile => profile && profile.deleted_at == null && profile.is_active !== false)
    .forEach(profile => {
      byId.set(profile.id, profile);
      const key = normalizeName(profile.display_name);
      if (!key) return;
      if (byDisplayName.has(key)) duplicateDisplayNames.push(profile.display_name);
      else byDisplayName.set(key, profile);

      addResponsibleKey(normalizeResponsibleNameKey(profile.display_name), profile, "display_name");
      addResponsibleKey(normalizeResponsibleNameKey(profile.email), profile, "email");

      const emailLocalPart = normalizeText(profile.email).split("@")[0];
      addResponsibleKey(normalizeResponsibleNameKey(emailLocalPart), profile, "email_local_part");
    });

  const explicitResponsibleAliases = new Map([
    ["cagatay", "Av. Çağatay Tepe"],
    ["çağatay", "Av. Çağatay Tepe"],
    ["çağatay tepe", "Av. Çağatay Tepe"],
    ["av. çağatay tepe", "Av. Çağatay Tepe"],
    ["ilayda", "Av. İlayda Karakaş Tepe"],
    ["ilayda karakaş tepe", "Av. İlayda Karakaş Tepe"],
    ["ilayda karakas tepe", "Av. İlayda Karakaş Tepe"],
    ["av. ilayda karakaş tepe", "Av. İlayda Karakaş Tepe"],
    ["yusuf", "Av. Yusuf Abdullah Ballı"],
    ["yusuf ballı", "Av. Yusuf Abdullah Ballı"],
    ["yusuf abdullah ballı", "Av. Yusuf Abdullah Ballı"],
    ["yusuf abdullah balli", "Av. Yusuf Abdullah Ballı"],
    ["av. yusuf abdullah ballı", "Av. Yusuf Abdullah Ballı"]
  ]);

  explicitResponsibleAliases.forEach((targetDisplayName, alias) => {
    const profile = byDisplayName.get(normalizeName(targetDisplayName));
    if (profile) {
      addResponsibleKey(normalizeResponsibleNameKey(alias), profile, "explicit_dictionary");
    }
  });

  return { byId, byDisplayName, byResponsibleNameKey, duplicateDisplayNames };
}

export function resolveResponsibleProfile(file = {}, profileMaps) {
  const explicitId = normalizeText(file.responsibleUserId || file.responsible_profile_id || file.responsibleProfileId);
  if (isUuid(explicitId) && profileMaps.byId.has(explicitId)) {
    return {
      responsibleProfileId: explicitId,
      responsibleName: profileMaps.byId.get(explicitId).display_name,
      matchType: "uuid"
    };
  }

  const name = normalizeText(file.responsibleLawyer || file.lawyer || file.responsibleName);
  const key = normalizeResponsibleNameKey(name);
  const matches = profileMaps.byResponsibleNameKey.get(key) || [];
  const uniqueMatches = [...new Map(matches.map(item => [item.profile.id, item])).values()];

  if (uniqueMatches.length > 1) {
    return {
      responsibleProfileId: null,
      responsibleName: name || null,
      matchType: "ambiguous",
      normalizedKey: key,
      candidates: uniqueMatches.map(item => ({
        profileId: item.profile.id,
        displayName: item.profile.display_name,
        email: item.profile.email || null,
        source: item.source
      }))
    };
  }

  const match = uniqueMatches[0];
  const profile = match?.profile;
  return {
    responsibleProfileId: profile?.id || null,
    responsibleName: name || profile?.display_name || null,
    matchType: profile ? match.source : "unmatched",
    normalizedKey: key
  };
}

export function buildMigrationPlan(state = {}, profiles = [], { batchId = null } = {}) {
  const profileMaps = buildProfileMaps(profiles);
  const source = canonicalFilesFromState(state);
  const clientMap = new Map();
  const files = [];
  const fileParties = [];
  const matchedResponsibleLawyers = [];
  const unmatchedResponsibleLawyers = [];
  const ambiguousResponsibleLawyers = [];
  const nameMergeRisks = [];

  function clientKeyForParty(party) {
    if (party.taxId) return `tax:${party.taxId}`;
    const key = `name:${normalizeName(party.name)}`;
    if (party.name) nameMergeRisks.push({
      name: party.name,
      reason: "TC/VKN yok; isim bazli eslestirme yanlis birlestirme riski tasir."
    });
    return key;
  }

  source.canonical.forEach(({ record, sourceName, index, legacyId }) => {
    const parties = collectParties(record);
    const responsible = resolveResponsibleProfile(record, profileMaps);
    if (responsible.responsibleProfileId) {
      matchedResponsibleLawyers.push({
        legacyId,
        responsibleLawyer: responsible.responsibleName,
        responsibleProfileId: responsible.responsibleProfileId,
        matchedDisplayName: profileMaps.byId.get(responsible.responsibleProfileId)?.display_name || null,
        matchType: responsible.matchType
      });
    }
    if (responsible.matchType === "unmatched" && responsible.responsibleName) {
      unmatchedResponsibleLawyers.push({
        legacyId,
        responsibleLawyer: responsible.responsibleName,
        normalizedKey: responsible.normalizedKey
      });
    }
    if (responsible.matchType === "ambiguous" && responsible.responsibleName) {
      ambiguousResponsibleLawyers.push({
        legacyId,
        responsibleLawyer: responsible.responsibleName,
        normalizedKey: responsible.normalizedKey,
        candidates: responsible.candidates
      });
    }

    const primaryClientParty = parties.find(party => ["client", "creditor", "plaintiff", "complainant"].includes(party.partyType))
      || parties.find(party => party.side === "client" || party.side === "creditor")
      || parties[0];

    const opponentParty = parties.find(party => party.side === "opponent" || party.side === "debtor");

    const fileRow = {
      legacy_id: legacyId,
      display_id: normalizeText(record.display_id || record.displayId || record.id || legacyId),
      record_kind: normalizeRecordKind(record),
      file_type: normalizeFileType(record),
      follow_type: normalizeText(record.followType || record.followUpType) || null,
      file_no: normalizeText(record.fileNo || record.file) || null,
      court_or_office: normalizeText(record.courtOrOffice || record.court || record.office) || null,
      decision_no: normalizeText(record.decisionNo || record.decision) || null,
      subject: normalizeText(record.subject) || null,
      status: normalizeText(record.status) || "Açık",
      opening_date: normalizeDate(record.openingDate || record.followUpDate || record.createdAt),
      responsible_profile_id: responsible.responsibleProfileId,
      responsible_name: responsible.responsibleName,
      client_name: normalizeText(record.clientName || record.client || record.creditor || primaryClientParty?.name) || null,
      opponent_name: normalizeText(record.opponentName || record.opponent || record.debtor || opponentParty?.name) || null,
      description: normalizeText(record.description || record.note) || null,
      account_info: record.accountInfo && typeof record.accountInfo === "object" ? record.accountInfo : {},
      instrument_info: record.instrumentInfo && typeof record.instrumentInfo === "object" ? record.instrumentInfo : {},
      metadata: {
        source: "settings-json-files-migration",
        importBatchId: batchId,
        originalSource: sourceName,
        originalIndex: index,
        tags: asArray(record.tags),
        priority: record.priority || null,
        notes: asArray(record.notes),
        timeline: asArray(record.timeline),
        embeddedCollectionsCount: asArray(record.collections).length,
        embeddedDocumentsCount: asArray(record.documents).length,
        supportingDocumentsCount: asArray(record.supportingDocuments).length
      }
    };

    files.push({ row: fileRow, sourceRecord: record, parties });

    parties.forEach((party, partyIndex) => {
      const clientKey = clientKeyForParty(party);
      if (!clientMap.has(clientKey)) {
        clientMap.set(clientKey, {
          key: clientKey,
          row: {
            legacy_id: party.taxId ? `tax-${party.taxId}` : `name-${hashValue(normalizeName(party.name), 16)}`,
            name: party.name || "Isimsiz taraf",
            tax_id: party.taxId || null,
            phone: party.phone || null,
            email: party.email || null,
            client_type: inferClientType(party.name, party.taxId),
            notes: null,
            metadata: {
              source: "settings-json-files-migration",
              importBatchId: batchId,
              matchKey: clientKey,
              mergeRisk: !party.taxId
            }
          }
        });
      }

      fileParties.push({
        fileLegacyId: legacyId,
        clientKey,
        row: {
          legacy_id: `${legacyId}:party:${partyIndex + 1}:${hashValue(`${party.partyType}|${party.side}|${party.name}|${party.taxId}`, 10)}`,
          party_type: party.partyType,
          side: party.side,
          role: party.roleLabel,
          role_label: party.roleLabel,
          name: party.name || "Isimsiz taraf",
          tax_id: party.taxId || null,
          phone: party.phone || null,
          email: party.email || null,
          is_primary: partyIndex === 0,
          metadata: {
            source: "settings-json-files-migration",
            importBatchId: batchId,
            sourceSide: party.side
          }
        }
      });
    });
  });

  const uniqueNameMergeRisks = [...new Map(nameMergeRisks.map(item => [normalizeName(item.name), item])).values()];
  const responsibleNameMappings = [...new Map(matchedResponsibleLawyers.map(item => {
    const key = normalizeResponsibleNameKey(item.responsibleLawyer);
    return [key, {
      sourceName: item.responsibleLawyer,
      normalizedKey: key,
      targetDisplayName: item.matchedDisplayName,
      targetProfileId: item.responsibleProfileId,
      matchType: item.matchType,
      count: matchedResponsibleLawyers.filter(match => normalizeResponsibleNameKey(match.responsibleLawyer) === key).length
    }];
  })).values()];
  const uniqueUnmatchedResponsibleLawyers = [...new Map(unmatchedResponsibleLawyers.map(item => [
    item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer),
    {
      responsibleLawyer: item.responsibleLawyer,
      normalizedKey: item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer),
      count: unmatchedResponsibleLawyers.filter(match => (match.normalizedKey || normalizeResponsibleNameKey(match.responsibleLawyer)) === (item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer))).length
    }
  ])).values()];
  const uniqueAmbiguousResponsibleLawyers = [...new Map(ambiguousResponsibleLawyers.map(item => [
    item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer),
    {
      responsibleLawyer: item.responsibleLawyer,
      normalizedKey: item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer),
      candidates: item.candidates,
      count: ambiguousResponsibleLawyers.filter(match => (match.normalizedKey || normalizeResponsibleNameKey(match.responsibleLawyer)) === (item.normalizedKey || normalizeResponsibleNameKey(item.responsibleLawyer))).length
    }
  ])).values()];

  return {
    summary: {
      filesArrayCount: source.files.length,
      casesArrayCount: source.cases.length,
      activeProfileCount: profiles.filter(profile => profile && profile.deleted_at == null && profile.is_active !== false).length,
      canonicalFileCount: files.length,
      duplicateFileCount: source.duplicates.length,
      generatedLegacyIdCount: source.generatedLegacyIds.length,
      partyRowCount: fileParties.length,
      clientRowCount: clientMap.size,
      responsibleMatchedCount: files.filter(item => item.row.responsible_profile_id).length,
      responsibleUnmatchedCount: unmatchedResponsibleLawyers.length,
      responsibleAmbiguousCount: ambiguousResponsibleLawyers.length,
      canonicalSource: source.canonicalSource
    },
    files,
    clients: [...clientMap.values()],
    fileParties,
    duplicateFiles: source.duplicates,
    generatedLegacyIds: source.generatedLegacyIds,
    matchedResponsibleLawyers,
    unmatchedResponsibleLawyers,
    ambiguousResponsibleLawyers,
    uniqueUnmatchedResponsibleLawyers,
    uniqueAmbiguousResponsibleLawyers,
    responsibleNameMappings,
    duplicateProfileDisplayNames: profileMaps.duplicateDisplayNames,
    nameMergeRisks: uniqueNameMergeRisks
  };
}

export function publicPlanReport(plan) {
  return {
    summary: plan.summary,
    duplicateFiles: plan.duplicateFiles,
    generatedLegacyIds: plan.generatedLegacyIds,
    matchedResponsibleLawyers: plan.matchedResponsibleLawyers,
    unmatchedResponsibleLawyers: plan.unmatchedResponsibleLawyers,
    ambiguousResponsibleLawyers: plan.ambiguousResponsibleLawyers,
    uniqueUnmatchedResponsibleLawyers: plan.uniqueUnmatchedResponsibleLawyers,
    uniqueAmbiguousResponsibleLawyers: plan.uniqueAmbiguousResponsibleLawyers,
    responsibleNameMappings: plan.responsibleNameMappings,
    duplicateProfileDisplayNames: plan.duplicateProfileDisplayNames,
    nameMergeRisks: plan.nameMergeRisks,
    fieldMapping: [
      { json: "id / legacy_id / display_id", target: "files.legacy_id, files.display_id", risk: "Eksikse deterministic generated-* legacy_id uretilir." },
      { json: "fileType / type", target: "files.file_type", risk: "Eski Hukuk/Ceza/Icra adlari ana tipe normalize edilir." },
      { json: "followType / followUpType", target: "files.follow_type", risk: "Sadece icra dosyalarinda anlamlidir." },
      { json: "fileNo / file", target: "files.file_no", risk: "Format farklari korunur, yeniden bicimlendirilmez." },
      { json: "courtOrOffice / court / office", target: "files.court_or_office", risk: "Mahkeme ve icra dairesi ayni kolonda saklanir." },
      { json: "clientName, clientParties, creditorParties", target: "clients + file_parties", risk: "TC/VKN yoksa isim bazli eslestirme risklidir." },
      { json: "opponentName, opponentParties, debtors", target: "clients + file_parties", risk: "Coklu taraflarda sira ve rol etiketi korunur." },
      { json: "responsibleLawyer / responsibleUserId", target: "files.responsible_profile_id, files.responsible_name", risk: "Isim profile display_name ile eslesmezse UUID bos kalir." },
      { json: "accountInfo", target: "files.account_info", risk: "JSON olarak korunur." },
      { json: "instrumentInfo", target: "files.instrument_info", risk: "JSON olarak korunur." },
      { json: "notes / timeline / tags / embedded docs", target: "files.metadata", risk: "Bu asamada ayri not/belge tablolarina tasinmaz." }
    ]
  };
}
