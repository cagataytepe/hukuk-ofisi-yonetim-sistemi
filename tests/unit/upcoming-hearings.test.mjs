import assert from "node:assert/strict";
import test from "node:test";
import {
  isoDateInTimeZone,
  selectUpcomingHearings,
  upcomingHearingWindow,
  weekStartIso
} from "../../src/shared/upcomingHearings.mjs";

const now = new Date("2026-09-25T21:30:00.000Z");

test("upcoming hearing window uses Europe/Istanbul date boundaries", () => {
  assert.equal(isoDateInTimeZone(now), "2026-09-26");
  assert.deepEqual(upcomingHearingWindow({ now }), {
    dateFrom: "2026-09-26",
    dateTo: "2026-09-29"
  });
  assert.equal(weekStartIso("2026-09-26"), "2026-09-21");
});

test("desktop and mobile receive the same active upcoming hearing set", () => {
  const fixtures = [
    { id: "today-late", hearing_date: "2026-09-26", hearing_time: "13:45:00", status: "scheduled" },
    { id: "today-early", hearing_date: "2026-09-26", hearing_time: "09:55:00", status: "scheduled" },
    { id: "tomorrow", hearing_date: "2026-09-27", hearing_time: null, status: "scheduled" },
    { id: "last-day", hearing_date: "2026-09-29", hearing_time: "11:00:00", status: "scheduled" },
    { id: "too-late", hearing_date: "2026-09-30", hearing_time: "10:00:00", status: "scheduled" },
    { id: "deleted", hearing_date: "2026-09-27", hearing_time: "10:00:00", deleted_at: "2026-09-20" },
    { id: "completed", hearing_date: "2026-09-27", hearing_time: "10:00:00", status: "Tamamlandı" },
    { id: "cancelled", hearing_date: "2026-09-28", hearing_time: "10:00:00", status: "cancelled" },
    { id: "yesterday", hearing_date: "2026-09-25", hearing_time: "10:00:00", status: "scheduled" }
  ];

  const sharedRows = selectUpcomingHearings(fixtures, { now });
  const desktopRows = [...sharedRows];
  const mobileRows = [...sharedRows];
  assert.deepEqual(desktopRows.map(row => row.id), ["today-early", "today-late", "tomorrow", "last-day"]);
  assert.deepEqual(mobileRows, desktopRows);
});
