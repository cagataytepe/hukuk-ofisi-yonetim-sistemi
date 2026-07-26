import { defaultReportPath, buildMigrationPlan, loadEnvFile, parseArgs, publicPlanReport, readProfiles, readStateFromFile, readStateFromSupabase, writeJsonReport } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const inputPath = args.values.input;
const reportPath = args.values.report || defaultReportPath;
const useServiceRole = args.flags.has("use-service-role");
const skipProfiles = args.flags.has("skip-profiles");

const state = inputPath
  ? readStateFromFile(inputPath)
  : await readStateFromSupabase({ serviceRole: useServiceRole });

let profiles = [];
if (!skipProfiles) {
  try {
    profiles = await readProfiles({ serviceRole: useServiceRole });
  } catch (error) {
    console.warn(`Profil listesi okunamadi; sorumlu avukat eslestirmesi sinirli kalacak. ${error.message}`);
  }
}

const plan = buildMigrationPlan(state, profiles, { batchId: "dry-run" });
const report = publicPlanReport(plan);
writeJsonReport(reportPath, report);

console.log("Dosyalar dry-run tamamlandi. Veritabanina yazma yapilmadi.");
console.log(`Okunan aktif profil: ${report.summary.activeProfileCount}`);
if (!skipProfiles && report.summary.activeProfileCount === 0) {
  console.warn("Aktif profil okunamadi veya sorgu bos dondu; sorumlu avukat UUID eslestirmesi yapilamadi.");
}
console.log(`Benzersiz dosya: ${report.summary.canonicalFileCount}`);
console.log(`Mükerrer dosya: ${report.summary.duplicateFileCount}`);
console.log(`Uretilecek taraf kaydi: ${report.summary.partyRowCount}`);
console.log(`Uretilecek client kaydi: ${report.summary.clientRowCount}`);
console.log(`Sorumlu avukat eslesen: ${report.summary.responsibleMatchedCount}`);
console.log(`Sorumlu avukat eslesmeyen: ${report.summary.responsibleUnmatchedCount}`);
console.log(`Rapor: ${reportPath}`);
