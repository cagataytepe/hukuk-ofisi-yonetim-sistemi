import fs from "node:fs";
import {
  cleanLegacyState,
  collectLegacyStateStats,
  createAdminClient,
  estimateBytes,
  legacySettingsKey,
  parseArgs,
  readLegacySettings,
  timestamp,
  writeJson,
  writeLegacySettings
} from "./legacy-settings-utils.mjs";

async function main() {
  const args = parseArgs();
  const execute = args.flags.has("execute");
  const backupPath = args.values.backup || `database/backup/legacy-settings-before-cleanup-${timestamp()}.json`;
  const reportPath = args.values.report || `work/legacy-settings-cleanup-${timestamp()}.json`;
  const supabase = createAdminClient();
  const row = await readLegacySettings(supabase);
  const before = row?.setting_value || {};
  const after = cleanLegacyState(before);
  const beforeStats = collectLegacyStateStats(before);
  const afterStats = collectLegacyStateStats(after);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: execute ? "cleanup" : "dry-run",
    settingsKey: legacySettingsKey,
    settingsRowFound: Boolean(row),
    backupPath,
    before: beforeStats,
    after: afterStats,
    estimatedFreedBytes: Math.max(0, estimateBytes(before) - estimateBytes(after)),
    estimatedFreedMb: Number((Math.max(0, estimateBytes(before) - estimateBytes(after)) / 1024 / 1024).toFixed(3)),
    removedBusinessKeys: beforeStats.presentBusinessKeys,
    preservedUnexpectedKeys: beforeStats.unexpectedKeys,
    restoreCommand: `npm.cmd run restore:legacy-settings -- --input "${backupPath}" --confirm`
  };
  if (execute) {
    writeJson(backupPath, {
      generatedAt: new Date().toISOString(),
      settingsKey: legacySettingsKey,
      settingRow: row,
      settingValue: before
    });
    const saved = await writeLegacySettings(supabase, after);
    report.updatedSetting = saved;
  } else if (fs.existsSync(backupPath)) {
    report.note = "Belirtilen backup dosyası mevcut; execute modunda üzerine yazılabilir.";
  }
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  console.log(execute ? "Temizlik tamamlandı." : "Dry-run tamamlandı. Gerçek temizlik için --execute kullanın.");
}

main().catch(error => {
  console.error("Legacy settings temizliği başarısız.", {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
  process.exitCode = 1;
});
