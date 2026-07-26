import {
  asArray,
  buildProfileMaps,
  createSupabaseClient,
  hashValue,
  isUuid,
  normalizeDate,
  normalizeName,
  normalizeResponsibleNameKey,
  normalizeText,
  readStateFromFile,
  readStateFromSupabase,
  resolveResponsibleProfile,
  writeJsonReport
} from "./files-migration-utils.mjs";

export const defaultDeadlinesDryRunReportPath = "work/deadlines-migration-dry-run-report.json";

export const deadlineFieldMapping = [
  { json: "id", target: "deadlines.legacy_id", transform: "trim; yoksa deterministic generated-*", risk: "Bos id varsa geri izleme generated id'ye baglanir." },
  { json: "fileId", target: "deadlines.file_id", transform: "files.legacy_id ile eslestirilir", risk: "Dosya import edilmemisse sureli is atlanir." },
  { json: "file", target: "deadlines.file_id", transform: "files.display_id / legacy_id / file_no ile eslestirilir", risk: "Ayni gorunen id birden fazla dosyada varsa ambiguous olur." },
  { json: "court", target: "deadlines.metadata.originalCourt; dosya eslestirmesinde court+dosya no", transform: "trim", risk: "Mahkeme adindaki yazim farklari eslesmeyi zorlastirir." },
  { json: "task", target: "deadlines.title ve deadlines.task", transform: "trim", risk: "Bos is tanimi import disi kalir." },
  { json: "lawyer", target: "deadlines.responsible_profile_id / responsible_name", transform: "profiles display_name/email normalize eslesmesi", risk: "Eslesmezse UUID null kalir, metin korunur." },
  { json: "responsibleName", target: "deadlines.responsible_profile_id / responsible_name", transform: "lawyer bos ise kullanilir", risk: "Eslesmezse UUID null kalir, metin korunur." },
  { json: "start", target: "deadlines.start_date", transform: "YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY -> date", risk: "Gecersizse null kalir ve raporlanir." },
  { json: "due", target: "deadlines.due_date", transform: "YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY -> date", risk: "Gecersizse kayit atlanir." },
  { json: "description", target: "deadlines.description", transform: "trim", risk: "Bos deger null kalir." },
  { json: "status", target: "deadlines.status", transform: "Aktif/Tamamlandı/İptal kanonik esleme", risk: "Bilinmeyen durum metni korunur ve raporlanir." },
  { json: "completedAt", target: "deadlines.completed_at", transform: "date veya datetime -> timestamptz; date-only Istanbul oglen", risk: "Gecersizse null kalir ve raporlanir." },
  { json: "completedLate", target: "deadlines.completed_late", transform: "boolean", risk: "Eksikse false." },
  { json: "createdAt", target: "deadlines.metadata.originalCreatedAt", transform: "metadata icinde korunur", risk: "Ana created_at import zamanini temsil eder." },
  { json: "updatedAt", target: "deadlines.metadata.originalUpdatedAt", transform: "metadata icinde korunur", risk: "Ana updated_at import/update zamanini temsil eder." }
];

export function readDeadlinesFromState(state = {}) {
  return asArray(state.deadlines);
}

