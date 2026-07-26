import fs from "node:fs";
import {
  collectLegacyStateStats,
  createAdminClient,
  legacySettingsKey,
  parseArgs,
  timestamp,
  writeJson,
  writeLegacySettings
} from "./legacy-settings-utils.mjs";

async function main() {
  const args = parseArgs();
  const input = args.values.input || args.values.backup || "";
  const confirm = args.flags.has("confirm");
  const reportPath = args.values.report || `work/legacy-settings-restore-${timestamp()}.json`;
  if (!input) throw new Error("--input ile backup JSON dosyası belirtilmelidir.");
  if (!fs.existsSync(input)) throw new Error(`Backup dosyası bulunamadı: ${input}`);
  const backup = JSON.parse(fs.readFileSync(input, "utf8"));
  const value = backup.settingValue || backup.settingRow?.setting_value || backup;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: confirm ? "restore" : "dry-run",
    settingsKey: legacySettingsKey,
    input,
    stats: collectLegacyStateStats(value)
  };
  if (confirm) {
    const supabase = createAdminClient();
    report.updatedSetting = await writeLegacySettings(supabase, value);
  }
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  console.log(confirm ? "Geri yükleme tamamlandı." : "Dry-run tamamlandı. Geri yüklemek için --confirm kullanın.");
}

main().catch(error => {
  console.error("Legacy settings geri yükleme başarısız.", {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint
  });
  process.exitCode = 1;
});
