import {
  buildDeadlinesMigrationPlan,
  defaultDeadlinesDryRunReportPath,
  publicDeadlinesPlanReport,
  readDeadlinesMigrationInputs,
  writeJsonReport
} from "./deadlines-migration-utils.mjs";
import { loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const inputPath = args.values.input || "";
const reportPath = args.values.report || defaultDeadlinesDryRunReportPath;
const useServiceRole = !args.flags.has("anon");

const { state, files, profiles, existingDeadlines, warnings } = await readDeadlinesMigrationInputs({
  inputPath,
  useServiceRole,
  includeExistingDeadlines: true
});

const plan = buildDeadlinesMigrationPlan(state, {
  files,
  profiles,
  existingDeadlines,
  batchId: "deadlines-dry-run"
});

const report = {
  mode: "dry-run",
  warning: "Veritabanina yazma yapilmadi.",
  warnings,
  ...publicDeadlinesPlanReport(plan)
};

writeJsonReport(reportPath, report);

warnings.forEach(warning => console.warn(warning));
console.log("Sureli isler dry-run tamamlandi. Veritabanina yazma yapilmadi.");
console.log(`Toplam sureli is: ${report.summary.sourceDeadlineCount}`);
console.log(`Benzersiz kayit: ${report.summary.uniqueDeadlineCount}`);
console.log(`Mukerrer kayit: ${report.summary.duplicateDeadlineCount}`);
console.log(`Okunan aktif dosya: ${report.summary.activeFileCount}`);
console.log(`Dosyayla eslesen: ${report.summary.fileMatchedCount}`);
console.log(`Dosyayla eslesmeyen: ${report.summary.fileUnmatchedCount}`);
console.log(`Dosya eslesmesi belirsiz: ${report.summary.fileAmbiguousCount}`);
console.log(`Okunan aktif profil: ${report.summary.activeProfileCount}`);
console.log(`Avukatla eslesen: ${report.summary.responsibleMatchedCount}`);
console.log(`Avukatla eslesmeyen: ${report.summary.responsibleUnmatchedCount}`);
console.log(`Avukat eslesmesi belirsiz: ${report.summary.responsibleAmbiguousCount}`);
console.log(`Gecersiz start_date: ${report.summary.invalidStartDateCount}`);
console.log(`Gecersiz due_date: ${report.summary.invalidDueDateCount}`);
console.log(`Gecersiz completed_at: ${report.summary.invalidCompletedAtCount}`);
console.log(`Tamamlanmis: ${report.summary.completedCount}`);
console.log(`Aktif: ${report.summary.activeCount}`);
console.log(`Suresi gecmis: ${report.summary.overdueCount}`);
console.log(`Olusturulacak: ${report.summary.createCount}`);
console.log(`Guncellenecek: ${report.summary.updateCount}`);
console.log(`Zaten bulunan: ${report.summary.alreadyExistingCount}`);
console.log(`Atlanacak: ${report.summary.skippedCount}`);
console.log(`Rapor: ${reportPath}`);
