import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Ödeme Takibi ekranı müvekkil vekalet ücreti planını oluşturur ve soft delete eder", async ({ page }) => {
  const diagnostics = attachDiagnostics(page, { ignoreFetchAbortNoise: true });
  const prefix = e2ePrefix("PAYMENT");
  await login(page);

  await gotoSection(page, "payments");
  const newPlanButton = page.locator("#newPaymentPlan");
  if (await newPlanButton.count() && await newPlanButton.isVisible()) await newPlanButton.click();
  await page.selectOption("#paymentPlanType", { index: 1 });
  await page.locator("#paymentPartyName").fill(`${prefix} Müvekkil`);
  await page.locator("#paymentAgreementAmount").fill("10000");
  await page.locator("#paymentInitialAmount").fill("2500");
  await page.locator("#paymentInstallmentCount").fill("3");
  await page.locator("#paymentFirstDueDate").fill(todayIso(7));
  await page.locator("#paymentDescription").fill(`${prefix} ödeme planı`);
  await page.locator("#paymentPlanForm button[type='submit']").click();

  const card = page.locator("[data-payment-plan-card]").filter({ hasText: prefix }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  page.once("dialog", dialog => dialog.accept().catch(() => {}));
  await card.locator("[data-delete-payment-plan]").click();
  await expect(page.locator("#paymentPlanRows")).not.toContainText(`${prefix} Müvekkil`, { timeout: 20_000 });

  diagnostics.assertClean();
});
