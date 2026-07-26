import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadEnvFile,
  parseArgs,
  writeJsonReport
} from "./files-migration-utils.mjs";

const dryRunReportPath = path.join(process.cwd(), "work", "parties-integrity-dry-run-report.json");
const repairSqlPath = path.join(process.cwd(), "work", "parties-integrity-repair-draft.sql");
const executeReportPath = path.join(process.cwd(), "work", "parties-integrity-repair-execute-report.json");
const postRepairReportPath = path.join(process.cwd(), "work", "parties-integrity-post-repair-report.json");
const postRepairSqlPath = path.join(process.cwd(), "work", "parties-integrity-post-repair.sql");

function runNodeScript(args, { quiet = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit"
  });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `${args.join(" ")} basarisiz oldu.`;
    throw new Error(message.trim());
  }
  return result;
}

function runAnalyze({ reportPath = dryRunReportPath, sqlPath = repairSqlPath, quiet = false } = {}) {
  runNodeScript([
    "scripts/analyze-parties-integrity.mjs",
    "--report",
    reportPath,
    "--sql",
    sqlPath
  ], { quiet });
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

function validateRepairPreconditions(report) {
  const summary = report.summary || {};
  const alreadyClean = summary.nullClientId === 0
    && summary.orphanClientIdStrict === 0
    && summary.orphanClientIdIncludingNull === 0
    && summary.exactDuplicateGroups === 0
    && summary.sameClientMultipleRolesGroups === 0;
  if (alreadyClean) return "already-clean";

  const errors = [];
  if (summary.nullClientId !== 15) errors.push(`nullClientId ${summary.nullClientId}, beklenen 15`);
  if (summary.orphanClientIdStrict !== 0) errors.push(`orphanClientIdStrict ${summary.orphanClientIdStrict}, beklenen 0`);
  if (summary.orphanRowsCoveredByCanonicalFileParty !== 15) errors.push(`orphanRowsCoveredByCanonicalFileParty ${summary.orphanRowsCoveredByCanonicalFileParty}, beklenen 15`);
  if (summary.orphanRowsToRelinkAfterArchive !== 0) errors.push(`orphanRowsToRelinkAfterArchive ${summary.orphanRowsToRelinkAfterArchive}, beklenen 0`);
  if (summary.exactDuplicateRowsToArchive !== 15) errors.push(`exactDuplicateRowsToArchive ${summary.exactDuplicateRowsToArchive}, beklenen 15`);
  if (summary.exactDuplicateGroupsAfterProposedCleanup !== 0) errors.push(`exactDuplicateGroupsAfterProposedCleanup ${summary.exactDuplicateGroupsAfterProposedCleanup}, beklenen 0`);
  if (summary.sameClientMultipleRolesGroupsAfterProposedCleanup !== 0) errors.push(`sameClientMultipleRolesGroupsAfterProposedCleanup ${summary.sameClientMultipleRolesGroupsAfterProposedCleanup}, beklenen 0`);
  const targets = report.proposedRepair?.duplicateRowsToSoftDelete || [];
  if (targets.length !== 15) errors.push(`duplicateRowsToSoftDelete ${targets.length}, beklenen 15`);
  if (errors.length) {
    throw new Error(`Taraf butunluk on kosullari saglanmadi: ${errors.join("; ")}`);
  }
  return "ready";
}

function validatePostRepair(report) {
  const summary = report.summary || {};
  const errors = [];
  if (summary.nullClientId !== 0) errors.push(`nullClientId ${summary.nullClientId}, beklenen 0`);
  if (summary.orphanClientIdStrict !== 0) errors.push(`orphanClientIdStrict ${summary.orphanClientIdStrict}, beklenen 0`);
  if (summary.orphanClientIdIncludingNull !== 0) errors.push(`orphanClientIdIncludingNull ${summary.orphanClientIdIncludingNull}, beklenen 0`);
  if (summary.exactDuplicateGroups !== 0) errors.push(`exactDuplicateGroups ${summary.exactDuplicateGroups}, beklenen 0`);
  if (summary.sameClientMultipleRolesGroups !== 0) errors.push(`sameClientMultipleRolesGroups ${summary.sameClientMultipleRolesGroups}, beklenen 0`);
  if (errors.length) {
    throw new Error(`Taraf butunluk post-verify basarisiz: ${errors.join("; ")}`);
  }
}

function databaseUrl() {
  return process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.PG_DATABASE_URL
    || "";
}

function runPsql(sqlPath) {
  const url = databaseUrl();
  if (!url) {
    throw new Error("Transaction icin SUPABASE_DB_URL veya DATABASE_URL gerekli. Service role key ile Supabase JS transaction garantisi vermez.");
  }

  const version = spawnSync("psql", ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (version.error || version.status !== 0) {
    throw new Error("psql bulunamadi. Transaction'li SQL calistirmak icin PostgreSQL psql aracini kurun veya Supabase SQL Editor'de SQL taslagini calistirin.");
  }

  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    throw new Error(`psql repair basarisiz:\n${result.stderr || result.stdout}`);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function main() {
  loadEnvFile();
  const args = parseArgs();
  const execute = args.flags.has("execute");
  const reportPath = path.resolve(args.values.report || executeReportPath);

  const dryRun = runAnalyze({ quiet: false });
  const preconditionStatus = validateRepairPreconditions(dryRun);

  const beforeTargets = dryRun.proposedRepair?.duplicateRowsToSoftDelete || [];
  const report = {
    mode: execute ? "execute" : "dry-run",
    execute,
    generatedAt: new Date().toISOString(),
    dryRunReportPath,
    repairSqlPath,
    beforeSummary: dryRun.summary,
    preconditionStatus,
    beforeTargets: beforeTargets.map(item => ({
      id: item.duplicate.id,
      fileId: item.duplicate.file.id,
      fileDisplayId: item.duplicate.file.displayId,
      name: item.duplicate.name,
      partyType: item.duplicate.partyType,
      roleLabel: item.duplicate.roleLabel,
      role: item.duplicate.role,
      clientId: item.duplicate.clientId,
      deletedAt: item.duplicate.deletedAt || null,
      canonicalFilePartyId: item.canonical.id,
      canonicalClientId: item.canonical.clientId
    }))
  };

  if (!execute) {
    report.note = preconditionStatus === "already-clean"
      ? "Dry-run: veri zaten temiz gorunuyor; degisiklik yapilmadi."
      : "Dry-run: veritabani degistirilmedi. Gercek islem icin --execute kullanin.";
    writeJsonReport(reportPath, report);
    console.log("Taraflar repair dry-run tamamlandi. Veri yazilmadi.");
    console.log(`Hedef satir: ${report.beforeTargets.length}`);
    console.log(`Rapor: ${reportPath}`);
    console.log(`SQL taslagi: ${repairSqlPath}`);
    return;
  }

  if (preconditionStatus === "already-clean") {
    report.status = "already-clean";
    report.afterSummary = dryRun.summary;
    writeJsonReport(reportPath, report);
    console.log("Taraflar zaten temiz gorunuyor. Execute no-op.");
    console.log(`Rapor: ${reportPath}`);
    return;
  }

  try {
    report.psql = runPsql(repairSqlPath);
    const postRepair = runAnalyze({
      reportPath: postRepairReportPath,
      sqlPath: postRepairSqlPath,
      quiet: true
    });
    validatePostRepair(postRepair);
    report.postRepairReportPath = postRepairReportPath;
    report.afterSummary = postRepair.summary;
    report.status = "success";
    writeJsonReport(reportPath, report);
    console.log("Taraflar repair tamamlandi.");
    console.log(`Rapor: ${reportPath}`);
  } catch (error) {
    report.status = "blocked_or_failed";
    report.error = error.message;
    writeJsonReport(reportPath, report);
    throw error;
  }
}

await main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
