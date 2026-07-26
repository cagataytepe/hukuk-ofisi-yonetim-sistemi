import { buildMigrationPlan, createSupabaseClient, loadEnvFile, parseArgs, publicPlanReport, readProfiles, readStateFromFile, readStateFromSupabase, writeJsonReport } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const inputPath = args.values.input;
const batchId = args.values["batch-id"] || `files-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const reportPath = args.values.report || `work/files-import-${batchId}.json`;
const skipProfiles = args.flags.has("skip-profiles");

const readWithServiceRole = execute || args.flags.has("use-service-role");
const state = inputPath
  ? readStateFromFile(inputPath)
  : await readStateFromSupabase({ serviceRole: readWithServiceRole });
const profiles = skipProfiles ? [] : await readProfiles({ serviceRole: readWithServiceRole });
const plan = buildMigrationPlan(state, profiles, { batchId });

if (!execute) {
  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. Gercek import icin --execute kullanin.",
    batchId,
    ...publicPlanReport(plan)
  };
  writeJsonReport(reportPath, report);
  console.log("Import scripti dry-run modunda calisti. Veri yazilmadi.");
  console.log(`Okunan aktif profil: ${report.summary.activeProfileCount}`);
  if (!skipProfiles && report.summary.activeProfileCount === 0) {
    console.warn("Aktif profil okunamadi veya sorgu bos dondu; sorumlu avukat UUID eslestirmesi yapilamadi.");
  }
  console.log(`Benzersiz dosya: ${report.summary.canonicalFileCount}`);
  console.log(`Rapor: ${reportPath}`);
  process.exit(0);
}

const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });
const result = {
  mode: "execute",
  batchId,
  startedAt: new Date().toISOString(),
  clients: { inserted: 0, updated: 0 },
  files: { inserted: 0, updated: 0 },
  fileParties: { inserted: 0, updated: 0 },
  errors: []
};

async function selectSingle(table, queryBuilder) {
  const { data, error } = await queryBuilder.limit(1).maybeSingle();
  if (error) throw new Error(`${table} select failed: ${error.message}`);
  return data || null;
}

async function findClient(row) {
  if (row.legacy_id) {
    const byLegacy = await selectSingle("clients", supabase.from("clients").select("id, metadata").eq("legacy_id", row.legacy_id).is("deleted_at", null));
    if (byLegacy) return byLegacy;
  }
  if (row.tax_id) {
    const byTax = await selectSingle("clients", supabase.from("clients").select("id, metadata").eq("tax_id", row.tax_id).is("deleted_at", null));
    if (byTax) return byTax;
  }
  return selectSingle("clients", supabase.from("clients").select("id, metadata").eq("name", row.name).is("deleted_at", null));
}

async function findByLegacy(table, legacyId) {
  if (!legacyId) return null;
  return selectSingle(table, supabase.from(table).select("id, metadata").eq("legacy_id", legacyId).is("deleted_at", null));
}

function insertMetadata(row) {
  return {
    ...(row.metadata || {}),
    importBatchId: result.batchId,
    createdByImportBatchId: result.batchId
  };
}

function updateMetadata(existing, row) {
  return {
    ...(existing?.metadata || {}),
    ...(row.metadata || {}),
    importBatchId: existing?.metadata?.importBatchId || row.metadata?.importBatchId || result.batchId,
    lastFilesImportBatchId: result.batchId
  };
}

async function insertRow(table, row) {
  const payload = { ...row, metadata: insertMetadata(row) };
  const { data, error } = await supabase.from(table).insert(payload).select("id, metadata").single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data;
}

async function updateRow(table, id, existing, row) {
  const payload = {
    ...row,
    metadata: updateMetadata(existing, row),
    updated_at: new Date().toISOString()
  };
  delete payload.id;
  const { data, error } = await supabase.from(table).update(payload).eq("id", id).select("id, metadata").single();
  if (error) throw new Error(`${table} update failed: ${error.message}`);
  return data;
}

async function upsertClient(clientItem) {
  const existing = await findClient(clientItem.row);
  if (existing) {
    result.clients.updated += 1;
    return updateRow("clients", existing.id, existing, clientItem.row);
  }
  result.clients.inserted += 1;
  return insertRow("clients", clientItem.row);
}

async function upsertByLegacy(table, row, counter) {
  const existing = await findByLegacy(table, row.legacy_id);
  if (existing) {
    result[counter].updated += 1;
    return updateRow(table, existing.id, existing, row);
  }
  result[counter].inserted += 1;
  return insertRow(table, row);
}

try {
  const clientIdsByKey = new Map();
  for (const clientItem of plan.clients) {
    const saved = await upsertClient(clientItem);
    clientIdsByKey.set(clientItem.key, saved.id);
  }

  const fileIdsByLegacyId = new Map();
  for (const fileItem of plan.files) {
    const firstClientParty = plan.fileParties.find(party => party.fileLegacyId === fileItem.row.legacy_id);
    const clientId = firstClientParty ? clientIdsByKey.get(firstClientParty.clientKey) : null;
    const saved = await upsertByLegacy("files", {
      ...fileItem.row,
      client_id: clientId || null
    }, "files");
    fileIdsByLegacyId.set(fileItem.row.legacy_id, saved.id);
  }

  for (const partyItem of plan.fileParties) {
    const fileId = fileIdsByLegacyId.get(partyItem.fileLegacyId);
    const clientId = clientIdsByKey.get(partyItem.clientKey);
    if (!fileId) throw new Error(`file_id bulunamadi: ${partyItem.fileLegacyId}`);
    await upsertByLegacy("file_parties", {
      ...partyItem.row,
      file_id: fileId,
      client_id: clientId || null
    }, "fileParties");
  }
} catch (error) {
  result.errors.push({
    message: error.message,
    stack: error.stack
  });
  writeJsonReport(reportPath, { ...result, plan: publicPlanReport(plan) });
  throw error;
}

result.finishedAt = new Date().toISOString();
writeJsonReport(reportPath, { ...result, plan: publicPlanReport(plan) });

console.log("Dosyalar import tamamlandi.");
console.log(`Batch ID: ${batchId}`);
console.log(`Clients: +${result.clients.inserted} / guncellenen ${result.clients.updated}`);
console.log(`Files: +${result.files.inserted} / guncellenen ${result.files.updated}`);
console.log(`File parties: +${result.fileParties.inserted} / guncellenen ${result.fileParties.updated}`);
console.log(`Rapor: ${reportPath}`);
