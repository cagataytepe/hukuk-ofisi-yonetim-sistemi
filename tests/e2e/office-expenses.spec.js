import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login, selectFirstOption, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Ofis gideri odeme kaynaklari ortak katkisini dogru hesaplar", async ({ page }) => {
  test.setTimeout(180_000);
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("OFFICE-EXPENSE-SOURCE");
  const cleanupMarker = "OFFICE-EXPENSE-SOURCE";
  const createdVendors = [];
  const futureIso = offset => {
    const date = new Date(`${todayIso()}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const contributionAmount = async profileId => Number(
    await page.locator(`[data-contribution-profile="${profileId}"]`).getAttribute("data-paid-amount") || 0
  );

  const openOverview = async () => {
    await page.locator('[data-office-expense-tab="overview"]').click();
    await expect(page.locator("#officeExpensePartnerSummary")).toBeVisible();
  };

  const createExpense = async ({ vendor, amount, source }) => {
    await page.locator("#newOfficeExpense").click();
    await page.locator("#officeExpenseAmount").fill(String(amount));
    await page.locator("#officeExpenseDate").fill(todayIso());
    await page.locator("#officeExpenseDueDate").fill(todayIso());
    await selectFirstOption(page, "#officeExpenseCategory");
    await page.locator("#officeExpenseStatus").selectOption("paid");
    await page.locator("#officeExpensePaymentSource").selectOption(source);
    await page.locator("#officeExpensePaymentMethod").selectOption("bank_transfer");
    await page.locator("#officeExpenseVendor").fill(vendor);
    await page.locator("#officeExpenseForm button[type='submit']").click();
    await expect(page.locator("#officeExpenseFormPanel")).toBeHidden({ timeout: 30_000 });
    createdVendors.push(vendor);
  };

  const editExpenseSource = async (vendor, source) => {
    await page.locator('[data-office-expense-tab="expenses"]').click();
    await page.locator("#officeExpenseSearch").fill(vendor);
    const row = page.locator("#officeExpenseRows tr").filter({ hasText: vendor }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.locator("#officeExpensePaymentSource").selectOption(source);
    await page.locator("#officeExpenseForm button[type='submit']").click();
    await expect(page.locator("#officeExpenseFormPanel")).toBeHidden({ timeout: 30_000 });
    await page.locator("#officeExpenseSearch").fill("");
  };

  await login(page);
  await gotoSection(page, "officeExpenses");
  await expect(page.locator("#officeExpenseKpis")).toBeVisible();
  await expect.poll(() => page.locator("#officeExpenseCategory option").count()).toBeGreaterThan(1);
  await expect.poll(() => page.locator('#officeExpensePaymentSource option[value^="partner:"]').count()).toBe(3);

  const partnerOptions = await page.locator('#officeExpensePaymentSource option[value^="partner:"]').evaluateAll(options =>
    options.map(option => ({ value: option.value, name: option.textContent.trim() }))
  );
  const initialAmounts = new Map();
  await openOverview();
  for (const option of partnerOptions) {
    initialAmounts.set(option.value, await contributionAmount(option.value.replace("partner:", "")));
  }

  await test.step("Ofis Hesabi ortak katkisi olusturmaz", async () => {
    const vendor = `${prefix}-OFFICE`;
    await createExpense({ vendor, amount: 101.01, source: "office_account" });
    await openOverview();
    for (const option of partnerOptions) {
      const profileId = option.value.replace("partner:", "");
      await expect.poll(() => contributionAmount(profileId)).toBe(initialAmounts.get(option.value));
    }
  });

  await test.step("Guncellemede kisisel hesap katkisi olusur ve Ofis Hesabinda kalkar", async () => {
    const vendor = `${prefix}-OFFICE`;
    const firstPartner = partnerOptions[0];
    const profileId = firstPartner.value.replace("partner:", "");
    await editExpenseSource(vendor, firstPartner.value);
    await openOverview();
    await expect.poll(() => contributionAmount(profileId)).toBeCloseTo(initialAmounts.get(firstPartner.value) + 101.01, 2);

    await editExpenseSource(vendor, "office_account");
    await openOverview();
    await expect.poll(() => contributionAmount(profileId)).toBeCloseTo(initialAmounts.get(firstPartner.value), 2);
  });

  await test.step("Her ortak kisisel hesabindan yapilan odeme katkida gorunur", async () => {
    for (let index = 0; index < partnerOptions.length; index += 1) {
      const option = partnerOptions[index];
      const amount = (index + 1) * 111.11;
      await createExpense({
        vendor: `${prefix}-PARTNER-${index + 1}`,
        amount,
        source: option.value
      });
      await openOverview();
      const profileId = option.value.replace("partner:", "");
      await expect.poll(() => contributionAmount(profileId)).toBeCloseTo(initialAmounts.get(option.value) + amount, 2);
    }
  });

  const recurringVendor = `${prefix}-RECURRING`;
  await test.step("Bekleyen tekrarlayan gider tabloda ve yaklasan odemelerde gorunur", async () => {
    const upcomingDate = futureIso(10);
    await page.locator("#newOfficeExpense").click();
    await page.locator("#officeExpenseAmount").fill("1250");
    await page.locator("#officeExpenseDate").fill(upcomingDate);
    await page.locator("#officeExpenseDueDate").fill(upcomingDate);
    await selectFirstOption(page, "#officeExpenseCategory");
    await page.locator("#officeExpenseStatus").selectOption("pending");
    await page.locator("#officeExpensePaymentSource").selectOption("office_account");
    await page.locator("#officeExpenseVendor").fill(recurringVendor);
    await page.locator("#officeExpenseRecurring").check();
    await expect(page.locator("#officeExpenseNextDue")).toHaveValue(upcomingDate);
    await page.locator("#officeExpenseForm button[type='submit']").click();
    await expect(page.locator("#officeExpenseFormPanel")).toBeHidden({ timeout: 30_000 });

    await page.locator('[data-office-expense-tab="expenses"]').click();
    await expect(page.locator("#officeExpenseRows tr").filter({ hasText: recurringVendor })).toBeVisible({ timeout: 30_000 });
    await openOverview();
    await expect(page.locator("#officeExpenseUpcoming")).toContainText(recurringVendor);
    await page.locator('[data-office-expense-tab="recurring"]').click();
    await expect(page.locator("#officeExpenseRecurringList").locator("[data-recurring-office-expense]").filter({ hasText: recurringVendor })).toBeVisible();
  });

  await test.step("Ofis gideri PDF hedefi yazdirma sirasinda gorunur", async () => {
    await page.locator('[data-office-expense-tab="analytics"]').click();
    await expect(page.locator("#officeExpenseReportPanel")).toBeVisible();
    await page.locator("#officeExpenseReportType").selectOption("monthly");
    await expect(page.locator("#officeExpenseReportHead")).toContainText("Ödeme Tarihi");
    await expect(page.locator("#officeExpenseReportHead")).toContainText("Kategori / Alt Kategori");
    await expect(page.locator("#officeExpenseReportHead")).not.toContainText("Dönem");
    await expect(page.locator("#officeExpenseReportHead")).not.toContainText("Satıcı");
    await expect(page.locator("#officeExpenseReportRows")).toContainText("Ofis Hesabı");
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => {
      window.__officeExpensePrintSnapshot = null;
      window.print = () => {
        const target = document.getElementById("officeExpenseReportPanel");
        const parent = target.closest('[data-office-expense-view="analytics"]');
        window.__officeExpensePrintSnapshot = {
          targetDisplay: getComputedStyle(target).display,
          parentDisplay: getComputedStyle(parent).display,
          targetSelected: target.classList.contains("printing-target"),
          sectionSelected: document.getElementById("officeExpenses").classList.contains("printing")
        };
      };
    });
    await page.evaluate(() => document.getElementById("printOfficeExpenses").click());
    await expect.poll(() => page.evaluate(() => window.__officeExpensePrintSnapshot)).toEqual({
      targetDisplay: "block",
      parentDisplay: "block",
      targetSelected: true,
      sectionSelected: true
    });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
  });

  await test.step("E2E giderlerini soft delete ile temizle", async () => {
    await page.locator('[data-office-expense-tab="expenses"]').click();
    await page.locator("#officeExpenseSearch").fill(cleanupMarker);
    const matchingRows = page.locator("#officeExpenseRows tr").filter({ hasText: cleanupMarker });
    while (await matchingRows.count()) {
      const previousCount = await matchingRows.count();
      page.once("dialog", dialog => dialog.accept());
      await matchingRows.first().getByRole("button", { name: "Sil" }).click();
      await expect.poll(() => matchingRows.count()).toBeLessThan(previousCount);
    }
    await expect(page.locator("#officeExpenseRows")).not.toContainText(cleanupMarker, { timeout: 30_000 });

    await page.locator('[data-office-expense-tab="recurring"]').click();
    const recurringCards = page.locator("#officeExpenseRecurringList [data-recurring-office-expense]").filter({ hasText: cleanupMarker });
    while (await recurringCards.count()) {
      const previousCount = await recurringCards.count();
      page.once("dialog", dialog => dialog.accept());
      await recurringCards.first().locator("[data-delete-recurring-expense]").click();
      await expect.poll(() => recurringCards.count()).toBeLessThan(previousCount);
    }
  });

  diagnostics.assertClean();
});
