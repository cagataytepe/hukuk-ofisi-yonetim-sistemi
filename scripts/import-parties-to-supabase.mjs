import { createSupabaseClient, loadEnvFile, parseArgs } from "./files-migration-utils.mjs";
import {
  buildPartiesMigrationPlan,
  metadataForInsert,
  metadataForUpdate,
  publicPartiesPlanReport,
  readPartiesMigrationInputs,
  writeJsonReport
} from "./parties-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const inputPath = args.values.input || "";
const batchId = args.values["batch-id"] || `parties-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportPath = args.values.report || `work/parties-import-${batchId}.json`;

const { state, files, existingClients, existingFileParties, warnings } = await readPartiesMigrationInputs({
  inputPath,
  useServiceRole: true,
  includeExisting: true
});

const plan = buildPartiesMigrationPlan(state, {
  files,
  existingClients,
  existingFileParties,
  batchId
});

if (!execute) {
  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. Gercek import icin --execute kullanin.",
    batchId,
    warnings,
    ...publicPartiesPlanReport(plan)
  };
  writeJsonReport(reportPath, report);
  warnings.forEach(warning => console.warn(warning));
  console.log("Taraflar import scripti dry-run modunda calisti. Veri yazilmadi.");
  console.log(`Batch ID: ${batchId}`);
  console.log(`Olusturulacak client: ${report.summary.plannedClientCreateCount}`);
  console.log(`Olusturulacak file_party: ${report.summary.plannedFilePartyCreateCount}`);
  console.log(`Guncellenecek file_party: ${report.summary.plannedFilePartyUpdateCount}`);
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });
const result = {
  mode: "execute",
  batchId,
  startedAt: new Date().toISOString(),
  clients: { inserted: 0, existing: 0 },
  fileParties: { inserted: 0, updated: 0, existing: 0, skipped: 0 },
  errors: []
};

function cleanPayload(row = {}) {
  const payload = { ...row };
  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) delete payload[key];
  });
  return payload;
}

async function insertClient(row) {
  const payload = cleanPayload({
    ...row,
    metadata: metadataForInsert(row, batchId),
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  });
  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("id, legacy_id")
    .single();
  if (error) throw new Error(`clients insert failed (${row.legacy_id}): ${error.message}`);
  return data;
}

async function insertFileParty(row) {
  const payload = cleanPayload({
    ...row,
    metadata: metadataForInsert(row, batchId),
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  });
  const { data, error } = await supabase
    .from("file_parties")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`file_parties insert failed (${row.legacy_id}): ${error.message}`);
  return data;
}

async function updateFileParty(id, row, existingRecord = {}) {
  const payload = cleanPayload({
    ...row,
    metadata: metadataForUpdate(existingRecord, row, batchId),
    import_batch_id: batchId,
    updated_at: new Date().toISOString()
  });
  delete payload.id;
  delete payload.created_at;
  const { data, error } = await supabase
    .from("file_parties")
    .update(payload)
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new Error(`file_parties update failed (${row.legacy_id}): ${error.message}`);
  return data;
}

try {
  const createdClientIdsByLegacy = new Map();
  for (const item of plan.clientsToCreate) {
    const saved = await insertClient(item.row);
    createdClientIdsByLegacy.set(item.row.legacy_id, saved.id);
    result.clients.inserted += 1;
  }

  for (const item of plan.rows) {
    if (item.action === "existing") {
      result.fileParties.existing += 1;
      continue;
    }

    const row = { ...item.row };
    if (!row.client_id && item.plannedClientLegacyId) {
      row.client_id = createdClientIdsByLegacy.get(item.plannedClientLegacyId) || null;
    }

    if (!row.client_id) {
      result.fileParties.skipped += 1;
      result.errors.push({
        legacyId: row.legacy_id,
        message: "client_id bulunamadi; file_party atlandi."
      });
      continue;
    }

    if (item.action === "update") {
      if (!item.existingId) throw new Error(`Guncellenecek file_party id bulunamadi: ${row.legacy_id}`);
      if (item.existingRecord?.legacy_id) row.legacy_id = item.existingRecord.legacy_id;
      await updateFileParty(item.existingId, row, item.existingRecord || {});
      result.fileParties.updated += 1;
      continue;
    }

    await insertFileParty(row);
    result.fileParties.inserted += 1;
  }
} catch (error) {
  result.errors.push({ message: error.message, stack: error.stack });
  writeJsonReport(reportPath, { ...result, plan: publicPartiesPlanReport(plan) });
  throw error;
}

result.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, { ...result, plan: publicPartiesPlanReport(plan) });

console.log("Taraflar import tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Clients: +${result.clients.inserted}`);
console.log(`File parties: +${result.fileParties.inserted} / guncellenen ${result.fileParties.updated} / mevcut ${result.fileParties.existing} / atlanan ${result.fileParties.skipped}`);
console.log(`Rapor: ${reportPath}`);
