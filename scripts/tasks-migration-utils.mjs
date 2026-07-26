import {
  asArray,
  buildProfileMaps,
  createSupabaseClient,
  hashValue,
  isUuid,
  normalizeDate,
  normalizeResponsibleNameKey,
  normalizeText,
  readStateFromFile,
  readStateFromSupabase,
  resolveResponsibleProfile,
  writeJsonReport
} from "./files-migration-utils.mjs";
import {
  buildFileMaps,
  normalizeCourtCaseKey,
  normalizeFileLookupKey,
  normalizeTimestamp,
  readFilesForDeadlines,
  readProfilesForDeadlines
} from "./deadlines-migration-utils.mjs";

export const defaultTasksDryRunReportPath = "work/tasks-migration-dry-run-report.json";

export const taskFieldMapping = [
  { json: "id", target: "tasks.legacy_id", transform: "trim; yoksa deterministic generated-*", risk: "Bos id varsa geri izleme generated id'ye baglanir." },
  { json: "taskType", target: "tasks.task_type", transform: "known type normalize; bilinmeyen metin korunur", risk: "Bilinmeyen tur metadata.originalTaskType icinde de saklanir." },
  { json: "fileId", target: "tasks.file_id", transform: "dosyaya bagli gorevlerde files.legacy_id ile eslestirilir", risk: "Eslesmeyen dosyaya bagli gorev import disi kalir." },
  { json: "file", target: "tasks.file_id", transform: "files.display_id / legacy_id / file_no ile eslestirilir", risk: "Ayni gorunen deger birden fazla dosyada varsa ambiguous olur." },
  { json: "title", target: "tasks.title", transform: "trim", risk: "Bos baslik import disi kalir." },
  { json: "description", target: "tasks.description", transform: "trim; bos ise null", risk: "Yoksa kayit aciklamasiz kalir." },
  { json: "responsible", target: "tasks.responsible_profile_id / responsible_name", transform: "profiles display_name/email normalize eslesmesi", risk: "Eslesmezse UUID null kalir, metin korunur." },
  { json: "responsibleUserId", target: "tasks.responsible_profile_id", transform: "UUID ise profiles.id ile dogrudan eslesir", risk: "Eski id UUID degilse isim eslesmesine dusulur." },
  { json: "dueDate", target: "tasks.due_date", transform: "YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY -> date", risk: "Gecersiz tarih manuel inceleme olarak raporlanir." },
  { json: "status", target: "tasks.status", transform: "Aktif/Tamamlandi/Iptal kanonik esleme; bilinmeyen korunur", risk: "UI sonraki asamada bilinmeyen durumu ayri ele almalidir." },
  { json: "completedAt", target: "tasks.completed_at", transform: "date/datetime -> timestamptz; date-only Istanbul oglen", risk: "Gecersizse null kalir ve raporlanir." },
  { json: "createdAt", target: "tasks.created_at", transform: "date/datetime -> timestamptz; date-only Istanbul oglen", risk: "Gecersizse metadata icinde korunur, kolon null/default kalir." },
  { json: "updatedAt", target: "tasks.updated_at", transform: "date/datetime -> timestamptz; date-only Istanbul oglen", risk: "Gecersizse metadata icinde korunur, kolon import zamaniyla guncellenir." },
  { json: "priority", target: "tasks.priority", transform: "low/normal/high/urgent veya Turkce karsiliklar", risk: "Bilinmeyen oncelik metadata.originalPriority icinde korunur." },
  { json: "createdBy", target: "tasks.created_by_profile_id / metadata.originalCreatedBy", transform: "UUID veya normalize isim ile profile eslesmesi", risk: "Eslesmezse UUID null kalir, kaynak metin korunur." }
];

export function readTasksFromState(state = {}) {
  return asArray(state.tasks);
}

export function legacyIdForTask(task = {}, index = 0) {
  const explicit = normalizeText(task.legacy_id || task.legacyId || task.id);
  if (explicit) return explicit;
  const fallback = [
    task.taskType,
    task.fileId,
    task.file,
    task.title,
    task.responsible,
    task.dueDate
  ].map(normalizeText).join("|");
  return `generated-task-${index + 1}-${hashValue(fallback || JSON.stringify(task), 12)}`;
}

