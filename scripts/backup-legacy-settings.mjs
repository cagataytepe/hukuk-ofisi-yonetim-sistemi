import {
  collectLegacyStateStats,
  createAdminClient,
  legacySettingsKey,
  parseArgs,
  readLegacySettings,
  timestamp,
  writeJson
} from "./legacy-settings-utils.mjs";

async function main() {
  const args = parseArgs();
  const execute = args.flags.has("execute");
  const backupPath = args.values.output || `database/backup/legacy-settings-${timestamp()}.json`;
  const supabase = createAdminClient();
  const row = await readLegacySettings(supabase);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: execute ? "backup" : "dry-run",
    settingsKey: legacySettingsKey,
    settingsRowFound: Boolean(row),
    backupPath,
    stats: collectLegacyStateStats(row?.setting_value || {})
  };
  if (execute) {
    writeJson(backupPath, {
      ...report,
      settingRow: row,
      settingValue: row?.setting_value || {}
    });
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(execute ? `Yedek yazıldı: ${backupPath}` : "Dry-run tamamlandı. Yedek almak için --execute kullanın.");
}

main().catch(error => {
  console.error("Legacy settings yedeği alınamadı.", {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
  process.exitCode = 1;
});
