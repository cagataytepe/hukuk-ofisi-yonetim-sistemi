const DAY_MS = 86400000;

export function localDayAtNoon(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

export function localIsoDate(value = new Date()) {
  const date = localDayAtNoon(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysUntilLocalDate(value, now = new Date()) {
  const target = localDayAtNoon(`${value}T12:00:00`);
  const today = localDayAtNoon(now);
  if (!target || !today) return Number.NaN;
  return Math.round((target - today) / DAY_MS);
}
