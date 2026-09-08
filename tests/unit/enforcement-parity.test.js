import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDesktopEnforcementAccount,
  calculateMobileEnforcementAccount,
  toMoneyCents
} from "../../src/calculations/enforcementAccountAdapters.js";
import {
  I1004_ACCOUNT_DATES,
  I1004_CALCULATION_TOOLS,
  I1004_DESKTOP_VALUES,
  I1004_EXPECTED_CENTS,
  I1004_MOBILE_FILE,
  I1004_SAVED_SNAPSHOT_DEBT
} from "../fixtures/enforcement/i-1004.js";

const MONEY_FIELDS = [
  "principal",
  "postInterest",
  "attorneyFee",
  "collectionFee",
  "expenses",
  "payments",
  "currentDebt"
];

for (const accountDate of I1004_ACCOUNT_DATES) {
  test(`I-1004 masaüstü ve mobil parity: ${accountDate}`, () => {
    const desktop = calculateDesktopEnforcementAccount(
      I1004_DESKTOP_VALUES,
      I1004_CALCULATION_TOOLS,
      accountDate
    );
    const mobile = calculateMobileEnforcementAccount(
      I1004_MOBILE_FILE,
      I1004_CALCULATION_TOOLS,
      accountDate
    );

    for (const field of MONEY_FIELDS) {
      const desktopCents = toMoneyCents(desktop[field]);
      const mobileCents = toMoneyCents(mobile[field]);
      assert.equal(mobileCents, desktopCents, `${field} adapter sonucu farklı`);
      assert.equal(desktopCents, I1004_EXPECTED_CENTS[accountDate][field], `${field} fixture sonucu değişti`);
    }
  });
}

test("mobil canlı hesap varken eski currentDebt snapshot değerini ana bakiye yapmaz", () => {
  const live = calculateMobileEnforcementAccount(
    I1004_MOBILE_FILE,
    I1004_CALCULATION_TOOLS,
    "2026-09-08"
  );

  assert.notEqual(toMoneyCents(live.currentDebt), toMoneyCents(I1004_SAVED_SNAPSHOT_DEBT));
  assert.equal(toMoneyCents(live.currentDebt), I1004_EXPECTED_CENTS["2026-09-08"].currentDebt);
});

test("masaüstü ve mobil adapter ödeme girdisini aynı motora aynı şekilde taşır", () => {
  const desktopValues = { ...I1004_DESKTOP_VALUES, payments: 25_000 };
  const mobileFile = {
    ...I1004_MOBILE_FILE,
    account_info: { ...I1004_MOBILE_FILE.account_info, payments: 25_000 }
  };
  const desktop = calculateDesktopEnforcementAccount(desktopValues, I1004_CALCULATION_TOOLS, "2026-09-08");
  const mobile = calculateMobileEnforcementAccount(mobileFile, I1004_CALCULATION_TOOLS, "2026-09-08");

  assert.equal(toMoneyCents(desktop.payments), 2_500_000);
  assert.equal(toMoneyCents(mobile.currentDebt), toMoneyCents(desktop.currentDebt));
  assert.equal(toMoneyCents(mobile.postInterest), toMoneyCents(desktop.postInterest));
});

test("adapter açık bir accountDate olmadan hesap yapmaz", () => {
  assert.throws(
    () => calculateDesktopEnforcementAccount(I1004_DESKTOP_VALUES, I1004_CALCULATION_TOOLS),
    /accountDate zorunludur/
  );
  assert.throws(
    () => calculateMobileEnforcementAccount(I1004_MOBILE_FILE, I1004_CALCULATION_TOOLS),
    /accountDate zorunludur/
  );
});
