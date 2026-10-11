import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllSupabaseRows } from "../../src/calculations/calculationTools.js";
import { daysUntilLocalDate, localIsoDate } from "../../src/shared/localDate.mjs";
import { collectPaginatedRows } from "../../src/shared/repositoryPagination.mjs";
import { isValidIsoDate, parseTurkishMoney } from "../../src/shared/userInput.mjs";

function supabasePages(total) {
  const rows = Array.from({ length: total }, (_, id) => ({ id }));
  return () => ({
    range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null })
  });
}

test("Supabase sayfalama 1001 kaydın tamamını döndürür", async () => {
  const rows = await fetchAllSupabaseRows(supabasePages(1001));
  assert.equal(rows.length, 1001);
  assert.deepEqual(rows.map(row => row.id), Array.from({ length: 1001 }, (_, id) => id));
});

test("REST sayfalama 1500 kaydın tamamını ve sırasını korur", async () => {
  const source = Array.from({ length: 1500 }, (_, id) => ({ id }));
  const ranges = [];
  const rows = await collectPaginatedRows(async (from, to) => {
    ranges.push([from, to]);
    return source.slice(from, to + 1);
  });

  assert.equal(rows.length, 1500);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(rows[1499].id, 1499);
});

test("yerel gün hesabı uygulama yeniden açılmadan gece yarısında ilerler", () => {
  const beforeMidnight = new Date(2026, 8, 17, 23, 59, 0);
  const afterMidnight = new Date(2026, 8, 18, 0, 1, 0);

  assert.equal(localIsoDate(beforeMidnight), "2026-09-17");
  assert.equal(localIsoDate(afterMidnight), "2026-09-18");
  assert.equal(daysUntilLocalDate("2026-09-18", beforeMidnight), 1);
  assert.equal(daysUntilLocalDate("2026-09-18", afterMidnight), 0);
});

test("Türkçe ve makine para biçimleri ortak parser ile okunur", () => {
  const cases = new Map([
    ["1", 1],
    ["1,50", 1.5],
    ["1.250", 1250],
    ["1.250,50", 1250.5],
    ["12.345.678,90", 12345678.9],
    ["1250.50", 1250.5],
    ["1 250,50", 1250.5],
    ["₺1.250,50", 1250.5]
  ]);

  cases.forEach((expected, input) => assert.equal(parseTurkishMoney(input), expected, input));
  ["", "abc", "1.2.3,45", "1,2,3", "12.34.567,89", "1.250,500"].forEach(input => {
    assert.equal(parseTurkishMoney(input), null, input);
  });
});

test("ödeme tarihi yalnız gerçek YYYY-MM-DD tarihi ise kabul edilir", () => {
  assert.equal(isValidIsoDate("2026-10-11"), true);
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("11.10.2026"), false);
  assert.equal(isValidIsoDate("2026-1-01"), false);
});
