import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEnforcementAccount,
  calculatePeriodInterest
} from "../../src/calculations/enforcementCalculator.js";
import { toMoneyCents } from "../../src/calculations/enforcementAccountAdapters.js";
import {
  I1004_CALCULATION_TOOLS,
  I1004_DESKTOP_VALUES,
  I1004_EXPECTED_CENTS
} from "../fixtures/enforcement/i-1004.js";

test("30 Temmuz 2026 hesap tarihinde yüzde 31 oranı uygulanmaz", () => {
  const result = calculatePeriodInterest({
    principal: 1_000_000,
    type: "Adi Kanuni Faiz",
    start: "2026-07-29",
    end: "2026-07-30",
    interestRates: I1004_CALCULATION_TOOLS.interestRates,
    dayBasis: 365
  });

  assert.deepEqual(result.periods.map(period => ({
    from: period.from,
    to: period.to,
    days: period.days,
    rate: period.rate
  })), [{ from: "2026-07-30", to: "2026-07-30", days: 1, rate: 24 }]);
});

test("31 Temmuz 2026 hesap tarihinde yüzde 31 oranı başlar", () => {
  const result = calculatePeriodInterest({
    principal: 1_000_000,
    type: "Adi Kanuni Faiz",
    start: "2026-07-30",
    end: "2026-07-31",
    interestRates: I1004_CALCULATION_TOOLS.interestRates,
    dayBasis: 365
  });

  assert.deepEqual(result.periods.map(period => ({
    from: period.from,
    to: period.to,
    days: period.days,
    rate: period.rate
  })), [{ from: "2026-07-31", to: "2026-07-31", days: 1, rate: 31 }]);
});

test("30 Temmuz ile 1 Ağustos arasındaki faiz doğru dönemlere bölünür", () => {
  const result = calculatePeriodInterest({
    principal: 1_000_000,
    type: "Adi Kanuni Faiz",
    start: "2026-07-29",
    end: "2026-08-01",
    interestRates: I1004_CALCULATION_TOOLS.interestRates,
    dayBasis: 365
  });

  assert.deepEqual(result.periods.map(period => ({
    from: period.from,
    to: period.to,
    days: period.days,
    rate: period.rate
  })), [
    { from: "2026-07-30", to: "2026-07-30", days: 1, rate: 24 },
    { from: "2026-07-31", to: "2026-08-01", days: 2, rate: 31 }
  ]);
});

test("sabit hesap tarihi aynı kuruş sonucunu tekrar üretir", () => {
  const values = { ...I1004_DESKTOP_VALUES, accountDate: "2026-09-08" };
  const first = calculateEnforcementAccount(values, I1004_CALCULATION_TOOLS);
  const second = calculateEnforcementAccount(values, I1004_CALCULATION_TOOLS);

  assert.equal(toMoneyCents(first.currentDebt), I1004_EXPECTED_CENTS["2026-09-08"].currentDebt);
  assert.equal(toMoneyCents(second.currentDebt), toMoneyCents(first.currentDebt));
  assert.deepEqual(second.interestPeriods, first.interestPeriods);
});

test("eski toplu tahsilat alanı canlı hesap sonucundan tekrar düşülmez", () => {
  const withoutPayment = calculateEnforcementAccount({
    ...I1004_DESKTOP_VALUES,
    accountDate: "2026-09-08"
  }, I1004_CALCULATION_TOOLS);
  const withPayment = calculateEnforcementAccount({
    ...I1004_DESKTOP_VALUES,
    payments: 25_000,
    accountDate: "2026-09-08"
  }, I1004_CALCULATION_TOOLS);

  assert.equal(toMoneyCents(withPayment.payments), 0);
  assert.equal(toMoneyCents(withPayment.legacyPaymentTotal), 2_500_000);
  assert.equal(toMoneyCents(withoutPayment.currentDebt), toMoneyCents(withPayment.currentDebt));
  assert.equal(toMoneyCents(withPayment.postInterest), toMoneyCents(withoutPayment.postInterest));
});
