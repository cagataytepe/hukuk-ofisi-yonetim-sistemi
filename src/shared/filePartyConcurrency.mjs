function text(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function identifier(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizedParty(row = {}) {
  const client = row.client && typeof row.client === "object" ? row.client : {};
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: text(row.id || row.repositoryId || row.repository_id),
    fileId: text(row.file_id || row.fileId),
    clientId: text(row.client_id || row.clientId || client.id),
    partyType: text(row.party_type || row.partyType || metadata.partyType).toLocaleLowerCase("tr-TR"),
    side: text(row.side || metadata.side).toLocaleLowerCase("tr-TR"),
    role: text(row.role_label || row.roleLabel || row.role || metadata.role || metadata.roleLabel).toLocaleLowerCase("tr-TR"),
    name: text(row.name || client.name).toLocaleLowerCase("tr-TR"),
    nationalId: identifier(row.national_id || row.nationalId || client.national_id || metadata.nationalId),
    taxId: identifier(row.tax_id || row.taxId || client.tax_id),
    clientType: text(row.client_type || row.clientType || client.client_type || metadata.clientType).toLowerCase(),
    representedByOffice: row.represented_by_office === true || row.representedByOffice === true,
    isPrimary: row.is_primary === true || row.isPrimary === true,
    updatedAt: text(row.updated_at || row.updatedAt)
  };
}

export function filePartyRevision(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError("Dosya tarafları bir liste olmalıdır.");
  const normalized = rows.map(normalizedParty).sort((left, right) => {
    const leftKey = `${left.id}|${left.clientId}|${left.side}|${left.role}|${left.name}`;
    const rightKey = `${right.id}|${right.clientId}|${right.side}|${right.role}|${right.name}`;
    return leftKey.localeCompare(rightKey, "tr");
  });
  return JSON.stringify(normalized);
}

export function replaceFilePartyCache(cache = [], fileId, rows = []) {
  const targetFileId = text(fileId);
  const preserved = (Array.isArray(cache) ? cache : []).filter(row => text(row.file_id || row.fileId) !== targetFileId);
  return [...preserved, ...(Array.isArray(rows) ? rows : [])];
}

function requirePartyReader(repository) {
  if (!repository || typeof repository.getFileParties !== "function") {
    throw new Error("Güncel dosya taraflarını okuma hizmeti kullanılamıyor.");
  }
}

export async function loadFilePartiesForEdit({ repository, fileId, mapRow = row => row } = {}) {
  requirePartyReader(repository);
  const rows = await repository.getFileParties({ fileId });
  if (!Array.isArray(rows)) throw new Error("Güncel dosya tarafları geçersiz biçimde döndü.");
  const mappedRows = rows.map(mapRow);
  return {
    fileId: text(fileId),
    rows: mappedRows,
    revision: filePartyRevision(mappedRows)
  };
}

export async function verifyFilePartiesUnchanged({ repository, baseline, mapRow = row => row } = {}) {
  if (!baseline?.fileId || typeof baseline.revision !== "string") {
    throw new Error("Dosya taraflarının başlangıç sürümü bulunamadı.");
  }
  const current = await loadFilePartiesForEdit({ repository, fileId: baseline.fileId, mapRow });
  return {
    ...current,
    unchanged: current.revision === baseline.revision
  };
}
