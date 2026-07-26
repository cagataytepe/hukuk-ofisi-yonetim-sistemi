import {
  buildTasksMigrationPlan,
  publicTasksPlanReport,
  readTasksMigrationInputs,
  writeJsonReport
} from "./tasks-migration-utils.mjs";
import { createSupabaseClient, loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const inputPath = args.values.input || "";
const batchId = args.values["batch-id"] || `tasks-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportPath = args.values.report || `work/tasks-import-${batchId}.json`;

const { state, files, profiles, existingTasks, warnings } = await readTasksMigrationInputs({
  inputPath,
  useServiceRole: true,
  includeExistingTasks: true
});

const plan = buildTasksMigrationPlan(state, {
  files,
  profiles,
  existingTasks,
  batchId
});

if (!execute) {
  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. Gercek import icin --execute kullanin.",
    batchId,
    warnings,
    ...publicTasksPlanReport(plan)
  };
  writeJsonReport(reportPath, report);
  warnings.forEach(warning => console.warn(warning));
  console.log("Gorevler import scripti dry-run modunda calisti. Veri yazilmadi.");
  console.log(`Batch ID: ${batchId}`);
  console.log(`Olusturulacak: ${report.summary.createCount}`);
  console.log(`Guncellenecek: ${report.summary.updateCount}`);
  console.log(`Zaten bulunan: ${report.summary.alreadyExistingCount}`);
  console.log(`Atlanacak: ${report.summary.skippedCount}`);
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });
const result = {
  mode: "execute",
  batchId,
  startedAt: new Date().toISOString(),
  inserted: 0,
  updated: 0,
  skipped: 0,
  unchanged: 0,
  errors: []
};

function stripNullTimestampDefaults(payload = {}) {
  const next = { ...payload };
  if (!next.created_at) delete next.created_at;
  if (!next.updated_at) delete next.updated_at;
  return next;
}

function insertMetadata(row) {
  return {
    ...(row.metadata || {}),
    importBatchId: batchId,
    createdByImportBatchId: batchId
  };
}

function updateMetadata(existing = {}, row = {}) {
  return {
    ...(existing.metadata || {}),
    ...(row.metadata || {}),
    importBatchId: existing.metadata?.importBatchId || row.metadata?.importBatchId || batchId,
    lastTasksImportBatchId: batchId
  };
}

function insertPayload(row) {
  return stripNullTimestampDefaults({
    ...row,
    metadata: insertMetadata(row),
    import_batch_id: batchId,
    updated_at: row.updated_at || new Date().toISOString()
  });
}

function updatePayload(row, existingRecord = {}) {
  const payload = stripNullTimestampDefaults({
    ...row,
    metadata: updateMetadata(existingRecord, row),
    import_batch_id: batchId,
    updated_at: row.updated_at || new Date().toISOString()
  });
  delete payload.id;
  delete payload.created_at;
  return payload;
}

async function insertTask(row) {
  const { data, error } = await supabase
    .from("tasks")
    .insert(insertPayload(row))
    .select("id")
    .single();
  if (error) throw new Error(`tasks insert failed (${row.legacy_id}): ${error.message}`);
  return data;
}

async function updateTask(id, row, existingRecord = {}) {
  const { data, error } = await supabase
    .from("tasks")
    .update(updatePayload(row, existingRecord))
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new Error(`tasks update failed (${row.legacy_id}): ${error.message}`);
  return data;
}

try {
  for (const item of plan.rows) {
    if (item.action === "skip") {
      result.skipped += 1;
      continue;
    }
    if (item.action === "existing") {
      result.unchanged += 1;
      continue;
    }
    if (item.action === "update") {
      if (!item.existingId) throw new Error(`Guncellenecek gorev id bulunamadi: ${item.row.legacy_id}`);
      await updateTask(item.existingId, item.row, item.existingRecord || {});
      result.updated += 1;
      continue;
    }
    await insertTask(item.row);
    result.inserted += 1;
  }
} catch (error) {
  result.errors.push({ message: error.message, stack: error.stack });
  writeJsonReport(reportPath, { ...result, plan: publicTasksPlanReport(plan) });
  throw error;
}

result.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, { ...result, plan: publicTasksPlanReport(plan) });

console.log("Gorevler import tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Eklenen: ${result.inserted}`);
console.log(`Guncellenen: ${result.updated}`);
console.log(`Degismeyen: ${result.unchanged}`);
console.log(`Atlanan: ${result.skipped}`);
console.log(`Rapor: ${reportPath}`);
