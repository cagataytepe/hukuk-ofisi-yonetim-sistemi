import { expect, test } from "@playwright/test";
import { attachDiagnostics, clickRowActionByText, createLawsuitFile, deleteFileByPrefix, fillDatalistByPrefix, gotoSection, login, selectFirstOption, todayIso } from "./support/app.js";
import { e2ePrefix } from "./support/env.js";

test("Süreli İşler ekranı public.deadlines üzerinde CRUD ve tamamlama akışını çalıştırır", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  const prefix = e2ePrefix("DEADLINE");
  await login(page);

  try {
    await createLawsuitFile(page, prefix);
    await gotoSection(page, "deadlines");
    await fillDatalistByPrefix(page, "#deadlineCase", "#deadlineCaseList", prefix);
    await page.locator('#deadlineForm input[list="taskTypes"]').fill(`${prefix} süreli iş`);
    await selectFirstOption(page, "#deadlineLawyer");
    await page.locator('#deadlineForm input[type="date"]').nth(0).fill(todayIso());
    await page.locator('#deadlineForm input[type="date"]').nth(1).fill(todayIso(5));
    await page.locator("#deadlineForm textarea").fill(`${prefix} açıklama`);
    await page.locator("#deadlineSubmit").click();

    await expect(page.locator("#deadlineFullRows")).toContainText(`${prefix} süreli iş`, { timeout: 30_000 });
    await clickRowActionByText(page, "#deadlineFullRows tr", prefix, "[data-complete-deadline]");
    await expect(page.locator("#completedDeadlineRows")).toContainText(`${prefix} süreli iş`, { timeout: 20_000 });
    await clickRowActionByText(page, "#completedDeadlineRows tr", prefix, "[data-reopen-deadline]");
    await expect(page.locator("#deadlineFullRows")).toContainText(`${prefix} süreli iş`, { timeout: 20_000 });
    await clickRowActionByText(page, "#deadlineFullRows tr", prefix, "[data-delete-deadline]", { confirm: true });
    await expect(page.locator("#deadlineFullRows")).not.toContainText(`${prefix} süreli iş`, { timeout: 20_000 });
  } finally {
    await deleteFileByPrefix(page, prefix);
  }

  diagnostics.assertClean();
});
