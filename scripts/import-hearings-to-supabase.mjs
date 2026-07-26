import {
  buildHearingsMigrationPlan,
  publicHearingsPlanReport,
  readHearingsMigrationInputs,
  writeJsonReport
} from "./hearings-migration-utils.mjs";
import { createSupabaseClient, loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const inputPath = args.values.input || "";
const batchId = args.values["batch-id"] || `hearings-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportPath = args.values.report || `work/hearings-import-${batchId}.json`;

const { state, files, profiles, existingHearings, warnings } = await readHearingsMigrationInputs({
  inputPath,
  useServiceRole: execute || args.flags.has("use-service-role"),
  includeExistingHearings: true
});

const plan = buildHearingsMigrationPlan(state, {
  files,
  profiles,
  existingHearings,
  batchId
});

if (!execute) {
  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. Gercek import icin --execute kullanin.",
    batchId,
    warnings,
    ...publicHearingsPlanReport(plan)
  };
  writeJsonReport(reportPath, report);
  warnings.forEach(warning => console.warn(warning));
  console.log("Durusmalar import scripti dry-run modunda calisti. Veri yazilmadi.");
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
  warnings,
  inserted: 0,
  updated: 0,
  skipped: 0,
  unchanged: 0,
  errors: []
};

function importMetadata(row) {
  return {
    ...(row.metadata || {}),
    importBatchId: batchId,
    lastHearingsImportBatchId: batchId
  };
}

function rowPayload(row, existingMetadata = {}) {
  return {
    ...row,
    metadata: {
      ...(existingMetadata || {}),
      ...importMetadata(row)
    },
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  };
}

async function insertHearing(row) {
  const payload = rowPayload(row);
  const { data, error } = await supabase
    .from("hearings")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`hearings insert failed (${row.legacy_id}): ${error.message}`);
  return data;
}

async function updateHearing(id, row, existingMetadata = {}) {
  const payload = rowPayload(row, existingMetadata);
  delete payload.id;
  const { data, error } = await supabase
    .from("hearings")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new Error(`hearings update failed (${row.legacy_id}): ${error.message}`);
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
      if (!item.existingId) throw new Error(`Guncellenecek durusma id bulunamadi: ${item.row.legacy_id}`);
      await updateHearing(item.existingId, item.row, item.existingRecord?.metadata || {});
      result.updated += 1;
      continue;
    }
    await insertHearing(item.row);
    result.inserted += 1;
  }
} catch (error) {
  result.errors.push({ message: error.message, stack: error.stack });
  writeJsonReport(reportPath, { ...result, plan: publicHearingsPlanReport(plan) });
  throw error;
}

result.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, { ...result, plan: publicHearingsPlanReport(plan) });

console.log("Durusmalar import tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Eklenen: ${result.inserted}`);
console.log(`Guncellenen: ${result.updated}`);
console.log(`Degismeyen: ${result.unchanged}`);
console.log(`Atlanan: ${result.skipped}`);
console.log(`Rapor: ${reportPath}`);
