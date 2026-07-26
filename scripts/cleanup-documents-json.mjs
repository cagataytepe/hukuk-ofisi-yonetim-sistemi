import fs from "node:fs";
import path from "node:path";
import {
  appStateStorageKey,
  createSupabaseClient,
  loadEnvFile,
  parseArgs,
  readStateFromFile,
  writeJsonReport
} from "./files-migration-utils.mjs";

const defaultReportPath = path.join(process.cwd(), "work", "documents-json-cleanup-report.json");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(filePath) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

function bytesFromBase64Like(value) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(",");
  const payload = trimmed.startsWith("data:") && commaIndex >= 0
    ? trimmed.slice(commaIndex + 1)
    : trimmed;
  const normalized = payload.replace(/\s+/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function isInlineFileValue(key, value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalizedKey = String(key || "").toLocaleLowerCase("tr-TR");
  return normalizedKey === "filedata"
    || normalizedKey === "base64"
    || normalizedKey === "contentbase64"
    || value.trim().startsWith("data:");
}

function walk(value, visitor, pathParts = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, [...pathParts, String(index)]));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    visitor(key, child, value, pathParts);
    walk(child, visitor, [...pathParts, key]);
  });
}

function countDocumentArrays(state) {
  const topLevelDocuments = asArray(state.documents).length;
  const fileDocuments = asArray(state.files)
    .reduce((total, file) => total + asArray(file?.documents).length, 0);
  const legacyCaseDocuments = asArray(state.cases)
    .reduce((total, file) => total + asArray(file?.documents).length, 0);
  const metadataDocuments = [...asArray(state.files), ...asArray(state.cases)]
    .reduce((total, file) => total + asArray(file?.metadata?.documents).length, 0);
  const supportingDocuments = [...asArray(state.files), ...asArray(state.cases)]
    .reduce((total, file) => total + asArray(file?.supportingDocuments).length + asArray(file?.metadata?.supportingDocuments).length, 0);

  return {
    topLevelDocuments,
    fileDocuments,
    legacyCaseDocuments,
    metadataDocuments,
    supportingDocuments,
    totalDocumentRecords: topLevelDocuments + fileDocuments + legacyCaseDocuments + metadataDocuments
  };
}

function analyzeInlinePayloads(state) {
  const payloads = [];
  walk(state, (key, child, parent, pathParts) => {
    if (!isInlineFileValue(key, child)) return;
    const bytes = bytesFromBase64Like(child);
    payloads.push({
      path: [...pathParts, key].join("."),
      key,
      bytes,
      parentKeys: Object.keys(parent || {}).sort()
    });
  });

  const totalBytes = payloads.reduce((total, item) => total + item.bytes, 0);
  return {
    inlinePayloadCount: payloads.length,
    approximateBytes: totalBytes,
    approximateMb: Number((totalBytes / 1024 / 1024).toFixed(3)),
    paths: payloads.map(item => ({ path: item.path, approximateBytes: item.bytes }))
  };
}

function removeInlineDocumentPayload(record) {
  if (!record || typeof record !== "object") return record;
  const clone = { ...record };
  delete clone.fileData;
  delete clone.fileName;
  delete clone.storageBucket;
  delete clone.storagePath;
  delete clone.objectPath;
  delete clone.previewUrl;
  delete clone.downloadUrl;
  if (clone.metadata && typeof clone.metadata === "object") {
    clone.metadata = { ...clone.metadata };
    delete clone.metadata.fileData;
    delete clone.metadata.fileName;
    delete clone.metadata.storageBucket;
    delete clone.metadata.storagePath;
    delete clone.metadata.objectPath;
    delete clone.metadata.previewUrl;
    delete clone.metadata.downloadUrl;
  }
  return clone;
}

function removeDocumentJson(state) {
  const cleaned = structuredClone(state);
  delete cleaned.documents;

  ["files", "cases"].forEach(collectionKey => {
    if (!Array.isArray(cleaned[collectionKey])) return;
    cleaned[collectionKey] = cleaned[collectionKey].map(file => {
      if (!file || typeof file !== "object") return file;
      const nextFile = { ...file };
      delete nextFile.documents;
      nextFile.supportingDocuments = asArray(nextFile.supportingDocuments).map(removeInlineDocumentPayload);
      if (nextFile.instrumentInfo && typeof nextFile.instrumentInfo === "object") {
        nextFile.instrumentInfo = removeInlineDocumentPayload(nextFile.instrumentInfo);
      }
      if (nextFile.metadata && typeof nextFile.metadata === "object") {
        nextFile.metadata = { ...nextFile.metadata };
        delete nextFile.metadata.documents;
        nextFile.metadata.supportingDocuments = asArray(nextFile.metadata.supportingDocuments).map(removeInlineDocumentPayload);
      }
      return nextFile;
    });
  });

  return cleaned;
}

