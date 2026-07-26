import {
  buildTasksMigrationPlan,
  defaultTasksDryRunReportPath,
  publicTasksPlanReport,
  readTasksMigrationInputs,
  writeJsonReport
} from "./tasks-migration-utils.mjs";
import { loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const inputPath = args.values.input || "";
const reportPath = args.values.report || defaultTasksDryRunReportPath;
const useServiceRole = !args.flags.has("anon");

const { state, files, profiles, existingTasks, warnings } = await readTasksMigrationInputs({
  inputPath,
  useServiceRole,
  includeExistingTasks: true
});

const plan = buildTasksMigrationPlan(state, {
  files,
  profiles,
  existingTasks,
  batchId: "tasks-dry-run"
});

const report = {
  mode: "dry-run",
  warning: "Veritabanina yazma yapilmadi.",
  warnings,
  ...publicTasksPlanReport(plan)
};

writeJsonReport(reportPath, report);

warnings.forEach(warning => console.warn(warning));
console.log("Gorevler dry-run tamamlandi. Veritabanina yazma yapilmadi.");
console.log(`Toplam gorev: ${report.summary.sourceTaskCount}`);
console.log(`Benzersiz gorev: ${report.summary.uniqueTaskCount}`);
console.log(`Mukerrer gorev: ${report.summary.duplicateTaskCount}`);
console.log(`Okunan aktif dosya: ${report.summary.activeFileCount}`);
console.log(`Dosyaya bagli gorev: ${report.summary.fileBoundTaskCount}`);
console.log(`Ofis/kisisel gorev: ${report.summary.officePersonalTaskCount}`);
console.log(`Dosyayla eslesen: ${report.summary.fileMatchedCount}`);
console.log(`Dosyayla eslesmeyen: ${report.summary.fileUnmatchedCount}`);
console.log(`Dosya eslesmesi belirsiz: ${report.summary.fileAmbiguousCount}`);
console.log(`Okunan aktif profil: ${report.summary.activeProfileCount}`);
console.log(`Kullanici ile eslesen: ${report.summary.responsibleMatchedCount}`);
console.log(`Kullanici ile eslesmeyen: ${report.summary.responsibleUnmatchedCount}`);
console.log(`Kullanici eslesmesi belirsiz: ${report.summary.responsibleAmbiguousCount}`);
console.log(`Gecersiz due_date: ${report.summary.invalidDueDateCount}`);
console.log(`Gecersiz completed_at: ${report.summary.invalidCompletedAtCount}`);
console.log(`Gecersiz created_at: ${report.summary.invalidCreatedAtCount}`);
console.log(`Gecersiz updated_at: ${report.summary.invalidUpdatedAtCount}`);
console.log(`Tamamlanmis: ${report.summary.completedCount}`);
console.log(`Aktif: ${report.summary.activeCount}`);
console.log(`Suresi gecmis: ${report.summary.overdueCount}`);
console.log(`Olusturulacak: ${report.summary.createCount}`);
console.log(`Guncellenecek: ${report.summary.updateCount}`);
console.log(`Zaten bulunan: ${report.summary.alreadyExistingCount}`);
console.log(`Atlanacak: ${report.summary.skippedCount}`);
console.log(`Manuel inceleme: ${report.summary.manualDecisionCount}`);
console.log(`Rapor: ${reportPath}`);