function mapTaskType(value, task = {}) {
  const original = normalizeText(value);
  const key = normalizeResponsibleNameKey(original);
  const map = new Map([
    ["file", "file"],
    ["dosya", "file"],
    ["dosyaya bagli", "file"],
    ["dosyaya bagli gorev", "file"],
    ["office", "office"],
    ["ofis", "office"],
    ["ofis gorevi", "office"],
    ["general", "office"],
    ["genel", "office"],
    ["personal", "personal"],
    ["kisisel", "personal"],
    ["kişisel", "personal"]
  ]);

  if (map.has(key)) return { taskType: map.get(key), sourceTaskType: original || null, inferred: false, known: true };
  if (original) return { taskType: original, sourceTaskType: original, inferred: false, known: false };
  if (normalizeText(task.fileId || task.file)) {
    return { taskType: "file", sourceTaskType: null, inferred: true, known: true };
  }
  return { taskType: "office", sourceTaskType: null, inferred: true, known: true };
}

export function isFileBoundTask(task = {}, taskType = "") {
  const key = normalizeResponsibleNameKey(taskType || task.taskType);
  if (["file", "dosya", "dosyaya bagli", "dosyaya bagli gorev"].includes(key)) return true;
  if (["office", "ofis", "ofis gorevi", "general", "genel", "personal", "kisisel"].includes(key)) return false;
  return Boolean(normalizeText(task.fileId || task.file));
}

function uniqueFileMatches(matches = []) {
  return [...new Map(matches.map(item => [item.file.id, item])).values()];
}