export function normalizeFileLookupKey(value) {
  return normalizeText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCourtCaseKey(court, fileNo) {
  const courtKey = normalizeName(court).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const fileKey = normalizeFileLookupKey(fileNo);
  return courtKey && fileKey ? `${courtKey}|${fileKey}` : "";
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

function uniqueFileMatches(matches = []) {
  return [...new Map(matches.map(item => [item.file.id, item])).values()];
}

function resolveFromMap(attempt) {
  if (!attempt.key) return null;
  const matches = uniqueFileMatches(attempt.map.get(attempt.key) || []);
  if (matches.length === 1) {
    const match = matches[0];
    return {
      fileId: match.file.id,
      fileLegacyId: match.file.legacy_id || null,
      matchType: attempt.source,
      matchedBy: match.source,
      lookupKey: attempt.key
    };
  }
  if (matches.length > 1) {
    return {
      fileId: null,
      matchType: "ambiguous",
      attemptedBy: attempt.source,
      lookupKey: attempt.key,
      candidates: matches.map(item => ({
        fileId: item.file.id,
        legacyId: item.file.legacy_id || null,
        displayId: item.file.display_id || null,
        fileNo: item.file.file_no || null,
        courtOrOffice: item.file.court_or_office || null,
        source: item.source
      }))
    };
  }
  return null;
}

export function resolveDeadlineFile(deadline = {}, fileMaps) {
  const possibleFileNo = deadline.caseFile || deadline.case_file_no || deadline.fileNo || deadline.file_no || deadline.file;
  const attempts = [
    { key: normalizeFileLookupKey(deadline.fileId), map: fileMaps.byLegacyId, source: "fileId->legacy_id" },
    { key: normalizeFileLookupKey(deadline.file), map: fileMaps.byDisplayOrLegacyOrNo, source: "file->display_id/legacy_id/file_no" },
    { key: normalizeCourtCaseKey(deadline.court, possibleFileNo), map: fileMaps.byCourtCase, source: "court+dosya_no" }
  ];

  for (const attempt of attempts) {
    const resolved = resolveFromMap(attempt);
    if (resolved) return resolved;
  }

  return {
    fileId: null,
    matchType: "unmatched",
    lookupKey: normalizeFileLookupKey(deadline.fileId || deadline.file || `${deadline.court || ""} ${possibleFileNo || ""}`)
  };
}

export function legacyIdForDeadline(deadline = {}, index = 0) {
  const explicit = normalizeText(deadline.legacy_id || deadline.legacyId || deadline.id);
  if (explicit) return explicit;
  const fallback = [
    deadline.fileId,
    deadline.file,
    deadline.court,
    deadline.task,
    deadline.title,
    deadline.due
  ].map(normalizeText).join("|");
  return `generated-deadline-${index + 1}-${hashValue(fallback || JSON.stringify(deadline), 12)}`;
}

export function normalizeTimestamp(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const dateOnly = normalizeDate(text);
  if (dateOnly && /^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})$/.test(text)) {
    return `${dateOnly}T12:00:00+03:00`;
  }

  const isoLike = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (isoLike) {
    const [, date, hour, minute, second = "0", rawZone] = isoLike;
    const hh = String(Number(hour)).padStart(2, "0");
    const mm = String(Number(minute)).padStart(2, "0");
    const ss = String(Number(second)).padStart(2, "0");
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
    const zone = rawZone
      ? rawZone.toUpperCase() === "Z"
        ? "Z"
        : rawZone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")
      : "+03:00";
    return `${date}T${hh}:${mm}:${ss}${zone}`;
  }

  const trLike = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (trLike) {
    const [, day, month, year, hour, minute, second = "0"] = trLike;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const hh = String(Number(hour)).padStart(2, "0");
    const mm = String(Number(minute)).padStart(2, "0");
    const ss = String(Number(second)).padStart(2, "0");
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
    return `${date}T${hh}:${mm}:${ss}+03:00`;
  }

  return null;
}

export function normalizeDeadlineStatus(value) {
  const original = normalizeText(value);
  const key = normalizeResponsibleNameKey(original);
  const map = new Map([
    ["aktif", "Aktif"],
    ["active", "Aktif"],
    ["pending", "Aktif"],
    ["bekliyor", "Aktif"],
    ["devam ediyor", "Aktif"],
    ["overdue", "Aktif"],
    ["suresi gecmis", "Aktif"],
    ["tamamlandi", "Tamamlandı"],
    ["tamamlandı", "Tamamlandı"],
    ["completed", "Tamamlandı"],
    ["done", "Tamamlandı"],
    ["suresi icinde tamamlandi", "Tamamlandı"],
    ["suresi disinda tamamlandi", "Tamamlandı"],
    ["gec tamamlandi", "Tamamlandı"],
    ["iptal", "İptal"],
    ["iptal edildi", "İptal"],
    ["cancelled", "İptal"],
    ["canceled", "İptal"]
  ]);
  return map.get(key) || original || "Aktif";
}

export function isCompletedStatus(status) {
  const key = normalizeResponsibleNameKey(status);
  return key === "tamamlandi" || key === "tamamlandı";
}

export function isOverdueDeadline(row = {}, today = new Date()) {
  if (!row.due_date || isCompletedStatus(row.status)) return false;
  const [year, month, day] = row.due_date.split("-").map(Number);
  const due = new Date(year, month - 1, day, 12);
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return due < current;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  const key = normalizeResponsibleNameKey(value);
  return ["true", "1", "evet", "yes", "gec", "late"].includes(key);
}

function valuesEqual(left, right) {
  return normalizeText(left ?? "") === normalizeText(right ?? "");
}

