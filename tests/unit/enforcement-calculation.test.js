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

test("faiz dönemi değişikliği sınır gününü yalnız yeni oranla hesaplar", () => {
  const result = calculatePeriodInterest({
    principal: 1_000_000,
    type: "Adi Kanuni Faiz",
    start: "2026-06-30",
    end: "2026-07-01",
    interestRates: I1004_CALCULATION_TOOLS.interestRates,
    dayBasis: 365
  });

  assert.deepEqual(result.periods.map(period => ({
    from: period.from,
    to: period.to,
    days: period.days,
    rate: period.rate
  })), [{ from: "2026-07-01", to: "2026-07-01", days: 1, rate: 31 }]);
});

test("sabit hesap tarihi aynı kuruş sonucunu tekrar üretir", () => {
  const values = { ...I1004_DESKTOP_VALUES, accountDate: "2026-09-08" };
  const first = calculateEnforcementAccount(values, I1004_CALCULATION_TOOLS);
  const second = calculateEnforcementAccount(values, I1004_CALCULATION_TOOLS);

  assert.equal(toMoneyCents(first.currentDebt), I1004_EXPECTED_CENTS["2026-09-08"].currentDebt);
  assert.equal(toMoneyCents(second.currentDebt), toMoneyCents(first.currentDebt));
  assert.deepEqual(second.interestPeriods, first.interestPeriods);
});

test("toplu tahsilat mevcut iş kuralına göre hesap sonunda bir kez düşülür", () => {
  const withoutPayment = calculateEnforcementAccount({
    ...I1004_DESKTOP_VALUES,
    accountDate: "2026-09-08"
  }, I1004_CALCULATION_TOOLS);
  const withPayment = calculateEnforcementAccount({
    ...I1004_DESKTOP_VALUES,
    payments: 25_000,
    accountDate: "2026-09-08"
  }, I1004_CALCULATION_TOOLS);

  assert.equal(toMoneyCents(withPayment.payments), 2_500_000);
  assert.equal(toMoneyCents(withoutPayment.currentDebt - withPayment.currentDebt), 2_500_000);
  assert.equal(toMoneyCents(withPayment.postInterest), toMoneyCents(withoutPayment.postInterest));
});
