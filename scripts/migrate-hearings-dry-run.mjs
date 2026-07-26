import {
  buildHearingsMigrationPlan,
  defaultHearingsDryRunReportPath,
  publicHearingsPlanReport,
  readHearingsMigrationInputs,
  writeJsonReport
} from "./hearings-migration-utils.mjs";
import { loadEnvFile, parseArgs } from "./files-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const inputPath = args.values.input || "";
const reportPath = args.values.report || defaultHearingsDryRunReportPath;
const useServiceRole = args.flags.has("use-service-role");

const { state, files, profiles, existingHearings, warnings } = await readHearingsMigrationInputs({
  inputPath,
  useServiceRole,
  includeExistingHearings: true
});

const plan = buildHearingsMigrationPlan(state, {
  files,
  profiles,
  existingHearings,
  batchId: "hearings-dry-run"
});

const report = {
  mode: "dry-run",
  warning: "Veritabanina yazma yapilmadi.",
  warnings,
  ...publicHearingsPlanReport(plan)
};

writeJsonReport(reportPath, report);

warnings.forEach(warning => console.warn(warning));
console.log("Durusmalar dry-run tamamlandi. Veritabanina yazma yapilmadi.");
console.log(`Toplam durusma: ${report.summary.sourceHearingCount}`);
console.log(`Benzersiz durusma: ${report.summary.uniqueHearingCount}`);
console.log(`Mukerrer durusma: ${report.summary.duplicateHearingCount}`);
console.log(`Okunan aktif dosya: ${report.summary.activeFileCount}`);
console.log(`Dosyayla eslesen: ${report.summary.fileMatchedCount}`);
console.log(`Dosyayla eslesmeyen: ${report.summary.fileUnmatchedCount}`);
console.log(`Dosya eslesmesi belirsiz: ${report.summary.fileAmbiguousCount}`);
console.log(`Okunan aktif profil: ${report.summary.activeProfileCount}`);
console.log(`Avukatla eslesen: ${report.summary.participantMatchedCount}`);
console.log(`Avukatla eslesmeyen: ${report.summary.participantUnmatchedCount}`);
console.log(`Avukat eslesmesi belirsiz: ${report.summary.participantAmbiguousCount}`);
console.log(`Gecersiz tarih: ${report.summary.invalidDateCount}`);
console.log(`Gecersiz saat: ${report.summary.invalidTimeCount}`);
console.log(`Olusturulacak: ${report.summary.createCount}`);
console.log(`Guncellenecek: ${report.summary.updateCount}`);
console.log(`Zaten bulunan: ${report.summary.alreadyExistingCount}`);
console.log(`Atlanacak: ${report.summary.skippedCount}`);
console.log(`Rapor: ${reportPath}`);
