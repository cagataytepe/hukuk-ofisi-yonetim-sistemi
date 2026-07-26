import { expect, test } from "@playwright/test";
import { attachDiagnostics, clickRowActionByText, gotoSection, login, selectFirstOption, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Görevler ekranı public.tasks üzerinde ofis görevi CRUD ve tamamlama akışını çalıştırır", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("TASK");
  await login(page);

  await gotoSection(page, "tasks");
  await page.locator("#taskNew").click();
  await page.locator("#taskTitle").fill(`${prefix} ofis görevi`);
  await page.locator("#taskDescription").fill(`${prefix} açıklama`);
  await selectFirstOption(page, "#taskResponsible");
  await page.locator("#taskDueDate").fill(todayIso(3));
  await page.locator("#taskForm button[type='submit']").click();

  await expect(page.locator("#taskRows")).toContainText(`${prefix} ofis görevi`, { timeout: 30_000 });
  await clickRowActionByText(page, "#taskRows tr", prefix, "[data-complete-task]");
  await expect(page.locator("#completedTaskRows")).toContainText(`${prefix} ofis görevi`, { timeout: 20_000 });
  await clickRowActionByText(page, "#completedTaskRows tr", prefix, "[data-reopen-task]");
  await expect(page.locator("#taskRows")).toContainText(`${prefix} ofis görevi`, { timeout: 20_000 });
  await clickRowActionByText(page, "#taskRows tr", prefix, "[data-delete-task]", { confirm: true });
  await expect(page.locator("#taskRows")).not.toContainText(`${prefix} ofis görevi`, { timeout: 20_000 });

  diagnostics.assertClean();
});
