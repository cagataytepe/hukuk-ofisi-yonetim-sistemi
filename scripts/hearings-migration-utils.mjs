import {
  asArray,
  buildProfileMaps,
  createSupabaseClient,
  hashValue,
  isUuid,
  normalizeDate,
  normalizeName,
  normalizeText,
  readStateFromFile,
  readStateFromSupabase,
  resolveResponsibleProfile,
  safeJsonParse,
  writeJsonReport
} from "./files-migration-utils.mjs";

export const defaultHearingsDryRunReportPath = "work/hearings-migration-dry-run-report.json";

export const hearingFieldMapping = [
  { json: "id", target: "hearings.legacy_id", transform: "trim; yoksa deterministic generated-*", risk: "Bos id varsa geri izleme generated id'ye baglanir." },
  { json: "fileId", target: "hearings.file_id", transform: "files.legacy_id ile eslestirilir", risk: "Dosya import edilmemisse durusma atlanir." },
  { json: "file", target: "hearings.file_id", transform: "files.display_id / legacy_id / file_no ile eslestirilir", risk: "Ayni gorunen id birden fazla dosyada varsa ambiguous olur." },
  { json: "court", target: "hearings.court", transform: "trim; dosya eslestirmesinde court+caseFile anahtarina da katilir", risk: "Mahkeme adindaki yazim farklari eslesmeyi zorlastirir." },
  { json: "caseFile", target: "hearings.case_file_no", transform: "trim; dosya eslestirmesinde file_no olarak kullanilir", risk: "Esas no format farklari elle kontrol isteyebilir." },
  { json: "date", target: "hearings.hearing_date", transform: "yyyy-mm-dd veya gg.aa.yyyy -> date", risk: "Gecersiz tarih kayit import disi kalir." },
  { json: "time", target: "hearings.hearing_time", transform: "H:mm / HH:mm / HH:mm:ss -> HH:mm:ss", risk: "Gecersiz saat kayit import disi kalir." },
  { json: "client", target: "hearings.client_name", transform: "trim", risk: "Sadece metin olarak korunur." },
  { json: "partyRole", target: "hearings.party_role", transform: "trim", risk: "Rol sozlugu uygulanmaz, mevcut metin korunur." },
  { json: "excuseType", target: "hearings.excuse_type", transform: "trim", risk: "Bos deger null kalir." },
  { json: "person", target: "hearings.participant_profile_id / participant_name", transform: "profiles display_name/email normalize eslesmesi", risk: "Eslesmezse UUID null kalir, metin korunur." },
  { json: "note", target: "hearings.note", transform: "trim", risk: "Bos deger null kalir." },
  { json: "outcome", target: "hearings.outcome", transform: "string ise {text}; object ise aynen", risk: "Eski serbest metin JSON icine alinir." },
  { json: "createdAt", target: "hearings.metadata.originalCreatedAt", transform: "metadata icinde korunur", risk: "Ana created_at kolonuna yazilmaz." },
  { json: "updatedAt", target: "hearings.metadata.originalUpdatedAt", transform: "metadata icinde korunur", risk: "Ana updated_at import/update zamanini temsil eder." },
  { json: "excuseDate", target: "hearings.metadata.excuseDate", transform: "metadata icinde korunur", risk: "Ayrica kolon yok." },
  { json: "nextDate", target: "hearings.metadata.nextDate", transform: "metadata icinde korunur", risk: "Ayrica kolon yok." }
];

export function readHearingsFromState(state = {}) {
  return asArray(state.hearings);
}

