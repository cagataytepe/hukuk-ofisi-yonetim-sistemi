function normalizeSign(value) {
  const match = value.match(/^([+-]?)(.*)$/);
  return { sign: match?.[1] === "-" ? -1 : 1, unsigned: match?.[2] || "" };
}

function validGroupedInteger(value, separator) {
  const groups = value.split(separator);
  return groups.length > 1
    && /^\d{1,3}$/.test(groups[0])
    && groups.slice(1).every(group => /^\d{3}$/.test(group));
}

export function parseTurkishMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const compact = String(value ?? "")
    .trim()
    .replace(/^₺\s*/, "")
    .replace(/[\s\u00a0\u202f]/g, "");
  if (!compact) return null;

  const { sign, unsigned } = normalizeSign(compact);
  if (!unsigned || !/^[\d.,]+$/.test(unsigned)) return null;

  const dotCount = (unsigned.match(/\./g) || []).length;
  const commaCount = (unsigned.match(/,/g) || []).length;
  let normalized = "";

  if (dotCount && commaCount) {
    const decimalSeparator = unsigned.lastIndexOf(",") > unsigned.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    if ((decimalSeparator === "," ? commaCount : dotCount) !== 1) return null;
    const [integerPart, fractionPart] = unsigned.split(decimalSeparator);
    if (!/^\d{1,2}$/.test(fractionPart || "")) return null;
    if (!validGroupedInteger(integerPart, thousandsSeparator)) return null;
    normalized = `${integerPart.split(thousandsSeparator).join("")}.${fractionPart}`;
  } else if (commaCount) {
    if (commaCount !== 1) return null;
    const [integerPart, fractionPart] = unsigned.split(",");
    if (!/^\d+$/.test(integerPart) || !/^\d{1,2}$/.test(fractionPart || "")) return null;
    normalized = `${integerPart}.${fractionPart}`;
  } else if (dotCount > 1) {
    if (!validGroupedInteger(unsigned, ".")) return null;
    normalized = unsigned.split(".").join("");
  } else if (dotCount === 1) {
    const [integerPart, fractionPart] = unsigned.split(".");
    if (!/^\d+$/.test(integerPart) || !/^\d+$/.test(fractionPart || "")) return null;
    if (fractionPart.length === 3 && integerPart.length <= 3) normalized = `${integerPart}${fractionPart}`;
    else if (fractionPart.length <= 2) normalized = `${integerPart}.${fractionPart}`;
    else return null;
  } else {
    if (!/^\d+$/.test(unsigned)) return null;
    normalized = unsigned;
  }

  const parsed = Number(normalized) * sign;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidIsoDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
