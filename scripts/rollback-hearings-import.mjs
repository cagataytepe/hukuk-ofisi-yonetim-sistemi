import { createSupabaseClient, loadEnvFile, parseArgs, writeJsonReport } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const batchId = args.values["batch-id"];
const confirm = args.flags.has("confirm");
const reportPath = args.values.report || `work/hearings-rollback-${batchId || "preview"}.json`;

if (!batchId) {
  throw new Error("Rollback icin --batch-id zorunludur.");
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });

const { data: rows, error } = await supabase
  .from("hearings")
  .select("id, legacy_id, import_batch_id, metadata, deleted_at")
  .eq("import_batch_id", batchId)
  .is("deleted_at", null)
  .order("created_at", { ascending: true });

if (error) throw new Error(`Rollback hedefleri okunamadi: ${error.message}`);

const report = {
  mode: confirm ? "confirm" : "preview",
  batchId,
  targetCount: rows?.length || 0,
  affected: 0,
  targets: (rows || []).map(row => ({ id: row.id, legacyId: row.legacy_id })),
  errors: []
};

if (!confirm) {
  report.warning = "Onizleme modu. Gercek rollback icin --confirm kullanin.";
  writeJsonReport(reportPath, report);
  console.log("Durusmalar rollback onizleme tamamlandi. Veri degistirilmedi.");
  console.log(`Batch ID: ${batchId}`);
  console.log(`Hedef kayit: ${report.targetCount}`);
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

try {
  for (const row of rows || []) {
    const metadata = {
      ...(row.metadata || {}),
      rollbackBatchId: batchId,
      rolledBackAt: new Date().toISOString()
    };
    const { error: updateError } = await supabase
      .from("hearings")
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata
      })
      .eq("id", row.id);

    if (updateError) throw new Error(`Rollback failed (${row.legacy_id || row.id}): ${updateError.message}`);
    report.affected += 1;
  }
} catch (rollbackError) {
  report.errors.push({ message: rollbackError.message, stack: rollbackError.stack });
  writeJsonReport(reportPath, report);
  throw rollbackError;
}

writeJsonReport(reportPath, report);
console.log("Durusmalar rollback tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Pasiflenen kayit: ${report.affected}`);
console.log(`Rapor: ${reportPath}`);