export function normalizeTime(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function normalizeFileLookupKey(value) {
  return normalizeText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCourtCaseKey(court, caseFile) {
  const courtKey = normalizeName(court).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const caseKey = normalizeFileLookupKey(caseFile);
  return courtKey && caseKey ? `${courtKey}|${caseKey}` : "";
}

export function legacyIdForHearing(hearing = {}, index = 0) {
  const explicit = normalizeText(hearing.legacy_id || hearing.legacyId || hearing.id);
  if (explicit) return explicit;
  const fallback = [
    hearing.fileId,
    hearing.file,
    hearing.court,
    hearing.caseFile,
    hearing.date,
    hearing.time,
    hearing.person
  ].map(normalizeText).join("|");
  return `generated-hearing-${index + 1}-${hashValue(fallback || JSON.stringify(hearing), 12)}`;
}

export async function readProfilesForHearings({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, is_active, deleted_at")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  if (error) throw new Error(`profiles okunamadi: ${error.message}`);
  return data || [];
}

export async function readFilesForHearings({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("files")
    .select("id, legacy_id, display_id, file_no, court_or_office, deleted_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`files okunamadi: ${error.message}`);
  return data || [];
}

export async function readExistingHearings({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const extendedSelect = "id, legacy_id, file_id, court, case_file_no, hearing_date, hearing_time, participant_profile_id, participant_name, attendee_profile_id, attendee_name, client_name, party_role, excuse_type, note, status, import_batch_id, metadata, deleted_at";
  const baseSelect = "id, legacy_id, file_id, court, case_file_no, hearing_date, hearing_time, attendee_profile_id, attendee_name, client_name, party_role, excuse_type, note, metadata, deleted_at";

  const { data, error } = await supabase
    .from("hearings")
    .select(extendedSelect)
    .is("deleted_at", null)
    .order("hearing_date", { ascending: true });

  if (error && /participant_profile_id|participant_name|import_batch_id|status/i.test(error.message || "")) {
    const fallback = await supabase
      .from("hearings")
      .select(baseSelect)
      .is("deleted_at", null)
      .order("hearing_date", { ascending: true });
    if (fallback.error) throw new Error(`hearings okunamadi: ${fallback.error.message}`);
    return fallback.data || [];
  }

  if (error) throw new Error(`hearings okunamadi: ${error.message}`);
  return data || [];
}

function addToMultiMap(map, key, file, source) {
  if (!key || !file?.id) return;
  const existing = map.get(key) || [];
  if (!existing.some(item => item.file.id === file.id)) {
    existing.push({ file, source });
    map.set(key, existing);
  }
}

export function buildFileMaps(files = []) {
  const byLegacyId = new Map();
  const byDisplayOrLegacyOrNo = new Map();
  const byCourtCase = new Map();

  files
    .filter(file => file && file.deleted_at == null)
    .forEach(file => {
      const legacyKey = normalizeFileLookupKey(file.legacy_id);
      if (legacyKey) addToMultiMap(byLegacyId, legacyKey, file, "legacy_id");

      addToMultiMap(byDisplayOrLegacyOrNo, normalizeFileLookupKey(file.display_id), file, "display_id");
      addToMultiMap(byDisplayOrLegacyOrNo, legacyKey, file, "legacy_id");
      addToMultiMap(byDisplayOrLegacyOrNo, normalizeFileLookupKey(file.file_no), file, "file_no");
      addToMultiMap(byCourtCase, normalizeCourtCaseKey(file.court_or_office, file.file_no), file, "court_case");
    });

  return { byLegacyId, byDisplayOrLegacyOrNo, byCourtCase };
}

export function resolveHearingFile(hearing = {}, fileMaps) {
  const attempts = [
    { key: normalizeFileLookupKey(hearing.fileId), map: fileMaps.byLegacyId, source: "fileId->legacy_id" },
    { key: normalizeFileLookupKey(hearing.file), map: fileMaps.byDisplayOrLegacyOrNo, source: "file->display_id/legacy_id/file_no" },
    { key: normalizeCourtCaseKey(hearing.court, hearing.caseFile), map: fileMaps.byCourtCase, source: "court+caseFile" }
  ];

  for (const attempt of attempts) {
    if (!attempt.key) continue;
    const matches = attempt.map.get(attempt.key) || [];
    const uniqueMatches = [...new Map(matches.map(item => [item.file.id, item])).values()];
    if (uniqueMatches.length === 1) {
      return {
        fileId: uniqueMatches[0].file.id,
        fileLegacyId: uniqueMatches[0].file.legacy_id || null,
        matchType: attempt.source,
        matchedBy: uniqueMatches[0].source,
        lookupKey: attempt.key
      };
    }
    if (uniqueMatches.length > 1) {
      return {
        fileId: null,
        matchType: "ambiguous",
        attemptedBy: attempt.source,
        lookupKey: attempt.key,
        candidates: uniqueMatches.map(item => ({
          fileId: item.file.id,
          legacyId: item.file.legacy_id || null,
          displayId: item.file.display_id || null,
          fileNo: item.file.file_no || null,
          courtOrOffice: item.file.court_or_office || null,
          source: item.source
        }))
      };
    }
  }

  return {
    fileId: null,
    matchType: "unmatched",
    lookupKey: normalizeFileLookupKey(hearing.fileId || hearing.file || `${hearing.court || ""} ${hearing.caseFile || ""}`)
  };
}

function normalizeOutcome(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const text = normalizeText(value);
  return text ? { text } : {};
}

function valuesEqual(left, right) {
  return normalizeText(left ?? "") === normalizeText(right ?? "");
}

function existingMatchesRow(existing = {}, row = {}) {
  return valuesEqual(existing.file_id, row.file_id)
    && valuesEqual(existing.court, row.court)
    && valuesEqual(existing.case_file_no, row.case_file_no)
    && valuesEqual(existing.hearing_date, row.hearing_date)
    && valuesEqual(String(existing.hearing_time || "").slice(0, 8), row.hearing_time)
    && valuesEqual(existing.client_name, row.client_name)
    && valuesEqual(existing.party_role, row.party_role)
    && valuesEqual(existing.excuse_type, row.excuse_type)
    && valuesEqual(existing.participant_profile_id || existing.attendee_profile_id, row.participant_profile_id)
    && valuesEqual(existing.participant_name || existing.attendee_name, row.participant_name)
    && valuesEqual(existing.note, row.note);
}

export function buildExistingHearingMaps(existingHearings = []) {
  const byLegacyId = new Map();
  const byComposite = new Map();

  existingHearings
    .filter(row => row && row.deleted_at == null)
    .forEach(row => {
      const legacyKey = normalizeText(row.legacy_id);
      if (legacyKey) byLegacyId.set(legacyKey, row);
      const composite = [row.file_id, row.hearing_date, String(row.hearing_time || "").slice(0, 8), normalizeName(row.court)].join("|");
      if (row.file_id && row.hearing_date && row.hearing_time && row.court) byComposite.set(composite, row);
    });

  return { byLegacyId, byComposite };
}

export function buildHearingsMigrationPlan(state = {}, {
  files = [],
  profiles = [],
  existingHearings = [],
  batchId = "hearings-dry-run"
} = {}) {
  const hearings = readHearingsFromState(state);
  const profileMaps = buildProfileMaps(profiles);
  const fileMaps = buildFileMaps(files);
  const existingMaps = buildExistingHearingMaps(existingHearings);
  const seenLegacyIds = new Map();
  const rows = [];
  const duplicates = [];
  const matchedFiles = [];
  const unmatchedFiles = [];
  const ambiguousFiles = [];
  const matchedParticipants = [];
  const unmatchedParticipants = [];
  const ambiguousParticipants = [];
  const invalidDates = [];
  const invalidTimes = [];
  const skipped = [];
  let createCount = 0;
  let updateCount = 0;
  let alreadyExistingCount = 0;

  hearings.forEach((hearing, index) => {
    const legacyId = legacyIdForHearing(hearing, index);
    if (seenLegacyIds.has(legacyId)) {
      duplicates.push({
        legacyId,
        keptIndex: seenLegacyIds.get(legacyId),
        duplicateIndex: index
      });
      return;
    }
    seenLegacyIds.set(legacyId, index);

    const fileMatch = resolveHearingFile(hearing, fileMaps);
    if (fileMatch.fileId) {
      matchedFiles.push({ legacyId, fileId: fileMatch.fileId, fileLegacyId: fileMatch.fileLegacyId, matchType: fileMatch.matchType });
    } else if (fileMatch.matchType === "ambiguous") {
      ambiguousFiles.push({ legacyId, hearingFile: hearing.file || null, fileIdText: hearing.fileId || null, court: hearing.court || null, caseFile: hearing.caseFile || null, ...fileMatch });
    } else {
      unmatchedFiles.push({ legacyId, hearingFile: hearing.file || null, fileIdText: hearing.fileId || null, court: hearing.court || null, caseFile: hearing.caseFile || null, lookupKey: fileMatch.lookupKey });
    }

    const participant = resolveResponsibleProfile({ responsibleName: hearing.person }, profileMaps);
    const participantName = normalizeText(hearing.person);
    if (participant.responsibleProfileId) {
      matchedParticipants.push({
        legacyId,
        participantName,
        participantProfileId: participant.responsibleProfileId,
        matchedDisplayName: profileMaps.byId.get(participant.responsibleProfileId)?.display_name || null,
        matchType: participant.matchType
      });
    } else if (participant.matchType === "ambiguous" && participantName) {
      ambiguousParticipants.push({
        legacyId,
        participantName,
        normalizedKey: participant.normalizedKey,
        candidates: participant.candidates
      });
    } else if (participantName && !["katilim yok", "katılım yok"].includes(normalizeName(participantName))) {
      unmatchedParticipants.push({
        legacyId,
        participantName,
        normalizedKey: participant.normalizedKey
      });
    }

    const hearingDate = normalizeDate(hearing.date);
    if (!hearingDate) invalidDates.push({ legacyId, value: hearing.date || null });

    const hearingTime = normalizeTime(hearing.time);
    if (normalizeText(hearing.time) && !hearingTime) invalidTimes.push({ legacyId, value: hearing.time || null });

    const row = {
      legacy_id: legacyId,
      file_id: fileMatch.fileId,
      court: normalizeText(hearing.court) || null,
      case_file_no: normalizeText(hearing.caseFile) || null,
      hearing_date: hearingDate,
      hearing_time: hearingTime,
      client_name: normalizeText(hearing.client) || null,
      party_role: normalizeText(hearing.partyRole) || null,
      excuse_type: normalizeText(hearing.excuseType) || null,
      attendee_profile_id: participant.responsibleProfileId,
      attendee_name: participantName || null,
      participant_profile_id: participant.responsibleProfileId,
      participant_name: participantName || null,
      note: normalizeText(hearing.note) || null,
      outcome: normalizeOutcome(hearing.outcome),
      status: normalizeText(hearing.status) || "scheduled",
      import_batch_id: batchId,
      metadata: {
        source: "settings-json-hearings-migration",
        importBatchId: batchId,
        originalIndex: index,
        originalFileId: hearing.fileId || null,
        originalFile: hearing.file || null,
        originalCreatedAt: hearing.createdAt || null,
        originalUpdatedAt: hearing.updatedAt || null,
        excuseDate: hearing.excuseDate || null,
        nextDate: hearing.nextDate || null,
        fileMatchType: fileMatch.matchType,
        participantMatchType: participant.matchType
      }
    };

    const skipReasons = [];
    if (!row.file_id) skipReasons.push("file_unmatched_or_ambiguous");
    if (!row.hearing_date) skipReasons.push("invalid_date");
    if (normalizeText(hearing.time) && !row.hearing_time) skipReasons.push("invalid_time");
    if (skipReasons.length) {
      skipped.push({ legacyId, reasons: skipReasons });
    }

    const existing = existingMaps.byLegacyId.get(row.legacy_id)
      || existingMaps.byComposite.get([row.file_id, row.hearing_date, row.hearing_time, normalizeName(row.court)].join("|"));

    let action = "skip";
    if (!skipReasons.length) {
      if (!existing) {
        action = "create";
        createCount += 1;
      } else if (existingMatchesRow(existing, row)) {
        action = "existing";
        alreadyExistingCount += 1;
      } else {
        action = "update";
        updateCount += 1;
      }
    }

    rows.push({
      row,
      sourceRecord: hearing,
      action,
      skipReasons,
      existingId: existing?.id || null,
      existingRecord: existing || null,
      fileMatch,
      participant
    });
  });

  const unique = value => [...new Map(value.map(item => [JSON.stringify(item), item])).values()];

  return {
    summary: {
      sourceHearingCount: hearings.length,
      uniqueHearingCount: rows.length,
      duplicateHearingCount: duplicates.length,
      activeFileCount: files.filter(file => file && file.deleted_at == null).length,
      activeProfileCount: profiles.filter(profile => profile && profile.deleted_at == null && profile.is_active !== false).length,
      existingHearingCount: existingHearings.filter(row => row && row.deleted_at == null).length,
      fileMatchedCount: matchedFiles.length,
      fileUnmatchedCount: unmatchedFiles.length,
      fileAmbiguousCount: ambiguousFiles.length,
      participantMatchedCount: matchedParticipants.length,
      participantUnmatchedCount: unmatchedParticipants.length,
      participantAmbiguousCount: ambiguousParticipants.length,
      invalidDateCount: invalidDates.length,
      invalidTimeCount: invalidTimes.length,
      createCount,
      updateCount,
      alreadyExistingCount,
      skippedCount: skipped.length
    },
    rows,
    duplicates,
    matchedFiles,
    unmatchedFiles,
    ambiguousFiles,
    matchedParticipants,
    unmatchedParticipants,
    ambiguousParticipants,
    invalidDates,
    invalidTimes,
    skipped,
    fieldMapping: hearingFieldMapping
  };
}

export function publicHearingsPlanReport(plan) {
  return {
    summary: plan.summary,
    fieldMapping: plan.fieldMapping,
    duplicates: plan.duplicates,
    unmatchedFiles: plan.unmatchedFiles,
    ambiguousFiles: plan.ambiguousFiles,
    unmatchedParticipants: plan.unmatchedParticipants,
    ambiguousParticipants: plan.ambiguousParticipants,
    invalidDates: plan.invalidDates,
    invalidTimes: plan.invalidTimes,
    skipped: plan.skipped,
    matchedFileSamples: plan.matchedFiles.slice(0, 20),
    matchedParticipantSamples: plan.matchedParticipants.slice(0, 20),
    plannedRows: plan.rows.map(item => ({
      legacyId: item.row.legacy_id,
      action: item.action,
      skipReasons: item.skipReasons,
      fileId: item.row.file_id,
      participantProfileId: item.row.participant_profile_id,
      date: item.row.hearing_date,
      time: item.row.hearing_time,
      court: item.row.court,
      caseFile: item.row.case_file_no
    }))
  };
}

export async function readHearingsMigrationInputs({
  inputPath = "",
  useServiceRole = false,
  includeExistingHearings = true
} = {}) {
  const state = inputPath
    ? readStateFromFile(inputPath)
    : await readStateFromSupabase({ serviceRole: useServiceRole });

  let files = [];
  let profiles = [];
  let existingHearings = [];
  const warnings = [];

  try {
    files = await readFilesForHearings({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Dosya listesi okunamadi: ${error.message}`);
  }

  try {
    profiles = await readProfilesForHearings({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Profil listesi okunamadi: ${error.message}`);
  }

  if (includeExistingHearings) {
    try {
      existingHearings = await readExistingHearings({ serviceRole: useServiceRole });
    } catch (error) {
      warnings.push(`Mevcut durusmalar okunamadi: ${error.message}`);
    }
  }

  return { state, files, profiles, existingHearings, warnings };
}

export { safeJsonParse, writeJsonReport };
