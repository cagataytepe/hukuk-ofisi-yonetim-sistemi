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
  const reportPath = args.values.report || `work/legacy-settings-analysis-${timestamp()}.json`;
  const supabase = createAdminClient();
  const row = await readLegacySettings(supabase);
  const state = row?.setting_value || {};
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    settingsKey: legacySettingsKey,
    settingsRowFound: Boolean(row),
    settingsUpdatedAt: row?.updated_at || null,
    stats: collectLegacyStateStats(state)
  };
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Rapor yazıldı: ${reportPath}`);
}

main().catch(error => {
  console.error("Legacy settings analizi başarısız.", {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
  process.exitCode = 1;
});
