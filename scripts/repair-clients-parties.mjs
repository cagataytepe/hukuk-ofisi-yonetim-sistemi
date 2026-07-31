import path from "node:path";
import crypto from "node:crypto";
import {
  createSupabaseClient,
  loadEnvFile,
  parseArgs,
  writeJsonReport
} from "./files-migration-utils.mjs";
import { analyzeClientsParties } from "./analyze-clients-parties.mjs";

loadEnvFile();

const args = parseArgs();
const execute = args.flags.has("execute");
const batchId = args.values["batch-id"] || `clients-parties-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
const previewPath = args.values.report || path.join(process.cwd(), "work", "clients-parties-repair-preview.json");
const backupPath = args.values.backup || path.join(process.cwd(), "work", `clients-parties-backup-${batchId}.json`);
const resultPath = path.join(process.cwd(), "work", `clients-parties-repair-${batchId}.json`);

const { report, raw } = await analyzeClientsParties({ reportPath: previewPath });
const preview = {
  mode: execute ? "execute-requested" : "dry-run",
  batchId,
  planned: {
    nationalIdMoves: report.phoneNationalIdCandidates.length,
    taxIdMoves: report.phoneTaxIdCandidates.length,
    explicitRepresentationUpdates: report.explicitRepresentationCandidates.length
  },
  skippedAmbiguousRepresentation: report.summary.missingRepresentation - report.summary.explicitRepresentationCandidates,
  warning: execute
    ? "Yalnızca yüksek güvenli adaylar güncellenecek."
    : "Veri yazılmadı. Gerçek düzeltme için --execute zorunludur."
};
writeJsonReport(previewPath, { ...report, repairPreview: preview });

if (!execute) {
  console.log("Müvekkil/taraf düzeltme dry-run tamamlandı. Veri yazılmadı.");
  console.log(`Rapor: ${previewPath}`);
  process.exit(0);
}

writeJsonReport(backupPath, {
  createdAt: new Date().toISOString(),
  batchId,
  clients: raw.clients.filter(client =>
    report.phoneNationalIdCandidates.some(item => item.id === client.id)
    || report.phoneTaxIdCandidates.some(item => item.id === client.id)),
  fileParties: raw.parties.filter(party =>
    report.explicitRepresentationCandidates.some(item => item.id === party.id))
});

const supabase = createSupabaseClient({ serviceRole: true });
let updatedClients = 0;
let updatedParties = 0;

for (const candidate of report.phoneNationalIdCandidates) {
  const source = raw.clients.find(client => client.id === candidate.id);
  const { error } = await supabase.from("clients").update({
    national_id: String(source.phone).replace(/\D/g, ""),
    phone: null,
    repair_batch_id: batchId,
    updated_at: new Date().toISOString()
  }).eq("id", candidate.id).is("deleted_at", null);
  if (error) throw error;
  updatedClients += 1;
}

for (const candidate of report.phoneTaxIdCandidates) {
  const source = raw.clients.find(client => client.id === candidate.id);
  const { error } = await supabase.from("clients").update({
    tax_id: String(source.phone).replace(/\D/g, ""),
    phone: null,
    repair_batch_id: batchId,
    updated_at: new Date().toISOString()
  }).eq("id", candidate.id).is("deleted_at", null);
  if (error) throw error;
  updatedClients += 1;
}

for (const candidate of report.explicitRepresentationCandidates) {
  const { error } = await supabase.from("file_parties").update({
    represented_by_office: candidate.representedByOffice,
    repair_batch_id: batchId,
    updated_at: new Date().toISOString()
  }).eq("id", candidate.id).is("deleted_at", null).is("represented_by_office", null);
  if (error) throw error;
  updatedParties += 1;
}

const result = {
  mode: "execute",
  batchId,
  backupPath,
  updatedClients,
  updatedParties,
  ambiguousRecordsChanged: 0,
  completedAt: new Date().toISOString()
};
writeJsonReport(resultPath, result);
console.log("Müvekkil/taraf yüksek güvenli düzeltmesi tamamlandı.");
console.log(`Yedek: ${backupPath}`);
console.log(`Sonuç: ${resultPath}`);
