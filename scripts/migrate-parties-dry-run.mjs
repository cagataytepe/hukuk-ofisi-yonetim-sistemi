import { loadEnvFile, parseArgs } from "./files-migration-utils.mjs";
import {
  buildPartiesMigrationPlan,
  defaultPartiesDryRunReportPath,
  publicPartiesPlanReport,
  readPartiesMigrationInputs,
  writeJsonReport
} from "./parties-migration-utils.mjs";

loadEnvFile();

const args = parseArgs();
const inputPath = args.values.input || "";
const batchId = args.values["batch-id"] || "parties-dry-run";
const reportPath = args.values.report || defaultPartiesDryRunReportPath;

const { state, files, existingClients, existingFileParties, warnings } = await readPartiesMigrationInputs({
  inputPath,
  useServiceRole: true,
  includeExisting: true
});

const plan = buildPartiesMigrationPlan(state, {
  files,
  existingClients,
  existingFileParties,
  batchId
});

const report = {
  mode: "dry-run",
  warning: "Veritabanina yazma yapilmadi.",
  batchId,
  warnings,
  ...publicPartiesPlanReport(plan)
};

writeJsonReport(reportPath, report);

warnings.forEach(warning => console.warn(warning));
console.log("Taraflar dry-run tamamlandi. Veri yazilmadi.");
console.log(`Kaynak benzersiz dosya: ${report.summary.sourceUniqueFileCount}`);
console.log(`Planlanan yeni client: ${report.summary.plannedClientCreateCount}`);
console.log(`Planlanan yeni file_party: ${report.summary.plannedFilePartyCreateCount}`);
console.log(`Guncellenecek file_party: ${report.summary.plannedFilePartyUpdateCount}`);
console.log(`Manuel inceleme: ${report.summary.manualDecisionCount}`);
console.log(`Rapor: ${reportPath}`);