function resolveFromFileMap(attempt) {
  if (!attempt.key) return null;
  const matches = uniqueFileMatches(attempt.map.get(attempt.key) || []);
  if (matches.length === 1) {
    const match = matches[0];
    return {
      fileId: match.file.id,
      fileLegacyId: match.file.legacy_id || null,
      fileDisplayId: match.file.display_id || null,
      fileNo: match.file.file_no || null,
      courtOrOffice: match.file.court_or_office || null,
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

export function resolveTaskFile(task = {}, fileMaps, taskType = "") {
  if (!isFileBoundTask(task, taskType)) {
    return { fileId: null, matchType: "not_applicable", lookupKey: null };
  }

  const possibleFileNo = task.caseFile || task.case_file_no || task.caseFileNo || task.fileNo || task.file_no || task.file;
  const court = task.court || task.courtOrOffice || task.court_or_office || task.office || task.officeName;
  const attempts = [
    { key: normalizeFileLookupKey(task.fileId), map: fileMaps.byLegacyId, source: "fileId->legacy_id" },
    { key: normalizeFileLookupKey(task.file), map: fileMaps.byDisplayOrLegacyOrNo, source: "file->display_id/legacy_id/file_no" },
    { key: normalizeCourtCaseKey(court, possibleFileNo), map: fileMaps.byCourtCase, source: "court+dosya_no" }
  ];

  for (const attempt of attempts) {
    const resolved = resolveFromFileMap(attempt);
    if (resolved) return resolved;
  }

  return {
    fileId: null,
    matchType: "unmatched",
    lookupKey: normalizeFileLookupKey(task.fileId || task.file || `${court || ""} ${possibleFileNo || ""}`)
  };
}

export function normalizeTaskStatus(value) {
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
    ["gecikti", "Aktif"],
    ["tamamlandi", "Tamamlandı"],
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

export function normalizeTaskPriority(value) {
  const original = normalizeText(value);
  const key = normalizeResponsibleNameKey(original);
  const map = new Map([
    ["low", "low"],
    ["dusuk", "low"],
    ["düşük", "low"],
    ["normal", "normal"],
    ["orta", "normal"],
    ["medium", "normal"],
    ["high", "high"],
    ["yuksek", "high"],
    ["yüksek", "high"],
    ["urgent", "urgent"],
    ["acil", "urgent"]
  ]);
  if (!original) return { priority: null, sourcePriority: null, known: true };
  return { priority: map.get(key) || original, sourcePriority: original, known: map.has(key) };
}

export function isCompletedTaskStatus(status) {
  const key = normalizeResponsibleNameKey(status);
  return key === "tamamlandi" || key === "completed" || key === "done";
}

export function isOverdueTask(row = {}, today = new Date()) {
  if (!row.due_date || isCompletedTaskStatus(row.status)) return false;
  const [year, month, day] = row.due_date.split("-").map(Number);
  const due = new Date(year, month - 1, day, 12);
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return due < current;
}

function valuesEqual(left, right) {
  return normalizeText(left ?? "") === normalizeText(right ?? "");
}

function timestampsEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).toISOString() === new Date(right).toISOString();
}

function existingMatchesRow(existing = {}, row = {}) {
  return valuesEqual(existing.legacy_id, row.legacy_id)
    && valuesEqual(existing.task_type, row.task_type)
    && valuesEqual(existing.file_id, row.file_id)
    && valuesEqual(existing.title, row.title)
    && valuesEqual(existing.description, row.description)
    && valuesEqual(existing.responsible_profile_id, row.responsible_profile_id)
    && valuesEqual(existing.responsible_name, row.responsible_name)
    && valuesEqual(existing.due_date, row.due_date)
    && valuesEqual(existing.status, row.status)
    && valuesEqual(existing.priority, row.priority)
    && valuesEqual(existing.created_by_profile_id, row.created_by_profile_id)
    && timestampsEqual(existing.completed_at, row.completed_at);
}

export async function readFilesForTasks({ serviceRole = false } = {}) {
  return readFilesForDeadlines({ serviceRole });
}

export async function readProfilesForTasks({ serviceRole = false } = {}) {
  return readProfilesForDeadlines({ serviceRole });
}

export async function readExistingTasks({ serviceRole = false } = {}) {
  const supabase = createSupabaseClient({ serviceRole });
  const extendedSelect = "id, legacy_id, task_type, file_id, title, description, responsible_profile_id, responsible_name, due_date, status, priority, completed_at, created_by_profile_id, import_batch_id, metadata, created_at, updated_at, deleted_at";
  const baseSelect = "id, legacy_id, task_type, file_id, title, description, responsible_profile_id, responsible_name, due_date, status, completed_at, metadata, created_at, updated_at, deleted_at";

  const { data, error } = await supabase
    .from("tasks")
    .select(extendedSelect)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error && /priority|created_by_profile_id|import_batch_id/i.test(error.message || "")) {
    const fallback = await supabase
      .from("tasks")
      .select(baseSelect)
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (fallback.error) throw new Error(`tasks okunamadi: ${fallback.error.message}`);
    return fallback.data || [];
  }

  if (error) throw new Error(`tasks okunamadi: ${error.message}`);
  return data || [];
}

export function buildExistingTaskMaps(existingTasks = []) {
  const byLegacyId = new Map();
  const byComposite = new Map();

  existingTasks
    .filter(row => row && row.deleted_at == null)
    .forEach(row => {
      const legacyKey = normalizeText(row.legacy_id);
      if (legacyKey && !byLegacyId.has(legacyKey)) byLegacyId.set(legacyKey, row);
      const titleKey = normalizeResponsibleNameKey(row.title);
      const composite = [
        normalizeResponsibleNameKey(row.task_type),
        row.file_id || "",
        titleKey,
        row.due_date || "",
        row.responsible_profile_id || ""
      ].join("|");
      if (titleKey && !byComposite.has(composite)) byComposite.set(composite, row);
    });

  return { byLegacyId, byComposite };
}

function resolveProfileByFlexibleValue(value, profileMaps) {
  const text = normalizeText(value);
  if (!text) return { profileId: null, name: null, matchType: "empty", normalizedKey: "" };
  const resolved = resolveResponsibleProfile({
    responsibleUserId: isUuid(text) ? text : "",
    responsibleName: text
  }, profileMaps);
  return {
    profileId: resolved.responsibleProfileId,
    name: resolved.responsibleName,
    matchType: resolved.matchType,
    normalizedKey: resolved.normalizedKey,
    candidates: resolved.candidates || []
  };
}

export function buildTasksMigrationPlan(state = {}, {
  files = [],
  profiles = [],
  existingTasks = [],
  batchId = "tasks-dry-run",
  today = new Date()
} = {}) {
  const tasks = readTasksFromState(state);
  const profileMaps = buildProfileMaps(profiles);
  const fileMaps = buildFileMaps(files);
  const existingMaps = buildExistingTaskMaps(existingTasks);
  const seenLegacyIds = new Map();
  const rows = [];
  const duplicates = [];
  const matchedFiles = [];
  const unmatchedFiles = [];
  const ambiguousFiles = [];
  const matchedResponsibleUsers = [];
  const unmatchedResponsibleUsers = [];
  const ambiguousResponsibleUsers = [];
  const invalidDueDates = [];
  const invalidCompletedAt = [];
  const invalidCreatedAt = [];
  const invalidUpdatedAt = [];
  const taskTypeMappings = [];
  const statusMappings = [];
  const unknownStatuses = [];
  const priorityMappings = [];
  const unknownPriorities = [];
  const skipped = [];
  let fileBoundTaskCount = 0;
  let officePersonalTaskCount = 0;
  let createCount = 0;
  let updateCount = 0;
  let alreadyExistingCount = 0;
  let completedCount = 0;
  let activeCount = 0;
  let overdueCount = 0;

  tasks.forEach((task, index) => {
    const legacyId = legacyIdForTask(task, index);
    if (seenLegacyIds.has(legacyId)) {
      duplicates.push({ legacyId, keptIndex: seenLegacyIds.get(legacyId), duplicateIndex: index });
      return;
    }
    seenLegacyIds.set(legacyId, index);

    const taskTypeInfo = mapTaskType(task.taskType || task.type, task);
    taskTypeMappings.push({
      legacyId,
      sourceTaskType: taskTypeInfo.sourceTaskType,
      targetTaskType: taskTypeInfo.taskType,
      inferred: taskTypeInfo.inferred,
      known: taskTypeInfo.known
    });
    const fileBound = isFileBoundTask(task, taskTypeInfo.taskType);
    if (fileBound) fileBoundTaskCount += 1;
    else officePersonalTaskCount += 1;

    const fileMatch = resolveTaskFile(task, fileMaps, taskTypeInfo.taskType);
    if (fileMatch.fileId) {
      matchedFiles.push({ legacyId, fileId: fileMatch.fileId, fileLegacyId: fileMatch.fileLegacyId, matchType: fileMatch.matchType });
    } else if (fileMatch.matchType === "ambiguous") {
      ambiguousFiles.push({ legacyId, taskFile: task.file || null, fileIdText: task.fileId || null, ...fileMatch });
    } else if (fileBound) {
      unmatchedFiles.push({ legacyId, taskFile: task.file || null, fileIdText: task.fileId || null, lookupKey: fileMatch.lookupKey });
    }

    const responsibleText = normalizeText(task.responsible || task.responsibleName || task.lawyer || task.responsibleUserId);
    const responsible = resolveResponsibleProfile({
      responsibleUserId: task.responsibleUserId,
      responsibleName: responsibleText
    }, profileMaps);
    if (responsible.responsibleProfileId) {
      matchedResponsibleUsers.push({
        legacyId,
        responsibleName: responsibleText || responsible.responsibleName,
        responsibleProfileId: responsible.responsibleProfileId,
        matchedDisplayName: profileMaps.byId.get(responsible.responsibleProfileId)?.display_name || null,
        matchType: responsible.matchType
      });
    } else if (responsible.matchType === "ambiguous" && responsibleText) {
      ambiguousResponsibleUsers.push({
        legacyId,
        responsibleName: responsibleText,
        normalizedKey: responsible.normalizedKey,
        candidates: responsible.candidates
      });
    } else if (responsibleText) {
      unmatchedResponsibleUsers.push({
        legacyId,
        responsibleName: responsibleText,
        normalizedKey: responsible.normalizedKey
      });
    }

    const createdBy = resolveProfileByFlexibleValue(task.createdBy, profileMaps);

    const dueDate = normalizeDate(task.dueDate);
    if (normalizeText(task.dueDate) && !dueDate) invalidDueDates.push({ legacyId, value: task.dueDate || null });

    const completedAt = normalizeTimestamp(task.completedAt);
    if (normalizeText(task.completedAt) && !completedAt) invalidCompletedAt.push({ legacyId, value: task.completedAt || null });

    const createdAt = normalizeTimestamp(task.createdAt);
    if (normalizeText(task.createdAt) && !createdAt) invalidCreatedAt.push({ legacyId, value: task.createdAt || null });

    const updatedAt = normalizeTimestamp(task.updatedAt);
    if (normalizeText(task.updatedAt) && !updatedAt) invalidUpdatedAt.push({ legacyId, value: task.updatedAt || null });

    const sourceStatus = normalizeText(task.status);
    const status = normalizeTaskStatus(sourceStatus);
    statusMappings.push({ legacyId, sourceStatus: sourceStatus || null, targetStatus: status });
    if (sourceStatus && status === sourceStatus && !["Aktif", "Tamamlandı", "İptal"].includes(status)) {
      unknownStatuses.push({ legacyId, sourceStatus });
    }

    const priorityInfo = normalizeTaskPriority(task.priority);
    priorityMappings.push({ legacyId, sourcePriority: priorityInfo.sourcePriority, targetPriority: priorityInfo.priority });
    if (!priorityInfo.known && priorityInfo.sourcePriority) {
      unknownPriorities.push({ legacyId, sourcePriority: priorityInfo.sourcePriority, targetPriority: priorityInfo.priority });
    }

    const title = normalizeText(task.title || task.task || task.description);
    const row = {
      legacy_id: legacyId,
      task_type: taskTypeInfo.taskType,
      file_id: fileBound ? fileMatch.fileId : null,
      title,
      description: normalizeText(task.description) || null,
      responsible_profile_id: responsible.responsibleProfileId,
      responsible_name: responsibleText || responsible.responsibleName || null,
      due_date: dueDate,
      status,
      priority: priorityInfo.priority,
      completed_at: completedAt,
      created_by_profile_id: createdBy.profileId,
      created_at: createdAt,
      updated_at: updatedAt,
      import_batch_id: batchId,
      metadata: {
        source: "settings-json-tasks-migration",
        importBatchId: batchId,
        originalIndex: index,
        originalTaskType: task.taskType || task.type || null,
        originalFileId: task.fileId || null,
        originalFile: task.file || null,
        originalResponsibleUserId: task.responsibleUserId || null,
        originalResponsible: task.responsible || null,
        originalCreatedBy: task.createdBy || null,
        originalCreatedAt: task.createdAt || null,
        originalUpdatedAt: task.updatedAt || null,
        originalPriority: task.priority || null,
        taskTypeInferred: taskTypeInfo.inferred,
        taskTypeKnown: taskTypeInfo.known,
        fileMatchType: fileMatch.matchType,
        responsibleMatchType: responsible.matchType,
        createdByMatchType: createdBy.matchType
      }
    };

    if (isCompletedTaskStatus(row.status)) completedCount += 1;
    else activeCount += 1;
    if (isOverdueTask(row, today)) overdueCount += 1;

    const skipReasons = [];
    if (fileBound && !row.file_id) skipReasons.push(fileMatch.matchType === "ambiguous" ? "file_ambiguous" : "file_unmatched");
    if (responsible.matchType === "ambiguous") skipReasons.push("responsible_ambiguous");
    if (!row.title) skipReasons.push("missing_title");
    if (normalizeText(task.dueDate) && !row.due_date) skipReasons.push("invalid_due_date");
    if (normalizeText(task.completedAt) && !row.completed_at) skipReasons.push("invalid_completed_at");
    if (normalizeText(task.createdAt) && !row.created_at) skipReasons.push("invalid_created_at");
    if (normalizeText(task.updatedAt) && !row.updated_at) skipReasons.push("invalid_updated_at");
    if (skipReasons.length) skipped.push({ legacyId, reasons: skipReasons });

    const composite = [
      normalizeResponsibleNameKey(row.task_type),
      row.file_id || "",
      normalizeResponsibleNameKey(row.title),
      row.due_date || "",
      row.responsible_profile_id || ""
    ].join("|");
    const existing = existingMaps.byLegacyId.get(row.legacy_id) || existingMaps.byComposite.get(composite);

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
      sourceRecord: task,
      action,
      skipReasons,
      existingId: existing?.id || null,
      existingRecord: existing || null,
      fileBound,
      fileMatch,
      responsible,
      createdBy
    });
  });

  const sourceFields = [...new Set(tasks.flatMap(row => Object.keys(row || {})))].sort((a, b) => a.localeCompare(b, "tr"));

  return {
    summary: {
      sourceTaskCount: tasks.length,
      uniqueTaskCount: rows.length,
      duplicateTaskCount: duplicates.length,
      activeFileCount: files.filter(file => file && file.deleted_at == null).length,
      activeProfileCount: profiles.filter(profile => profile && profile.deleted_at == null && profile.is_active !== false).length,
      existingTaskCount: existingTasks.filter(row => row && row.deleted_at == null).length,
      fileBoundTaskCount,
      officePersonalTaskCount,
      fileMatchedCount: matchedFiles.length,
      fileUnmatchedCount: unmatchedFiles.length,
      fileAmbiguousCount: ambiguousFiles.length,
      responsibleMatchedCount: matchedResponsibleUsers.length,
      responsibleUnmatchedCount: unmatchedResponsibleUsers.length,
      responsibleAmbiguousCount: ambiguousResponsibleUsers.length,
      invalidDueDateCount: invalidDueDates.length,
      invalidCompletedAtCount: invalidCompletedAt.length,
      invalidCreatedAtCount: invalidCreatedAt.length,
      invalidUpdatedAtCount: invalidUpdatedAt.length,
      completedCount,
      activeCount,
      overdueCount,
      createCount,
      updateCount,
      alreadyExistingCount,
      skippedCount: skipped.length,
      manualDecisionCount: ambiguousFiles.length + ambiguousResponsibleUsers.length + unmatchedFiles.length
    },
    rows,
    duplicates,
    matchedFiles,
    unmatchedFiles,
    ambiguousFiles,
    matchedResponsibleUsers,
    unmatchedResponsibleUsers,
    ambiguousResponsibleUsers,
    invalidDueDates,
    invalidCompletedAt,
    invalidCreatedAt,
    invalidUpdatedAt,
    taskTypeMappings,
    statusMappings,
    unknownStatuses,
    priorityMappings,
    unknownPriorities,
    skipped,
    sourceFields,
    fieldMapping: taskFieldMapping
  };
}

