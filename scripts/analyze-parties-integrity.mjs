import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createSupabaseClient,
  loadEnvFile,
  parseArgs,
  writeJsonReport
} from "./files-migration-utils.mjs";

const defaultReportPath = path.join(process.cwd(), "work", "parties-integrity-dry-run-report.json");
const defaultSqlPath = path.join(process.cwd(), "work", "parties-integrity-repair-draft.sql");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeComparable(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return normalizeText(value).replace(/[^\d]/g, "");
}

function quote(value) {
  if (value == null || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteUuid(value) {
  return value ? `${quote(value)}::uuid` : "null";
}

function jsonSql(value) {
  return `${quote(JSON.stringify(value ?? {}))}::jsonb`;
}

function formatFile(file = {}) {
  return {
    id: file.id,
    displayId: file.display_id || null,
    legacyId: file.legacy_id || null,
    fileNo: file.file_no || null,
    courtOrOffice: file.court_or_office || null,
    deletedAt: file.deleted_at || null
  };
}

function formatClient(client = {}) {
  if (!client) return null;
  return {
    id: client.id,
    legacyId: client.legacy_id || null,
    name: client.name || null,
    nationalId: client.national_id || null,
    taxId: client.tax_id || null,
    clientType: client.client_type || null,
    deletedAt: client.deleted_at || null
  };
}

function formatFileParty(row = {}, { filesById, clientsById } = {}) {
  return {
    id: row.id,
    legacyId: row.legacy_id || null,
    file: formatFile(filesById.get(row.file_id) || { id: row.file_id }),
    client: row.client_id ? formatClient(clientsById.get(row.client_id) || { id: row.client_id }) : null,
    clientId: row.client_id || null,
    name: row.name || null,
    partyType: row.party_type || null,
    side: row.side || null,
    role: row.role || null,
    roleLabel: row.role_label || null,
    taxId: row.tax_id || null,
    phone: row.phone || null,
    email: row.email || null,
    isPrimary: Boolean(row.is_primary),
    importBatchId: row.import_batch_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function selectWithFallback(supabase, table, extendedSelect, fallbackSelect, orderColumn = "created_at") {
  const result = await supabase
    .from(table)
    .select(extendedSelect)
    .is("deleted_at", null)
    .order(orderColumn, { ascending: true });

  if (!result.error) return result.data || [];
  if (!fallbackSelect) throw new Error(`${table} okunamadi: ${result.error.message}`);

  const fallback = await supabase
    .from(table)
    .select(fallbackSelect)
    .is("deleted_at", null)
    .order(orderColumn, { ascending: true });

  if (fallback.error) throw new Error(`${table} okunamadi: ${fallback.error.message}`);
  return fallback.data || [];
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach(row => {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function chooseCanonical(rows = [], { activeClientsById = new Map() } = {}) {
  return [...rows].sort((a, b) => {
    const linkedDiff = Number(Boolean(b.client_id && activeClientsById.has(b.client_id))) - Number(Boolean(a.client_id && activeClientsById.has(a.client_id)));
    if (linkedDiff) return linkedDiff;
    const primaryDiff = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
    if (primaryDiff) return primaryDiff;
    const aCreated = Date.parse(a.created_at || "") || 0;
    const bCreated = Date.parse(b.created_at || "") || 0;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function findUniqueClientMatch(row, clients) {
  const activeClients = clients.filter(client => client && client.deleted_at == null);
  const tax = normalizeIdentifier(row.tax_id);
  if (tax) {
    const byTax = activeClients.filter(client => {
      const candidateTax = normalizeIdentifier(client.tax_id);
      const candidateNational = normalizeIdentifier(client.national_id);
      return candidateTax === tax || candidateNational === tax;
    });
    if (byTax.length === 1) return { matchType: "tax_or_national_id", client: byTax[0] };
    if (byTax.length > 1) return { matchType: "tax_or_national_id", ambiguous: true, candidates: byTax };
  }

  const name = normalizeComparable(row.name);
  if (!name) return { matchType: "none", client: null };
  const byName = activeClients.filter(client => normalizeComparable(client.name) === name);
  if (byName.length === 1) return { matchType: "unique_name", client: byName[0] };
  if (byName.length > 1) return { matchType: "unique_name", ambiguous: true, candidates: byName };
  return { matchType: "none", client: null };
}

function buildAnalysis({ files, clients, fileParties }) {
  const filesById = new Map(files.map(file => [file.id, file]));
  const clientsById = new Map(clients.map(client => [client.id, client]));
  const activeClientsById = new Map(clients.filter(client => client.deleted_at == null).map(client => [client.id, client]));
  const activeFileParties = fileParties.filter(row => row && row.deleted_at == null);

  const nullClientRows = activeFileParties.filter(row => !row.client_id);
  const strictOrphanRows = activeFileParties.filter(row => row.client_id && !activeClientsById.has(row.client_id));
  const orphanIncludingNullRows = activeFileParties.filter(row => !row.client_id || !activeClientsById.has(row.client_id));

  const duplicateGroups = [...groupBy(
    activeFileParties.filter(row => row.file_id && row.client_id && normalizeText(row.party_type)),
    row => [row.file_id, row.client_id, normalizeComparable(row.party_type)].join("|")
  ).values()].filter(rows => rows.length > 1);

  const duplicateGroupsIncludingNull = [...groupBy(
    activeFileParties.filter(row => row.file_id && normalizeText(row.party_type)),
    row => [row.file_id, row.client_id || "__NULL_CLIENT__", normalizeComparable(row.party_type)].join("|")
  ).values()].filter(rows => rows.length > 1);

  const sameClientRoleGroups = [...groupBy(
    activeFileParties.filter(row => row.file_id && row.client_id),
    row => [row.file_id, row.client_id].join("|")
  ).values()].filter(rows => {
    const roleKeys = new Set(rows.map(row => [
      normalizeComparable(row.party_type),
      normalizeComparable(row.role_label || row.role),
      normalizeComparable(row.side)
    ].join("|")));
    return roleKeys.size > 1;
  });

  const orphanResolution = orphanIncludingNullRows.map(row => {
    const match = findUniqueClientMatch(row, clients);
    const shouldCreateClient = !match.client && !match.ambiguous;
    return {
      row,
      matchType: match.matchType,
      targetClient: match.client || null,
      ambiguousCandidates: asArray(match.candidates),
      shouldCreateClient,
      newClientId: shouldCreateClient ? crypto.randomUUID() : null,
      newClientLegacyId: shouldCreateClient ? `repair-client-for-file-party-${row.id}` : null
    };
  });

  const orphanCoveredByCanonicalParty = orphanResolution
    .map(item => {
      if (!item.targetClient?.id) return null;
      const canonical = activeFileParties.find(row => row.id !== item.row.id
        && row.deleted_at == null
        && row.file_id === item.row.file_id
        && row.client_id === item.targetClient.id);
      return canonical
        ? {
            duplicate: item.row,
            canonical,
            reason: "missing/orphan client_id row is already represented by an active file_party for the resolved client in the same file"
          }
        : null;
    })
    .filter(Boolean);
  const coveredOrphanIds = new Set(orphanCoveredByCanonicalParty.map(item => item.duplicate.id));

  const resolvedClientIdByFilePartyId = new Map();
  activeFileParties.forEach(row => {
    if (row.client_id && activeClientsById.has(row.client_id)) {
      resolvedClientIdByFilePartyId.set(row.id, row.client_id);
    }
  });
  orphanResolution
    .filter(item => !coveredOrphanIds.has(item.row.id))
    .forEach(item => {
    if (item.targetClient?.id) resolvedClientIdByFilePartyId.set(item.row.id, item.targetClient.id);
    else if (item.newClientId) resolvedClientIdByFilePartyId.set(item.row.id, item.newClientId);
  });

  const duplicateGroupsAfterRepair = [...groupBy(
    activeFileParties.filter(row => row.file_id && resolvedClientIdByFilePartyId.get(row.id) && normalizeText(row.party_type)),
    row => [row.file_id, resolvedClientIdByFilePartyId.get(row.id), normalizeComparable(row.party_type)].join("|")
  ).values()].filter(rows => rows.length > 1);

  const sameClientRoleGroupsAfterRepair = [...groupBy(
    activeFileParties.filter(row => row.file_id && resolvedClientIdByFilePartyId.get(row.id)),
    row => [row.file_id, resolvedClientIdByFilePartyId.get(row.id)].join("|")
  ).values()].filter(rows => {
    const roleKeys = new Set(rows.map(row => [
      normalizeComparable(row.party_type),
      normalizeComparable(row.role_label || row.role),
      normalizeComparable(row.side)
    ].join("|")));
    return roleKeys.size > 1;
  });

  const duplicateActionsAfterRepair = duplicateGroupsAfterRepair.flatMap(rows => {
    const canonical = chooseCanonical(rows, { activeClientsById });
    return rows
      .filter(row => row.id !== canonical.id)
      .map(row => ({
        duplicate: row,
        canonical,
        reason: "same file_id + client_id + normalized party_type"
      }));
  });
  const duplicateActions = [
    ...orphanCoveredByCanonicalParty,
    ...duplicateActionsAfterRepair.filter(action => !coveredOrphanIds.has(action.duplicate.id))
  ];

  const archivedIds = new Set(duplicateActions.map(action => action.duplicate.id));
  const activeRowsAfterProposedCleanup = activeFileParties
    .filter(row => !archivedIds.has(row.id))
    .map(row => {
      const resolved = orphanResolution.find(item => item.row.id === row.id);
      if (!resolved || !resolvedClientIdByFilePartyId.get(row.id)) return row;
      return { ...row, client_id: resolvedClientIdByFilePartyId.get(row.id) };
    });
  const duplicateGroupsAfterProposedCleanup = [...groupBy(
    activeRowsAfterProposedCleanup.filter(row => row.file_id && row.client_id && normalizeText(row.party_type)),
    row => [row.file_id, row.client_id, normalizeComparable(row.party_type)].join("|")
  ).values()].filter(rows => rows.length > 1);
  const sameClientRoleGroupsAfterProposedCleanup = [...groupBy(
    activeRowsAfterProposedCleanup.filter(row => row.file_id && row.client_id),
    row => [row.file_id, row.client_id].join("|")
  ).values()].filter(rows => {
    const roleKeys = new Set(rows.map(row => [
      normalizeComparable(row.party_type),
      normalizeComparable(row.role_label || row.role),
      normalizeComparable(row.side)
    ].join("|")));
    return roleKeys.size > 1;
  });

  return {
    maps: { filesById, clientsById },
    summary: {
      activeClients: activeClientsById.size,
      activeFiles: files.filter(file => file.deleted_at == null).length,
      activeFileParties: activeFileParties.length,
      nullClientId: nullClientRows.length,
      orphanClientIdStrict: strictOrphanRows.length,
      orphanClientIdIncludingNull: orphanIncludingNullRows.length,
      exactDuplicateGroups: duplicateGroups.length,
      exactDuplicateGroupsIncludingNullClient: duplicateGroupsIncludingNull.length,
      exactDuplicateGroupsAfterProposedRepair: duplicateGroupsAfterRepair.length,
      exactDuplicateGroupsAfterProposedCleanup: duplicateGroupsAfterProposedCleanup.length,
      exactDuplicateRowsToArchive: duplicateActions.length,
      sameClientMultipleRolesGroups: sameClientRoleGroups.length,
      sameClientMultipleRolesGroupsAfterProposedRepair: sameClientRoleGroupsAfterRepair.length,
      sameClientMultipleRolesGroupsAfterProposedCleanup: sameClientRoleGroupsAfterProposedCleanup.length,
      orphanRowsWithUniqueClientMatch: orphanResolution.filter(item => item.targetClient).length,
      orphanRowsNeedingClientCreate: orphanResolution.filter(item => item.shouldCreateClient).length,
      orphanRowsAmbiguous: orphanResolution.filter(item => item.ambiguousCandidates.length > 0).length
      ,
      orphanRowsCoveredByCanonicalFileParty: orphanCoveredByCanonicalParty.length,
      orphanRowsToRelinkAfterArchive: orphanResolution.filter(item => !coveredOrphanIds.has(item.row.id)).length
    },
    nullClientRows,
    strictOrphanRows,
    orphanIncludingNullRows,
    duplicateGroups,
    duplicateGroupsIncludingNull,
    duplicateGroupsAfterRepair,
    duplicateGroupsAfterProposedCleanup,
    sameClientRoleGroups,
    sameClientRoleGroupsAfterRepair,
    sameClientRoleGroupsAfterProposedCleanup,
    orphanResolution,
    orphanCoveredByCanonicalParty,
    duplicateActions
  };
}

function renderRepairSql(analysis) {
  const { filesById, clientsById } = analysis.maps;
  const lines = [
    "-- BKT Taraflar import bütünlük düzeltmesi - TASLAK",
    "-- Bu dosya Codex tarafından dry-run raporuna göre hazırlanmıştır.",
    "-- Kullanıcı onayı olmadan çalıştırmayın.",
    "-- Hard delete yapmaz; yalnızca eksik client bağlantılarını tamamlar ve gerçek duplicate file_party satırlarını soft delete ile arşivler.",
    "",
    "begin;",
    ""
  ];

  const duplicateIdsToArchive = new Set(analysis.duplicateActions.map(item => item.duplicate.id));

  analysis.duplicateActions.forEach((item, index) => {
    const duplicate = item.duplicate;
    const canonical = item.canonical;
    lines.push(`-- Duplicate ${index + 1}: ${duplicate.id} canonical ${canonical.id}`);
    lines.push(
      "update public.file_parties",
      "set deleted_at = now(),",
      "    updated_at = now(),",
      "    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(",
      "      'integrityRepair', true,",
      "      'integrityRepairReason', 'soft-deleted duplicate file_party row',",
      `      'canonicalFilePartyId', ${quote(canonical.id)},`,
      "      'integrityRepairAt', now()",
      "    )",
      `where id = ${quoteUuid(duplicate.id)}`,
      "  and deleted_at is null;",
      ""
    );
  });

  analysis.orphanResolution.forEach((item, index) => {
    const row = item.row;
    const display = formatFileParty(row, { filesById, clientsById });
    if (duplicateIdsToArchive.has(row.id)) {
      lines.push(`-- ${index + 1}. Eksik/orphan client_id: file_party ${row.id} duplicate olarak soft-delete edileceği için ayrıca bağlanmayacak.`);
      lines.push("");
      return;
    }
    lines.push(`-- ${index + 1}. Eksik/orphan client_id: file_party ${row.id} | ${display.file.displayId || display.file.fileNo || display.file.id} | ${display.name || ""}`);

    if (item.ambiguousCandidates.length) {
      lines.push(`-- MANUEL: Bu satır için birden fazla client adayı bulundu, otomatik SQL üretilmedi.`);
      item.ambiguousCandidates.forEach(candidate => {
        lines.push(`-- Aday client: ${candidate.id} | ${candidate.name || ""}`);
      });
      lines.push("");
      return;
    }

    if (item.targetClient) {
      lines.push(
        "update public.file_parties",
        `set client_id = ${quoteUuid(item.targetClient.id)},`,
        "    updated_at = now(),",
        "    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(",
        "      'integrityRepair', true,",
        "      'integrityRepairReason', 'relinked missing/orphan client_id to existing client',",
        "      'integrityRepairAt', now()",
        "    )",
        `where id = ${quoteUuid(row.id)}`,
        "  and deleted_at is null;",
        ""
      );
      return;
    }

    lines.push(
      "insert into public.clients (id, legacy_id, name, tax_id, phone, email, client_type, notes, metadata, created_at, updated_at)",
      "values (",
      `  ${quoteUuid(item.newClientId)},`,
      `  ${quote(item.newClientLegacyId)},`,
      `  ${quote(row.name || "İsimsiz taraf")},`,
      `  ${quote(row.tax_id)},`,
      `  ${quote(row.phone)},`,
      `  ${quote(row.email)},`,
      "  'unknown',",
      "  'Taraf import bütünlük düzeltmesi sırasında eksik client_id için oluşturuldu.',",
      `  ${jsonSql({ source: "parties-integrity-repair", filePartyId: row.id, reason: "missing_or_orphan_client_id" })},`,
      "  now(),",
      "  now()",
      ")",
      "on conflict (id) do nothing;",
      "",
      "update public.file_parties",
      `set client_id = ${quoteUuid(item.newClientId)},`,
      "    updated_at = now(),",
      "    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(",
      "      'integrityRepair', true,",
      "      'integrityRepairReason', 'linked missing/orphan client_id to newly created client',",
      "      'integrityRepairAt', now()",
      "    )",
      `where id = ${quoteUuid(row.id)}`,
      "  and deleted_at is null;",
      ""
    );
  });

  lines.push(
    "-- Düzeltme sonrası benzersizlik kuralı güvenceye alınabilir:",
    "create unique index if not exists file_parties_file_client_party_active_unique",
    "on public.file_parties(file_id, client_id, (lower(btrim(party_type))))",
    "where deleted_at is null",
    "  and file_id is not null",
    "  and client_id is not null",
    "  and party_type is not null",
    "  and btrim(party_type) <> '';",
    "",
    "commit;",
    ""
  );

  return lines.join("\n");
}

function renderRepairSqlV2(analysis) {
  const { filesById, clientsById } = analysis.maps;
  const targets = analysis.duplicateActions;
  const expectedCount = targets.length;
  const valuesSql = targets.length
    ? targets.map(item => `  (${quoteUuid(item.duplicate.id)}, ${quoteUuid(item.canonical.id)})`).join(",\n")
    : "  -- hedef satir yok";
  const lines = [
    "-- BKT Taraflar import butunluk duzeltmesi - TASLAK v2",
    "-- Kullanici onayi olmadan calistirmayin.",
    "-- Hard delete yapmaz; yalnizca dry-run raporunda belirlenen eski/null duplicate file_parties satirlarini soft delete yapar.",
    "-- Etkilenen satir sayisi beklenen degerden farkli olursa transaction rollback olur.",
    "",
    "begin;",
    "",
    "create temp table repair_party_targets (",
    "  id uuid primary key,",
    "  canonical_id uuid not null",
    ") on commit drop;",
    "",
    "insert into repair_party_targets (id, canonical_id)",
    "values",
    `${valuesSql};`,
    "",
    "do $$",
    "declare",
    `  expected_count integer := ${expectedCount};`,
    "  target_count integer;",
    "  valid_target_count integer;",
    "  affected_count integer;",
    "begin",
    "  select count(*) into target_count from repair_party_targets;",
    "  if target_count <> expected_count then",
    "    raise exception 'repair_party_targets count % does not equal expected %', target_count, expected_count;",
    "  end if;",
    "",
    "  select count(*) into valid_target_count",
    "  from public.file_parties duplicate",
    "  join repair_party_targets target on target.id = duplicate.id",
    "  join public.file_parties canonical on canonical.id = target.canonical_id",
    "  where duplicate.deleted_at is null",
    "    and duplicate.client_id is null",
    "    and canonical.deleted_at is null",
    "    and canonical.client_id is not null",
    "    and canonical.file_id = duplicate.file_id;",
    "",
    "  if valid_target_count <> expected_count then",
    "    raise exception 'valid target count % does not equal expected %', valid_target_count, expected_count;",
    "  end if;",
    "",
    "  update public.file_parties duplicate",
    "  set deleted_at = now(),",
    "      updated_at = now(),",
    "      metadata = coalesce(duplicate.metadata, '{}'::jsonb) || jsonb_build_object(",
    "        'integrityRepair', true,",
    "        'integrityRepairReason', 'soft-deleted legacy null-client duplicate file_party row',",
    "        'canonicalFilePartyId', target.canonical_id,",
    "        'integrityRepairAt', now()",
    "      )",
    "  from repair_party_targets target",
    "  where duplicate.id = target.id",
    "    and duplicate.deleted_at is null",
    "    and duplicate.client_id is null;",
    "",
    "  get diagnostics affected_count = row_count;",
    "  if affected_count <> expected_count then",
    "    raise exception 'affected row count % does not equal expected %', affected_count, expected_count;",
    "  end if;",
    "end",
    "$$;",
    ""
  ];

  targets.forEach((item, index) => {
    const duplicate = formatFileParty(item.duplicate, { filesById, clientsById });
    const canonical = formatFileParty(item.canonical, { filesById, clientsById });
    lines.push(`-- ${index + 1}. Soft-delete hedefi: ${duplicate.id} | ${duplicate.file.displayId || duplicate.file.fileNo || duplicate.file.id} | ${duplicate.name}`);
    lines.push(`--    Korunan canonical: ${canonical.id} | ${canonical.name} | client_id ${canonical.clientId}`);
  });

  lines.push(
    "",
    "create unique index if not exists file_parties_file_client_party_active_unique",
    "on public.file_parties(file_id, client_id, (lower(btrim(party_type))))",
    "where deleted_at is null",
    "  and file_id is not null",
    "  and client_id is not null",
    "  and party_type is not null",
    "  and btrim(party_type) <> '';",
    "",
    "commit;",
    ""
  );

  return lines.join("\n");
}

async function main() {
  loadEnvFile();
  const args = parseArgs();
  const reportPath = path.resolve(args.values.report || defaultReportPath);
  const sqlPath = path.resolve(args.values.sql || defaultSqlPath);

  const supabase = createSupabaseClient({ serviceRole: true, accessToken: null });
  const [files, clients, fileParties] = await Promise.all([
    selectWithFallback(
      supabase,
      "files",
      "id, legacy_id, display_id, file_no, court_or_office, deleted_at",
      null,
      "created_at"
    ),
    selectWithFallback(
      supabase,
      "clients",
      "id, legacy_id, name, national_id, tax_id, phone, email, client_type, import_batch_id, metadata, created_at, updated_at, deleted_at",
      "id, legacy_id, name, tax_id, phone, email, client_type, metadata, created_at, updated_at, deleted_at",
      "created_at"
    ),
    selectWithFallback(
      supabase,
      "file_parties",
      "id, legacy_id, file_id, client_id, party_type, side, role, role_label, name, tax_id, phone, email, is_primary, import_batch_id, metadata, created_at, updated_at, deleted_at",
      "id, legacy_id, file_id, client_id, party_type, side, role, name, tax_id, phone, email, is_primary, metadata, created_at, updated_at, deleted_at",
      "created_at"
    )
  ]);

  const analysis = buildAnalysis({ files, clients, fileParties });
  const { filesById, clientsById } = analysis.maps;

  const report = {
    mode: "dry-run",
    warning: "Veritabanina yazma yapilmadi. SQL taslagi yalnizca inceleme/onay icindir.",
    generatedAt: new Date().toISOString(),
    summary: analysis.summary,
    issues: {
      nullClientId: analysis.nullClientRows.map(row => formatFileParty(row, { filesById, clientsById })),
      orphanClientIdStrict: analysis.strictOrphanRows.map(row => formatFileParty(row, { filesById, clientsById })),
      orphanClientIdIncludingNull: analysis.orphanIncludingNullRows.map(row => formatFileParty(row, { filesById, clientsById })),
      exactDuplicates: analysis.duplicateGroups.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          clientId: rows[0].client_id,
          partyType: rows[0].party_type
        },
        canonicalId: chooseCanonical(rows).id,
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      exactDuplicatesIncludingNullClient: analysis.duplicateGroupsIncludingNull.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          clientId: rows[0].client_id || null,
          partyType: rows[0].party_type
        },
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      exactDuplicatesAfterProposedRepair: analysis.duplicateGroupsAfterRepair.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          resolvedClientId: rows.find(row => row.client_id)?.client_id || null,
          partyType: rows[0].party_type
        },
        canonicalId: chooseCanonical(rows).id,
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      exactDuplicatesAfterProposedCleanup: analysis.duplicateGroupsAfterProposedCleanup.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          clientId: rows[0].client_id || null,
          partyType: rows[0].party_type
        },
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      sameClientMultipleRoles: analysis.sameClientRoleGroups.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          clientId: rows[0].client_id
        },
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      sameClientMultipleRolesAfterProposedRepair: analysis.sameClientRoleGroupsAfterRepair.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          resolvedClientId: rows.find(row => row.client_id)?.client_id || null
        },
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      })),
      sameClientMultipleRolesAfterProposedCleanup: analysis.sameClientRoleGroupsAfterProposedCleanup.map(rows => ({
        groupKey: {
          fileId: rows[0].file_id,
          clientId: rows[0].client_id || null
        },
        rows: rows.map(row => formatFileParty(row, { filesById, clientsById }))
      }))
    },
    proposedRepair: {
      missingClientLinks: analysis.orphanResolution.map(item => ({
        fileParty: formatFileParty(item.row, { filesById, clientsById }),
        matchType: item.matchType,
        targetClient: formatClient(item.targetClient),
        ambiguousCandidates: item.ambiguousCandidates.map(formatClient),
        willCreateClientInDraftSql: item.shouldCreateClient,
        newClientIdInDraftSql: item.newClientId,
        newClientLegacyIdInDraftSql: item.newClientLegacyId
      })),
      duplicateRowsToSoftDelete: analysis.duplicateActions.map(item => ({
        duplicate: formatFileParty(item.duplicate, { filesById, clientsById }),
        canonical: formatFileParty(item.canonical, { filesById, clientsById }),
        reason: item.reason
      }))
    },
    sqlDraftPath: sqlPath
  };

  writeJsonReport(reportPath, report);
  fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
  fs.writeFileSync(sqlPath, renderRepairSqlV2(analysis), "utf8");

  console.log("Taraflar bütünlük dry-run raporu üretildi. Veri yazılmadı.");
  console.log(`null_client_id: ${analysis.summary.nullClientId}`);
  console.log(`orphan_client_id_strict: ${analysis.summary.orphanClientIdStrict}`);
  console.log(`orphan_client_id_including_null: ${analysis.summary.orphanClientIdIncludingNull}`);
  console.log(`exact_duplicate_groups: ${analysis.summary.exactDuplicateGroups}`);
  console.log(`exact_duplicate_groups_after_repair: ${analysis.summary.exactDuplicateGroupsAfterProposedRepair}`);
  console.log(`exact_duplicate_groups_after_cleanup: ${analysis.summary.exactDuplicateGroupsAfterProposedCleanup}`);
  console.log(`same_client_multiple_roles_groups: ${analysis.summary.sameClientMultipleRolesGroups}`);
  console.log(`same_client_multiple_roles_groups_after_repair: ${analysis.summary.sameClientMultipleRolesGroupsAfterProposedRepair}`);
  console.log(`same_client_multiple_roles_groups_after_cleanup: ${analysis.summary.sameClientMultipleRolesGroupsAfterProposedCleanup}`);
  console.log(`Rapor: ${reportPath}`);
  console.log(`SQL taslağı: ${sqlPath}`);
}

await main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
