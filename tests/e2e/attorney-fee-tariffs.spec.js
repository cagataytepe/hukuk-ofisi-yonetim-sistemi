import { expect, test } from "@playwright/test";
import { calculateAttorneyFee } from "../../src/calculations/enforcementCalculator.js";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

const tariffs = [
  {
    id: "2025",
    name: "AAÜT 2025",
    year: 2025,
    scope: "İcra",
    from: "2024-10-01",
    to: "2025-11-03",
    regularMinimum: 8_000,
    evictionMinimum: 18_000,
    active: true,
    brackets: [{ limit: null, rate: 15 }]
  },
  {
    id: "2026",
    name: "AAÜT 2026",
    year: 2026,
    scope: "İcra",
    from: "2025-11-04",
    to: "",
    regularMinimum: 9_000,
    evictionMinimum: 20_000,
    active: true,
    brackets: [
      { limit: 600_000, rate: 16 },
      { limit: null, rate: 15 }
    ]
  }
];

test("Vekâlet ücreti hesap tarihinde yürürlükteki tarifeyi ve asıl alacak üst sınırını kullanır", () => {
  const result = calculateAttorneyFee({
    baseAmount: 450_000,
    upperLimit: 420_000,
    followUpType: "İlamsız Takip",
    accountDate: "2026-01-20",
    tariffs
  });

  expect(result.tariff?.name).toBe("AAÜT 2026");
  expect(result.relativeAmount).toBe(72_000);
  expect(result.amount).toBe(72_000);
  expect(result.amount).toBeLessThanOrEqual(420_000);
  expect(result.bracketDetails).toEqual([
    expect.objectContaining({ amount: 450_000, rate: 16, fee: 72_000 })
  ]);
});

test("Geçmiş hesap tarihi geçmiş tarifeyi kullanmaya devam eder", () => {
  const result = calculateAttorneyFee({
    baseAmount: 100_000,
    upperLimit: 100_000,
    followUpType: "İlamsız Takip",
    accountDate: "2025-06-01",
    tariffs
  });

  expect(result.tariff?.name).toBe("AAÜT 2025");
  expect(result.amount).toBe(15_000);
});

test("Vekâlet ücreti tarihçesi Ayarlar altında görünür", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await gotoSection(page, "users");
  await page.locator("#openCalculationTools").click();
  await page.locator('[data-calculation-tab="attorney"]').click();

  await expect(page.locator("#attorneyFeeSettingsRows")).toContainText("AAÜT", { timeout: 30_000 });
  await expect(page.locator("#attorneyFeeSettingsRows")).toContainText("İcra");
  diagnostics.assertClean();
});