export function publicTasksPlanReport(plan) {
  return {
    summary: plan.summary,
    sourceFields: plan.sourceFields,
    fieldMapping: plan.fieldMapping,
    duplicates: plan.duplicates,
    unmatchedFiles: plan.unmatchedFiles,
    ambiguousFiles: plan.ambiguousFiles,
    unmatchedResponsibleUsers: plan.unmatchedResponsibleUsers,
    ambiguousResponsibleUsers: plan.ambiguousResponsibleUsers,
    invalidDueDates: plan.invalidDueDates,
    invalidCompletedAt: plan.invalidCompletedAt,
    invalidCreatedAt: plan.invalidCreatedAt,
    invalidUpdatedAt: plan.invalidUpdatedAt,
    taskTypeMappings: plan.taskTypeMappings,
    statusMappings: plan.statusMappings,
    unknownStatuses: plan.unknownStatuses,
    priorityMappings: plan.priorityMappings,
    unknownPriorities: plan.unknownPriorities,
    skipped: plan.skipped,
    matchedFileSamples: plan.matchedFiles.slice(0, 20),
    matchedResponsibleSamples: plan.matchedResponsibleUsers.slice(0, 20),
    manualDecisionItems: [
      ...plan.ambiguousFiles.map(item => ({ type: "ambiguous_file", legacyId: item.legacyId, candidates: item.candidates })),
      ...plan.ambiguousResponsibleUsers.map(item => ({ type: "ambiguous_responsible", legacyId: item.legacyId, candidates: item.candidates })),
      ...plan.unmatchedFiles.map(item => ({ type: "unmatched_file", legacyId: item.legacyId, lookupKey: item.lookupKey }))
    ],
    plannedRows: plan.rows.map(item => ({
      legacyId: item.row.legacy_id,
      action: item.action,
      skipReasons: item.skipReasons,
      taskType: item.row.task_type,
      fileBound: item.fileBound,
      fileId: item.row.file_id,
      title: item.row.title,
      responsibleProfileId: item.row.responsible_profile_id,
      responsibleName: item.row.responsible_name,
      dueDate: item.row.due_date,
      status: item.row.status,
      priority: item.row.priority,
      completedAt: item.row.completed_at,
      createdByProfileId: item.row.created_by_profile_id
    }))
  };
}

export async function readTasksMigrationInputs({
  inputPath = "",
  useServiceRole = true,
  includeExistingTasks = true
} = {}) {
  const state = inputPath
    ? readStateFromFile(inputPath)
    : await readStateFromSupabase({ serviceRole: useServiceRole });

  let files = [];
  let profiles = [];
  let existingTasks = [];
  const warnings = [];

  try {
    files = await readFilesForTasks({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Dosya listesi okunamadi: ${error.message}`);
  }

  try {
    profiles = await readProfilesForTasks({ serviceRole: useServiceRole });
  } catch (error) {
    warnings.push(`Profil listesi okunamadi: ${error.message}`);
  }

  if (includeExistingTasks) {
    try {
      existingTasks = await readExistingTasks({ serviceRole: useServiceRole });
    } catch (error) {
      warnings.push(`Mevcut gorevler okunamadi: ${error.message}`);
    }
  }

  return { state, files, profiles, existingTasks, warnings };
}

export { writeJsonReport };
