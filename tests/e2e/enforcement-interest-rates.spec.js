import { expect, test } from "@playwright/test";
import {
  calculateEnforcementAccount,
  calculatePeriodInterest
} from "../../src/calculations/enforcementCalculator.js";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

const controlledRates = [
  { id: "old", type: "Adi Kanuni Faiz", from: "2026-01-01", to: "2026-07-31", rate: 24, active: true },
  { id: "new", type: "Adi Kanuni Faiz", from: "2026-08-01", to: "", rate: 30, active: true }
];

test("Adi kanuni faiz mevcut dosyada yürürlük dönemlerine ayrılır", () => {
  const result = calculatePeriodInterest({
    principal: 100_000,
    type: "Adi Kanuni Faiz",
    fallbackRate: 99,
    start: "2026-01-01",
    end: "2026-08-15",
    interestRates: controlledRates,
    dayBasis: 365
  });

  expect(result.periods).toHaveLength(2);
  expect(result.periods[0]).toMatchObject({ from: "2026-01-02", to: "2026-07-31", rate: 24, days: 211, usedFallback: false });
  expect(result.periods[1]).toMatchObject({ from: "2026-08-01", to: "2026-08-15", rate: 30, days: 15, usedFallback: false });
  const expected = (100_000 * 0.24 * 211 / 365) + (100_000 * 0.30 * 15 / 365);
  expect(result.amount).toBeCloseTo(expected, 8);
});

test("Yürürlük sınır günü bir kez ve yeni oranla hesaplanır", () => {
  const before = calculatePeriodInterest({
    principal: 100_000,
    type: "Adi Kanuni Faiz",
    start: "2026-07-30",
    end: "2026-07-31",
    interestRates: controlledRates
  });
  const boundary = calculatePeriodInterest({
    principal: 100_000,
    type: "Adi Kanuni Faiz",
    start: "2026-07-31",
    end: "2026-08-01",
    interestRates: controlledRates
  });
  const after = calculatePeriodInterest({
    principal: 100_000,
    type: "Adi Kanuni Faiz",
    start: "2026-08-01",
    end: "2026-08-02",
    interestRates: controlledRates
  });

  expect(before.periods).toEqual([expect.objectContaining({ from: "2026-07-31", to: "2026-07-31", rate: 24, days: 1 })]);
  expect(boundary.periods).toEqual([expect.objectContaining({ from: "2026-08-01", to: "2026-08-01", rate: 30, days: 1 })]);
  expect(after.periods).toEqual([expect.objectContaining({ from: "2026-08-02", to: "2026-08-02", rate: 30, days: 1 })]);
});

test("Mevcut toplu tahsilat davranışı faizden sonra bakiyeden düşülür", () => {
  const result = calculateEnforcementAccount({
    principal: 100_000,
    preInterest: 0,
    payments: 10_000,
    interestType: "Adi Kanuni Faiz",
    interestStart: "2026-07-31",
    accountDate: "2026-08-01",
    followUpType: "İlamsız Takip",
    feeRate: 0
  }, {
    interestRates: controlledRates,
    attorneyFeeTariffs: [],
    parameters: [{ key: "interest_day_basis", value: 365, active: true }]
  });

  expect(result.postInterest).toBeCloseTo(100_000 * 0.30 / 365, 8);
  expect(result.currentDebt).toBeCloseTo(100_000 + result.postInterest - 10_000, 8);
});

test("İcra dosyası formu merkezi faiz oranını salt okunur gösterir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await gotoSection(page, "cases");
  await page.locator("#openNewFileForm").click();
  await page.locator('[data-file-type-card="İcra Dosyası"]').click();
  await page.locator("#caseFollowUpDate").fill("2026-07-31");
  await page.locator("#caseInterestType").selectOption({ label: "Adi Kanuni Faiz" });
  await page.locator("#caseInterestType").dispatchEvent("change");

  await expect(page.locator("#caseInterestRate")).toHaveAttribute("readonly", "");
  await expect(page.locator("#caseInterestRateInfo")).toContainText("merkezi oran");
  diagnostics.assertClean();
});
