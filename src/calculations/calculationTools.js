const PAGE_SIZE = 1000;

function numberValue(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return String(value ?? "").trim();
}

function nextIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function mapInterestRate(row = {}) {
  return {
    id: row.id,
    type: textValue(row.interest_type),
    from: row.from_date || "",
    to: row.to_date || "",
    rate: numberValue(row.rate),
    active: row.is_active !== false && !row.deleted_at,
    description: textValue(row.description || row.metadata?.description),
    source: textValue(row.source),
    updatedAt: row.updated_at || row.created_at || "",
    updatedBy: textValue(row.updated_by_profile?.display_name || row.created_by_profile?.display_name)
  };
}

export function mapAttorneyFeeTariff(row = {}) {
  const brackets = Array.isArray(row.attorney_fee_brackets)
    ? row.attorney_fee_brackets
    : Array.isArray(row.brackets)
      ? row.brackets
      : [];
  return {
    id: row.id,
    name: textValue(row.name),
    year: Number(row.tariff_year) || Number(String(row.name || "").match(/\d{4}/)?.[0]) || null,
    scope: textValue(row.scope) || "İcra",
    from: row.from_date || "",
    to: row.to_date || "",
    regularMinimum: numberValue(row.regular_minimum),
    evictionMinimum: numberValue(row.eviction_minimum),
    maximumAmount: row.maximum_amount === null || row.maximum_amount === undefined
      ? null
      : numberValue(row.maximum_amount),
    active: row.is_active !== false && !row.deleted_at,
    description: textValue(row.description || row.metadata?.description),
    updatedAt: row.updated_at || row.created_at || "",
    updatedBy: textValue(row.updated_by_profile?.display_name || row.created_by_profile?.display_name),
    brackets: brackets
      .filter(bracket => !bracket.deleted_at && bracket.is_active !== false)
      .sort((a, b) => Number(a.sequence_no || 0) - Number(b.sequence_no || 0))
      .map(bracket => ({
        id: bracket.id,
        limit: bracket.limit_amount === null || bracket.limit_amount === "" ? null : numberValue(bracket.limit_amount),
        rate: numberValue(bracket.rate),
        sequence: Number(bracket.sequence_no || 0)
      }))
  };
}

export function mapCalculationParameter(row = {}) {
  return {
    id: row.id,
    group: textValue(row.parameter_group),
    key: textValue(row.parameter_key),
    label: textValue(row.label),
    value: row.numeric_value === null || row.numeric_value === undefined ? null : numberValue(row.numeric_value),
    textValue: textValue(row.text_value),
    unit: textValue(row.unit),
    from: row.from_date || "",
    to: row.to_date || "",
    active: row.is_active !== false && !row.deleted_at,
    description: textValue(row.description),
    updatedAt: row.updated_at || row.created_at || "",
    updatedBy: textValue(row.updated_by_profile?.display_name || row.created_by_profile?.display_name)
  };
}

export function buildCalculationTools({ interestRates = [], attorneyFeeTariffs = [], parameters = [] } = {}) {
  const mappedRates = interestRates.map(mapInterestRate);
  const mappedTariffs = attorneyFeeTariffs.map(mapAttorneyFeeTariff);
  const mappedParameters = parameters.map(mapCalculationParameter);
  return {
    interestRates: mappedRates,
    attorneyFeeTariffs: mappedTariffs,
    parameters: mappedParameters,
    interestTypes: [...new Set(mappedRates.map(item => item.type).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "tr")),
    loadedAt: new Date().toISOString()
  };
}

export async function fetchAllSupabaseRows(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export function validateInterestTimeline(periods = [], type = "") {
  const selected = periods
    .filter(period => !type || period.type === type)
    .filter(period => period.active !== false)
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  const errors = [];
  selected.forEach((period, index) => {
    if (!period.from || numberValue(period.rate) <= 0) {
      errors.push({ type: "invalid", period });
    }
    const previous = selected[index - 1];
    if (!previous) return;
    if (!previous.to || previous.to >= period.from) {
      errors.push({ type: "overlap", previous, period });
    } else if (nextIsoDate(previous.to) !== period.from) {
      errors.push({ type: "gap", previous, period });
    }
  });
  return { valid: errors.length === 0, errors };
}

export function validateAttorneyFeeTimeline(tariffs = [], scope = "") {
  return validateInterestTimeline(
    tariffs.map(tariff => ({ ...tariff, type: tariff.scope || "İcra", rate: 1 })),
    scope
  );
}