function existingMatchesRow(existing = {}, row = {}) {
  return valuesEqual(existing.file_id, row.file_id)
    && valuesEqual(existing.title || existing.task, row.title)
    && valuesEqual(existing.description, row.description)
    && valuesEqual(existing.responsible_profile_id, row.responsible_profile_id)
    && valuesEqual(existing.responsible_name, row.responsible_name)
    && valuesEqual(existing.start_date, row.start_date)
    && valuesEqual(existing.due_date, row.due_date)
    && valuesEqual(existing.status, row.status)
    && valuesEqual(existing.completed_at, row.completed_at)
    && Boolean(existing.completed_late) === Boolean(row.completed_late);
}

export async function readFilesForDeadlines({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("files")
    .select("id, legacy_id, display_id, file_no, court_or_office, deleted_at, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`files okunamadi: ${error.message}`);
  return data || [];
}

export async function readProfilesForDeadlines({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, is_active, deleted_at")
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  if (error) throw new Error(`profiles okunamadi: ${error.message}`);
  return data || [];
}

export async function readExistingDeadlines({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const extendedSelect = "id, legacy_id, file_id, title, task, description, responsible_profile_id, responsible_name, start_date, due_date, status, completed_at, completed_late, import_batch_id, metadata, deleted_at";
  const baseSelect = "id, legacy_id, file_id, title, description, responsible_profile_id, responsible_name, start_date, due_date, status, completed_at, completed_late, metadata, deleted_at";

  const { data, error } = await supabase
    .from("deadlines")
    .select(extendedSelect)
    .is("deleted_at", null)
    .order("due_date", { ascending: true });

  if (error && /task|import_batch_id/i.test(error.message || "")) {
    const fallback = await supabase
      .from("deadlines")
      .select(baseSelect)
      .is("deleted_at", null)
      .order("due_date", { ascending: true });
    if (fallback.error) throw new Error(`deadlines okunamadi: ${fallback.error.message}`);
    return fallback.data || [];
  }

  if (error) throw new Error(`deadlines okunamadi: ${error.message}`);
  return data || [];
}

export function buildExistingDeadlineMaps(existingDeadlines = []) {
  const byLegacyId = new Map();
  const byComposite = new Map();

  existingDeadlines
    .filter(row => row && row.deleted_at == null)
    .forEach(row => {
      const legacyKey = normalizeText(row.legacy_id);
      if (legacyKey) byLegacyId.set(legacyKey, row);
      const titleKey = normalizeResponsibleNameKey(row.title || row.task);
      const composite = [row.file_id, titleKey, row.due_date].join("|");
      if (row.file_id && titleKey && row.due_date && !byComposite.has(composite)) byComposite.set(composite, row);
    });

  return { byLegacyId, byComposite };
}

export function buildDeadlinesMigrationPlan(state = {}, {
  files = [],
  profiles = [],
  existingDeadlines = [],
  batchId = "deadlines-dry-run",
  today = new Date()
} = {}) {
  const deadlines = readDeadlinesFromState(state);
  const profileMaps = buildProfileMaps(profiles);
  const fileMaps = buildFileMaps(files);
  const existingMaps = buildExistingDeadlineMaps(existingDeadlines);
  const seenLegacyIds = new Map();
  const rows = [];
  const duplicates = [];
  const matchedFiles = [];
  const unmatchedFiles = [];
  const ambiguousFiles = [];
  const matchedResponsibleLawyers = [];
  const unmatchedResponsibleLawyers = [];
  const ambiguousResponsibleLawyers = [];
  const invalidStartDates = [];
  const invalidDueDates = [];
  const invalidCompletedAt = [];
  const statusMappings = [];
  const statusConflicts = [];
  const unknownStatuses = [];
  const skipped = [];
  let createCount = 0;
  let updateCount = 0;
  let alreadyExistingCount = 0;
  let completedCount = 0;
  let activeCount = 0;
  let overdueCount = 0;

  deadlines.forEach((deadline, index) => {
    const legacyId = legacyIdForDeadline(deadline, index);
    if (seenLegacyIds.has(legacyId)) {
      duplicates.push({
        legacyId,
        keptIndex: seenLegacyIds.get(legacyId),
        duplicateIndex: index
      });
      return;
    }
    seenLegacyIds.set(legacyId, index);

    const fileMatch = resolveDeadlineFile(deadline, fileMaps);
    if (fileMatch.fileId) {
      matchedFiles.push({ legacyId, fileId: fileMatch.fileId, fileLegacyId: fileMatch.fileLegacyId, matchType: fileMatch.matchType });
    } else if (fileMatch.matchType === "ambiguous") {
      ambiguousFiles.push({ legacyId, deadlineFile: deadline.file || null, fileIdText: deadline.fileId || null, court: deadline.court || null, ...fileMatch });
    } else {
      unmatchedFiles.push({ legacyId, deadlineFile: deadline.file || null, fileIdText: deadline.fileId || null, court: deadline.court || null, lookupKey: fileMatch.lookupKey });
    }

    const responsibleText = normalizeText(deadline.lawyer || deadline.responsibleName || deadline.responsible);
    const responsible = resolveResponsibleProfile({ responsibleName: responsibleText }, profileMaps);
    if (responsible.responsibleProfileId) {
      matchedResponsibleLawyers.push({
        legacyId,
        responsibleName: responsibleText,
        responsibleProfileId: responsible.responsibleProfileId,
        matchedDisplayName: profileMaps.byId.get(responsible.responsibleProfileId)?.display_name || null,
        matchType: responsible.matchType
      });
    } else if (responsible.matchType === "ambiguous" && responsibleText) {
      ambiguousResponsibleLawyers.push({
        legacyId,
        responsibleName: responsibleText,
        normalizedKey: responsible.normalizedKey,
        candidates: responsible.candidates
      });
    } else if (responsibleText) {
      unmatchedResponsibleLawyers.push({
        legacyId,
        responsibleName: responsibleText,
        normalizedKey: responsible.normalizedKey
      });
    }

    const startDate = normalizeDate(deadline.start);
    if (normalizeText(deadline.start) && !startDate) invalidStartDates.push({ legacyId, value: deadline.start || null });

    const dueDate = normalizeDate(deadline.due);
    if (!dueDate) invalidDueDates.push({ legacyId, value: deadline.due || null });

    const completedAt = normalizeTimestamp(deadline.completedAt);
    if (normalizeText(deadline.completedAt) && !completedAt) invalidCompletedAt.push({ legacyId, value: deadline.completedAt || null });

    const sourceStatus = normalizeText(deadline.status);
    const status = normalizeDeadlineStatus(sourceStatus);
    statusMappings.push({ legacyId, sourceStatus: sourceStatus || null, targetStatus: status });
    if (sourceStatus && status === sourceStatus && !["Aktif", "Tamamlandı", "İptal"].includes(status)) {
      unknownStatuses.push({ legacyId, sourceStatus });
    }
    if (completedAt && !isCompletedStatus(status)) {
      statusConflicts.push({ legacyId, status, completedAt, reason: "completedAt dolu ama status tamamlanmis degil" });
    }

    const title = normalizeText(deadline.task || deadline.title);
    const row = {
      legacy_id: legacyId,
      file_id: fileMatch.fileId,
      title,
      task: title,
      description: normalizeText(deadline.description) || null,
      responsible_profile_id: responsible.responsibleProfileId,
      responsible_name: responsibleText || null,
      start_date: startDate,
      due_date: dueDate,
      status,
      completed_at: completedAt,
      completed_late: boolValue(deadline.completedLate),
      import_batch_id: batchId,
      metadata: {
        source: "settings-json-deadlines-migration",
        importBatchId: batchId,
        originalIndex: index,
        originalFileId: deadline.fileId || null,
        originalFile: deadline.file || null,
        originalCourt: deadline.court || null,
        originalCreatedAt: deadline.createdAt || null,
        originalUpdatedAt: deadline.updatedAt || null,
        fileMatchType: fileMatch.matchType,
        responsibleMatchType: responsible.matchType
      }
    };

    if (isCompletedStatus(row.status)) completedCount += 1;
    else activeCount += 1;
    if (isOverdueDeadline(row, today)) overdueCount += 1;

    const skipReasons = [];
    if (!row.file_id) skipReasons.push("file_unmatched_or_ambiguous");
    if (!row.title) skipReasons.push("missing_task");
    if (!row.due_date) skipReasons.push("invalid_due_date");
    if (skipReasons.length) skipped.push({ legacyId, reasons: skipReasons });

    const existing = existingMaps.byLegacyId.get(row.legacy_id)
      || existingMaps.byComposite.get([row.file_id, normalizeResponsibleNameKey(row.title), row.due_date].join("|"));

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
      sourceRecord: deadline,
      action,
      skipReasons,
      existingId: existing?.id || null,
      existingRecord: existing || null,
      fileMatch,
      responsible
    });
  });

  const sourceFields = [...new Set(deadlines.flatMap(row => Object.keys(row || {})))].sort((a, b) => a.localeCompare(b, "tr"));

  return {
    summary: {
      sourceDeadlineCount: deadlines.length,
      uniqueDeadlineCount: rows.length,
      duplicateDeadlineCount: duplicates.length,
      activeFileCount: files.filter(file => file && file.deleted_at == null).length,
      activeProfileCount: profiles.filter(profile => profile && profile.deleted_at == null && profile.is_active !== false).length,
      existingDeadlineCount: existingDeadlines.filter(row => row && row.deleted_at == null).length,
      fileMatchedCount: matchedFiles.length,
      fileUnmatchedCount: unmatchedFiles.length,
      fileAmbiguousCount: ambiguousFiles.length,
      responsibleMatchedCount: matchedResponsibleLawyers.length,
      responsibleUnmatchedCount: unmatchedResponsibleLawyers.length,
      responsibleAmbiguousCount: ambiguousResponsibleLawyers.length,
      invalidStartDateCount: invalidStartDates.length,
      invalidDueDateCount: invalidDueDates.length,
      invalidCompletedAtCount: invalidCompletedAt.length,
      completedCount,
      activeCount,
      overdueCount,
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
    matchedResponsibleLawyers,
    unmatchedResponsibleLawyers,
    ambiguousResponsibleLawyers,
    invalidStartDates,
    invalidDueDates,
    invalidCompletedAt,
    statusMappings,
    statusConflicts,
    unknownStatuses,
    skipped,
    sourceFields,
    fieldMapping: deadlineFieldMapping
  };
}

export function publicDeadlinesPlanReport(plan) {
  return {
    summary: plan.summary,
    sourceFields: plan.sourceFields,
    fieldMapping: plan.fieldMapping,
    duplicates: plan.duplicates,
    unmatchedFiles: plan.unmatchedFiles,
    ambiguousFiles: plan.ambiguousFiles,
    unmatchedResponsibleLawyers: plan.unmatchedResponsibleLawyers,
    ambiguousResponsibleLawyers: plan.ambiguousResponsibleLawyers,
    invalidStartDates: plan.invalidStartDates,
    invalidDueDates: plan.invalidDueDates,
    invalidCompletedAt: plan.invalidCompletedAt,
    statusMappings: plan.statusMappings,
    statusConflicts: plan.statusConflicts,
    unknownStatuses: plan.unknownStatuses,
    skipped: plan.skipped,
    matchedFileSamples: plan.matchedFiles.slice(0, 20),
    matchedResponsibleSamples: plan.matchedResponsibleLawyers.slice(0, 20),
    manualDecisionItems: [
      ...plan.ambiguousFiles.map(item => ({ type: "ambiguous_file", legacyId: item.legacyId, candidates: item.candidates })),
      ...plan.ambiguousResponsibleLawyers.map(item => ({ type: "ambiguous_responsible", legacyId: item.legacyId, candidates: item.candidates })),
      ...plan.unmatchedFiles.map(item => ({ type: "unmatched_file", legacyId: item.legacyId, lookupKey: item.lookupKey }))
    ],
    plannedRows: plan.rows.map(item => ({
      legacyId: item.row.legacy_id,
      action: item.action,
      skipReasons: item.skipReasons,
      fileId: item.row.file_id,
      task: item.row.title,
      responsibleProfileId: item.row.responsible_profile_id,
      responsibleName: item.row.responsible_name,
      startDate: item.row.start_date,
      dueDate: item.row.due_date,
      status: item.row.status,
      completedAt: item.row.completed_at,
      completedLate: item.row.completed_late
    }))
  };
}

export async function readDeadlinesMigrationInputs({
  inputPath = "",
  useServiceRole = true,
  includeExistingDeadlines = true
} = {}) {
  const state = inputPath
    ? readStateFromFile(inputPath)
    : await readStateFromSupabase({ serviceRole: useServiceRole });

  let files = [];
  let profiles = [];
  let existingDeadlines = [];
  const warnings = [];

  try {
    files = await readFilesForDeadlines({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Dosya listesi okunamadi: ${error.message}`);
  }

  try {
    profiles = await readProfilesForDeadlines({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Profil listesi okunamadi: ${error.message}`);
  }

  if (includeExistingDeadlines) {
    try {
      existingDeadlines = await readExistingDeadlines({ serviceRole: useServiceRole });
    } catch (error) {
      warnings.push(`Mevcut sureli isler okunamadi: ${error.message}`);
    }
  }

  return { state, files, profiles, existingDeadlines, warnings };
}

export { writeJsonReport };
