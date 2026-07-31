import { expect, test } from "@playwright/test";
import { attachDiagnostics, expectNoVisibleUuid, gotoSection, login } from "./support/app.js";

test("Dashboard Supabase verileriyle yüklenir ve bilgi kartları navigasyon yapmaz", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);

  await gotoSection(page, "dashboard");
  await expect(page.locator("#todayHearings")).toBeVisible();
  await expect(page.locator("#soonDeadlines")).toBeVisible();
  await expect(page.locator("#assignedTasks")).toBeVisible();
  await expect(page.locator("#lateDeadlines")).toBeVisible();
  await expect(page.locator("#hearingRows")).toBeVisible();
  await expect(page.locator("#deadlineRows")).toBeVisible();

  const taskMetric = page.locator('.metric-grid [data-dashboard-section="tasks"]');
  await expect(taskMetric).toHaveCount(1);
  await taskMetric.click();
  await expect(page.locator("section#dashboard")).toHaveClass(/active/);
  await expectNoVisibleUuid(page);
  diagnostics.assertClean();
});
