function scalarValues(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (typeof value === "object") return [];
  return [String(value)];
}

function partyValues(party = {}) {
  const client = party.client && typeof party.client === "object" ? party.client : {};
  return scalarValues([
    party.name,
    party.client_name,
    party.company_name,
    party.title,
    party.trade_name,
    party.role,
    party.role_label,
    party.party_type,
    party.tax_id,
    party.taxId,
    party.national_id,
    party.nationalId,
    client.name,
    client.company_name,
    client.title,
    client.tax_id,
    client.national_id
  ]);
}

export function normalizeFileSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ç", "c")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fileSearchValues(file = {}, relatedParties = []) {
  const metadata = file.metadata && typeof file.metadata === "object" ? file.metadata : {};
  const embeddedParties = [
    file.clientParties,
    file.opponentParties,
    file.creditorParties,
    file.debtors,
    metadata.clientParties,
    metadata.opponentParties,
    metadata.creditorParties,
    metadata.debtors,
    relatedParties
  ].flatMap(value => Array.isArray(value) ? value : []);

  return [
    ...scalarValues([
      file.id,
      file.repositoryId,
      file.display_id,
      file.displayId,
      file.legacy_id,
      file.legacyId,
      file.file_no,
      file.fileNo,
      file.file,
      file.trackingNo,
      file.court_or_office,
      file.courtOrOffice,
      file.court,
      file.office,
      file.subject,
      file.title,
      file.name,
      file.client_name,
      file.clientName,
      file.client,
      file.creditor,
      file.opponent_name,
      file.opponentName,
      file.opponent,
      file.debtor,
      metadata.fileNo,
      metadata.file,
      metadata.courtOrOffice,
      metadata.court,
      metadata.subject,
      metadata.clientName,
      metadata.client,
      metadata.creditor,
      metadata.opponentName,
      metadata.opponent,
      metadata.debtor
    ]),
    ...embeddedParties.flatMap(partyValues)
  ];
}

export function buildFileSearchText(file = {}, relatedParties = []) {
  return normalizeFileSearchText(fileSearchValues(file, relatedParties).join(" "));
}

export function fileMatchesSearch(file = {}, query = "", relatedParties = []) {
  const normalizedQuery = normalizeFileSearchText(query);
  if (!normalizedQuery) return true;
  const searchable = buildFileSearchText(file, relatedParties);
  return normalizedQuery.split(" ").every(token => searchable.includes(token));
}
