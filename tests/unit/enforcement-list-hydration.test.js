import assert from "node:assert/strict";
import test from "node:test";

import { SupabaseRepository } from "../../repositories/SupabaseRepository.js";
import {
  buildEnforcementAccountFile,
  calculateDesktopEnforcementAccount,
  calculateMobileEnforcementAccount,
  groupActiveCollectionsByFile,
  toMoneyCents
} from "../../src/calculations/enforcementAccountAdapters.js";
import { enforcementAccountValuesFromFile } from "../../src/calculations/enforcementCalculator.js";
import {
  I1004_CALCULATION_TOOLS,
  I1004_MOBILE_FILE
} from "../fixtures/enforcement/i-1004.js";

const ACCOUNT_DATE = "2026-09-15";
const FILE_15K = "11111111-1111-4111-8111-111111111111";
const FILE_50K = "22222222-2222-4222-8222-222222222222";
const OTHER_FILE = "33333333-3333-4333-8333-333333333333";

function enforcementFile(id, displayId) {
  return {
    ...I1004_MOBILE_FILE,
    id,
    display_id: displayId,
    account_info: { ...I1004_MOBILE_FILE.account_info }
  };
}

function collection(id, fileId, amount, collectionDate, overrides = {}) {
  return {
    id,
    file_id: fileId,
    amount,
    collection_date: collectionDate,
    payment_kind: "collection",
    deleted_at: null,
    ...overrides
  };
}

function fourWayResults(file, collections) {
  const hydrated = buildEnforcementAccountFile(file, collections);
  const desktopValues = enforcementAccountValuesFromFile(hydrated, ACCOUNT_DATE);
  return {
    desktopList: calculateDesktopEnforcementAccount(desktopValues, I1004_CALCULATION_TOOLS, ACCOUNT_DATE),
    desktopDetail: calculateDesktopEnforcementAccount(desktopValues, I1004_CALCULATION_TOOLS, ACCOUNT_DATE),
    mobileList: calculateMobileEnforcementAccount(hydrated, I1004_CALCULATION_TOOLS, ACCOUNT_DATE),
    mobileDetail: calculateMobileEnforcementAccount(hydrated, I1004_CALCULATION_TOOLS, ACCOUNT_DATE)
  };
}

test("repository fileIds filtresini tek batch sorguda ve soft-delete koşuluyla uygular", async () => {
  const calls = [];
  const rows = [collection("collection-15k", FILE_15K, 15_000, "2026-07-20")];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    is(column, value) { calls.push(["is", column, value]); return this; },
    order(column, options) { calls.push(["order", column, options]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    in(column, values) { calls.push(["in", column, values]); return this; },
    async range(from, to) { calls.push(["range", from, to]); return { data: rows, error: null }; }
  };
  const supabase = {
    from(table) {
      calls.push(["from", table]);
      return query;
    }
  };
  const repository = new SupabaseRepository(supabase);

  const result = await repository.getCollections({ fileIds: [FILE_15K, FILE_50K, FILE_15K] });

  assert.deepEqual(result, rows);
  assert.equal(calls.filter(([name]) => name === "from").length, 1);
  assert.deepEqual(calls.find(([name]) => name === "in"), ["in", "file_id", [FILE_15K, FILE_50K]]);
  assert.deepEqual(calls.find(([name]) => name === "is"), ["is", "deleted_at", null]);
});

test("boş fileIds listesi collections tablosuna sorgu göndermez", async () => {
  let queried = false;
  const repository = new SupabaseRepository({
    from() {
      queried = true;
      throw new Error("Sorgu gönderilmemeliydi.");
    }
  });

  assert.deepEqual(await repository.getCollections({ fileIds: [] }), []);
  assert.equal(queried, false);
});

test("aktif collections doğru dosyaya gruplanır; silinen ve başka dosya kayıtları karışmaz", () => {
  const rows = [
    collection("collection-15k", FILE_15K, 15_000, "2026-07-20"),
    collection("collection-20k", FILE_15K, 20_000, "2026-08-01"),
    collection("collection-deleted", FILE_15K, 99_000, "2026-08-02", { deleted_at: "2026-08-03T10:00:00Z" }),
    collection("collection-other", OTHER_FILE, 75_000, "2026-07-20")
  ];

  const grouped = groupActiveCollectionsByFile(rows);

  assert.deepEqual(grouped.get(FILE_15K)?.map(row => row.amount), [15_000, 20_000]);
  assert.deepEqual(grouped.get(OTHER_FILE)?.map(row => row.amount), [75_000]);
  assert.equal(grouped.get(FILE_50K), undefined);
});

for (const fixture of [
  { id: FILE_15K, displayId: "İ-1007", amount: 15_000 },
  { id: FILE_50K, displayId: "İ-1006", amount: 50_000 }
]) {
  test(`${fixture.displayId} collection hydration ve dört-yol parity`, () => {
    const file = enforcementFile(fixture.id, fixture.displayId);
    const rows = [
      collection(`${fixture.id}-active`, fixture.id, fixture.amount, "2026-07-20"),
      collection(`${fixture.id}-future`, fixture.id, 12_345, "2026-10-01"),
      collection(`${fixture.id}-deleted`, fixture.id, 90_000, "2026-07-21", { deleted_at: "2026-07-22T08:00:00Z" }),
      collection(`${fixture.id}-other`, OTHER_FILE, 80_000, "2026-07-22")
    ];
    const grouped = groupActiveCollectionsByFile(rows);
    const applicableRows = grouped.get(fixture.id) || [];
    const results = fourWayResults(file, applicableRows);
    const currentDebtCents = Object.values(results).map(result => toMoneyCents(result.currentDebt));

    assert.deepEqual(applicableRows.map(row => row.amount), [fixture.amount, 12_345]);
    assert.equal(results.mobileList.payments, fixture.amount);
    assert.equal(results.mobileList.ignoredFuturePayments.length, 1);
    assert.equal(new Set(currentDebtCents).size, 1);
  });
}

test("tahsilat hydration yapılmadan canlı mobil icra girdisi kurulamaz", () => {
  assert.throws(
    () => buildEnforcementAccountFile(enforcementFile(FILE_15K, "İ-1007")),
    /tahsilat verisi yüklenmelidir/
  );
});