async function readSettingsState(supabase) {
  const { data, error } = await supabase
    .from("settings")
    .select("id, setting_value")
    .eq("setting_key", appStateStorageKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`settings state okunamadi: ${error.message}`);
  if (!data?.setting_value) throw new Error(`${appStateStorageKey} settings kaydi bulunamadi.`);
  return data;
}

async function writeSettingsState(supabase, cleanedState) {
  const { data, error } = await supabase
    .from("settings")
    .update({
      setting_value: cleanedState,
      updated_at: new Date().toISOString()
    })
    .eq("setting_key", appStateStorageKey)
    .is("deleted_at", null)
    .select("id, updated_at")
    .maybeSingle();

  if (error) throw new Error(`settings state guncellenemedi: ${error.message}`);
  if (!data?.id) throw new Error("settings state guncellemesi sonucunda kayit donmedi.");
  return data;
}

async function getDatabaseDocumentStatus(supabase) {
  const [documentsResult, supportingResult, bucketsResult] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("supporting_documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.storage.listBuckets()
  ]);

  return {
    publicDocuments: documentsResult.error
      ? { readable: false, error: documentsResult.error.message }
      : { readable: true, activeRows: documentsResult.count ?? 0 },
    publicSupportingDocuments: supportingResult.error
      ? { readable: false, error: supportingResult.error.message }
      : { readable: true, activeRows: supportingResult.count ?? 0 },
    storageBuckets: bucketsResult.error
      ? { readable: false, error: bucketsResult.error.message, buckets: [] }
      : {
          readable: true,
          buckets: asArray(bucketsResult.data).map(bucket => ({
            id: bucket.id,
            name: bucket.name,
            public: Boolean(bucket.public)
          }))
        }
  };
}

async function restoreFromBackup({ backupPath, execute, reportPath }) {
  const absoluteBackupPath = path.resolve(backupPath || "");
  if (!backupPath || !fs.existsSync(absoluteBackupPath)) {
    throw new Error("Rollback icin --backup ile gecerli bir yedek dosyasi belirtin.");
  }

  const backupState = JSON.parse(fs.readFileSync(absoluteBackupPath, "utf8"));
  const report = {
    mode: execute ? "restore" : "restore-dry-run",
    backupPath: absoluteBackupPath,
    execute,
    wouldRestoreSettingsKey: appStateStorageKey,
    restored: false
  };

  if (execute) {
    const supabase = createSupabaseClient({ serviceRole: true });
    report.restoreResult = await writeSettingsState(supabase, backupState);
    report.restored = true;
  }

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  loadEnvFile();
  const args = parseArgs();
  const execute = args.flags.has("execute");
  const restore = args.flags.has("restore");
  const reportPath = path.resolve(args.values.report || defaultReportPath);

  if (restore) {
    await restoreFromBackup({ backupPath: args.values.backup, execute, reportPath });
    return;
  }

  const supabase = args.values.input ? null : createSupabaseClient({ serviceRole: true });
  const stateRecord = args.values.input
    ? { id: null, setting_value: readStateFromFile(args.values.input) }
    : await readSettingsState(supabase);
  const state = stateRecord.setting_value;
  const before = {
    documentArrays: countDocumentArrays(state),
    inlinePayloads: analyzeInlinePayloads(state)
  };
  const cleanedState = removeDocumentJson(state);
  const after = {
    documentArrays: countDocumentArrays(cleanedState),
    inlinePayloads: analyzeInlinePayloads(cleanedState)
  };
  const database = supabase
    ? await getDatabaseDocumentStatus(supabase)
    : { skipped: true, reason: "--input kullanildigi icin Supabase durumu sorgulanmadi." };
  const backupPath = path.resolve(args.values.backup || path.join("work", `documents-json-backup-${timestamp()}.json`));

  const report = {
    mode: execute ? "execute" : "dry-run",
    execute,
    source: args.values.input ? path.resolve(args.values.input) : `settings:${appStateStorageKey}`,
    settingsId: stateRecord.id,
    before,
    after,
    estimatedFreedBytes: Math.max(0, before.inlinePayloads.approximateBytes - after.inlinePayloads.approximateBytes),
    estimatedFreedMb: Number((Math.max(0, before.inlinePayloads.approximateBytes - after.inlinePayloads.approximateBytes) / 1024 / 1024).toFixed(3)),
    database,
    backupPath: execute ? backupPath : null,
    rollbackCommand: execute
      ? `npm.cmd run cleanup:documents-json -- --restore --backup "${backupPath}" --execute`
      : null,
    note: execute
      ? "Gercek temizlik uygulandi; yedekten rollback komutu raporda yer alir."
      : "Dry-run: settings JSON degistirilmedi. Gercek temizlik icin --execute kullanin."
  };

  if (execute) {
    ensureDir(backupPath);
    fs.writeFileSync(backupPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    report.updateResult = await writeSettingsState(supabase, cleanedState);
  }

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

await main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
