import {
  buildDeadlinesMigrationPlan,
  publicDeadlinesPlanReport,
  readDeadlinesMigrationInputs,
  writeJsonReport
} from "./deadlines-migration-utils.mjs";
import { createSupabaseClient, loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const inputPath = args.values.input || "";
const batchId = args.values["batch-id"] || `deadlines-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportPath = args.values.report || `work/deadlines-import-${batchId}.json`;

const { state, files, profiles, existingDeadlines, warnings } = await readDeadlinesMigrationInputs({
  inputPath,
  useServiceRole: true,
  includeExistingDeadlines: true
});

const plan = buildDeadlinesMigrationPlan(state, {
  files,
  profiles,
  existingDeadlines,
  batchId
});

if (!execute) {
  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. Gercek import icin --execute kullanin.",
    batchId,
    warnings,
    ...publicDeadlinesPlanReport(plan)
  };
  writeJsonReport(reportPath, report);
  warnings.forEach(warning => console.warn(warning));
  console.log("Sureli isler import scripti dry-run modunda calisti. Veri yazilmadi.");
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
    lastDeadlinesImportBatchId: batchId
  };
}

function insertPayload(row) {
  return {
    ...row,
    metadata: insertMetadata(row),
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  };
}

function updatePayload(row, existingRecord = {}) {
  const payload = {
    ...row,
    metadata: updateMetadata(existingRecord, row),
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  };
  delete payload.id;
  return payload;
}

async function insertDeadline(row) {
  const { data, error } = await supabase
    .from("deadlines")
    .insert(insertPayload(row))
    .select("id")
    .single();
  if (error) throw new Error(`deadlines insert failed (${row.legacy_id}): ${error.message}`);
  return data;
}

async function updateDeadline(id, row, existingRecord = {}) {
  const { data, error } = await supabase
    .from("deadlines")
    .update(updatePayload(row, existingRecord))
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new Error(`deadlines update failed (${row.legacy_id}): ${error.message}`);
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
      if (!item.existingId) throw new Error(`Guncellenecek sureli is id bulunamadi: ${item.row.legacy_id}`);
      await updateDeadline(item.existingId, item.row, item.existingRecord || {});
      result.updated += 1;
      continue;
    }
    await insertDeadline(item.row);
    result.inserted += 1;
  }
} catch (error) {
  result.errors.push({ message: error.message, stack: error.stack });
  writeJsonReport(reportPath, { ...result, plan: publicDeadlinesPlanReport(plan) });
  throw error;
}

result.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, { ...result, plan: publicDeadlinesPlanReport(plan) });

console.log("Sureli isler import tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Eklenen: ${result.inserted}`);
console.log(`Guncellenen: ${result.updated}`);
console.log(`Degismeyen: ${result.unchanged}`);
console.log(`Atlanan: ${result.skipped}`);
console.log(`Rapor: ${reportPath}`);
