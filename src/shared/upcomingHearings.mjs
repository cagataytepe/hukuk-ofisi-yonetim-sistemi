export const OFFICE_TIME_ZONE = "Europe/Istanbul";
export const UPCOMING_HEARING_DAYS_AFTER_TODAY = 3;

const dateFormatterCache = new Map();

function dateFormatter(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }));
  }
  return dateFormatterCache.get(timeZone);
}

export function isoDateInTimeZone(instant = new Date(), timeZone = OFFICE_TIME_ZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = Object.fromEntries(dateFormatter(timeZone).formatToParts(date)
    .filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function weekStartIso(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return addIsoDays(isoDate, -((date.getUTCDay() + 6) % 7));
}

export function upcomingHearingWindow({
  now = new Date(),
  timeZone = OFFICE_TIME_ZONE,
  daysAfterToday = UPCOMING_HEARING_DAYS_AFTER_TODAY
} = {}) {
  const dateFrom = isoDateInTimeZone(now, timeZone);
  return { dateFrom, dateTo: addIsoDays(dateFrom, daysAfterToday) };
}

export function isActiveUpcomingHearing(hearing = {}) {
  const status = String(hearing.status || "").trim().toLocaleLowerCase("tr-TR");
  return !hearing.deleted_at
    && !hearing.deletedAt
    && !hearing.completed_at
    && !["tamamlan", "completed", "cancel", "iptal", "pasif", "ertelen"]
      .some(word => status.includes(word));
}

function hearingDate(hearing = {}) {
  return String(hearing.hearing_date || hearing.date || "").slice(0, 10);
}

function hearingTime(hearing = {}) {
  const value = String(hearing.hearing_time || hearing.time || "").trim();
  return value || "99:99:99";
}

export function selectUpcomingHearings(rows = [], options = {}) {
  const { dateFrom, dateTo } = upcomingHearingWindow(options);
  return (Array.isArray(rows) ? rows : [])
    .filter(hearing => {
      const date = hearingDate(hearing);
      return isActiveUpcomingHearing(hearing) && date >= dateFrom && date <= dateTo;
    })
    .sort((left, right) => {
      const dateOrder = hearingDate(left).localeCompare(hearingDate(right));
      return dateOrder || hearingTime(left).localeCompare(hearingTime(right));
    });
}
