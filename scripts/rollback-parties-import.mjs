import { createSupabaseClient, loadEnvFile, parseArgs, writeJsonReport } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const batchId = args.values["batch-id"];
const confirm = args.flags.has("confirm");
const reportPath = args.values.report || `work/parties-rollback-${batchId || "preview"}.json`;

if (!batchId) {
  throw new Error("Rollback icin --batch-id zorunludur.");
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });

async function readBatchFileParties() {
  const result = await supabase
    .from("file_parties")
    .select("id, legacy_id, client_id, import_batch_id, metadata, deleted_at")
    .eq("import_batch_id", batchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (result.error && /import_batch_id/i.test(result.error.message || "")) {
    const fallback = await supabase
      .from("file_parties")
      .select("id, legacy_id, client_id, metadata, deleted_at")
      .eq("metadata->>createdByImportBatchId", batchId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (fallback.error) throw new Error(`file_parties rollback listesi okunamadi: ${fallback.error.message}`);
    return fallback.data || [];
  }
  if (result.error) throw new Error(`file_parties rollback listesi okunamadi: ${result.error.message}`);
  return result.data || [];
}

async function readBatchClients() {
  const result = await supabase
    .from("clients")
    .select("id, legacy_id, name, import_batch_id, metadata, deleted_at")
    .eq("import_batch_id", batchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (result.error && /import_batch_id/i.test(result.error.message || "")) {
    const fallback = await supabase
      .from("clients")
      .select("id, legacy_id, name, metadata, deleted_at")
      .eq("metadata->>createdByImportBatchId", batchId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (fallback.error) throw new Error(`clients rollback listesi okunamadi: ${fallback.error.message}`);
    return fallback.data || [];
  }
  if (result.error) throw new Error(`clients rollback listesi okunamadi: ${result.error.message}`);
  return result.data || [];
}

async function hasActiveFileParty(clientId, ignoredFilePartyIds = []) {
  if (!clientId) return false;
  let query = supabase
    .from("file_parties")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (ignoredFilePartyIds.length) query = query.not("id", "in", `(${ignoredFilePartyIds.join(",")})`);
  const { count, error } = await query;
  if (error) throw new Error(`client iliskileri okunamadi (${clientId}): ${error.message}`);
  return Number(count || 0) > 0;
}

async function softDeleteRow(table, row) {
  const now = new Date().toISOString();
  const metadata = {
    ...(row.metadata || {}),
    rollbackBatchId: batchId,
    rolledBackAt: now
  };
  const { error } = await supabase
    .from(table)
    .update({
      deleted_at: now,
      updated_at: now,
      metadata
    })
    .eq("id", row.id);
  if (error) throw new Error(`${table} rollback basarisiz (${row.legacy_id || row.id}): ${error.message}`);
}

const fileParties = await readBatchFileParties();
const clients = await readBatchClients();
const filePartyIds = fileParties.map(row => row.id);
const safeClientTargets = [];
const sharedClientTargets = [];

for (const client of clients) {
  if (await hasActiveFileParty(client.id, filePartyIds)) sharedClientTargets.push(client);
  else safeClientTargets.push(client);
}

const report = {
  mode: confirm ? "confirm" : "preview",
  batchId,
  targets: {
    fileParties: fileParties.map(row => ({ id: row.id, legacyId: row.legacy_id, clientId: row.client_id })),
    clients: safeClientTargets.map(row => ({ id: row.id, legacyId: row.legacy_id, name: row.name })),
    sharedClientsNotRolledBack: sharedClientTargets.map(row => ({ id: row.id, legacyId: row.legacy_id, name: row.name }))
  },
  counts: {
    fileParties: fileParties.length,
    clientsSafeToSoftDelete: safeClientTargets.length,
    sharedClientsSkipped: sharedClientTargets.length
  },
  affected: {
    fileParties: 0,
    clients: 0
  },
  errors: []
};

if (!confirm) {
  report.warning = "Onizleme modu. Gercek rollback icin --confirm kullanin. Hard delete yapilmaz; sadece soft delete uygulanir.";
  writeJsonReport(reportPath, report);
  console.log("Taraflar rollback onizleme tamamlandi. Veri degistirilmedi.");
  console.log(`Batch ID: ${batchId}`);
  console.log(`Soft-delete hedef file_party: ${report.counts.fileParties}`);
  console.log(`Soft-delete hedef client: ${report.counts.clientsSafeToSoftDelete}`);
  console.log(`Paylasimli client atlanacak: ${report.counts.sharedClientsSkipped}`);
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

try {
  for (const row of fileParties) {
    await softDeleteRow("file_parties", row);
    report.affected.fileParties += 1;
  }

  for (const row of safeClientTargets) {
    await softDeleteRow("clients", row);
    report.affected.clients += 1;
  }
} catch (error) {
  report.errors.push({ message: error.message, stack: error.stack });
  writeJsonReport(reportPath, report);
  throw error;
}

report.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, report);

console.log("Taraflar rollback tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Pasiflenen file_party: ${report.affected.fileParties}`);
console.log(`Pasiflenen client: ${report.affected.clients}`);
console.log(`Rapor: ${reportPath}`);
