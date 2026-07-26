import { createSupabaseClient, loadEnvFile, parseArgs, writeJsonReport } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const batchId = args.values["batch-id"];
const confirm = args.flags.has("confirm");
const hardDelete = args.flags.has("hard-delete");
const reportPath = args.values.report || `work/files-rollback-${batchId || "missing-batch"}.json`;

if (!batchId) {
  throw new Error("Rollback icin --batch-id zorunludur.");
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });

async function listCreatedRows(table) {
  const { data, error } = await supabase
    .from(table)
    .select("id, legacy_id, metadata")
    .eq("metadata->>createdByImportBatchId", batchId)
    .is("deleted_at", null);
  if (error) throw new Error(`${table} rollback listesi okunamadi: ${error.message}`);
  return data || [];
}

async function softDeleteRows(table, rows) {
  if (!rows.length) return 0;
  const rollbackAt = new Date().toISOString();
  for (const row of rows) {
    const { error } = await supabase
      .from(table)
      .update({
        deleted_at: rollbackAt,
        metadata: {
          ...(row.metadata || {}),
          rollbackBatchId: batchId,
          rollbackAt
        }
      })
      .eq("id", row.id);
    if (error) throw new Error(`${table} soft delete basarisiz: ${error.message}`);
  }
  return rows.length;
}

async function hardDeleteRows(table, rows) {
  if (!rows.length) return 0;
  const ids = rows.map(row => row.id);
  const { error } = await supabase.from(table).delete().in("id", ids);
  if (error) throw new Error(`${table} hard delete basarisiz: ${error.message}`);
  return ids.length;
}

const fileParties = await listCreatedRows("file_parties");
const files = await listCreatedRows("files");
const clients = await listCreatedRows("clients");

const report = {
  mode: confirm ? "execute" : "preview",
  batchId,
  hardDelete,
  counts: {
    fileParties: fileParties.length,
    files: files.length,
    clients: clients.length
  }
};

if (!confirm) {
  report.warning = "Rollback preview modunda. Veri silinmedi/pasiflenmedi. Calistirmak icin --confirm ekleyin.";
  writeJsonReport(reportPath, report);
  console.log("Rollback preview tamamlandi. Veri degistirilmedi.");
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

const deleteFn = hardDelete ? hardDeleteRows : softDeleteRows;

report.deleted = {
  fileParties: await deleteFn("file_parties", fileParties),
  files: await deleteFn("files", files),
  clients: await deleteFn("clients", clients)
};
report.finishedAt = new Date().toISOString();

writeJsonReport(reportPath, report);

console.log("Rollback tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Rapor: ${reportPath}`);
