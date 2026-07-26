import { expect, test } from "@playwright/test";
import { attachDiagnostics, gotoSection, login } from "./support/app.js";

test("Ayarlar kullanıcı yönetimi profiles/roles verilerini tekil rol seçenekleriyle gösterir", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);

  await gotoSection(page, "users");
  await expect(page.locator("#userRows")).toContainText("Av.", { timeout: 30_000 });
  await page.locator("#userRows [data-edit-user]").first().click();
  await expect(page.locator("#userFormTitle")).toContainText("Yetkileri");
  await expect(page.locator("#userRole option")).toHaveCount(6, { timeout: 30_000 });

  const roleNames = await page.locator("#userRole option").evaluateAll(options => options.map(option => option.textContent.trim()));
  expect(new Set(roleNames).size).toBe(roleNames.length);
  expect(roleNames).toEqual([
    "Yönetici / Partner",
    "Avukat",
    "Stajyer Avukat",
    "Sekreter / Asistan",
    "Muhasebe",
    "Yalnızca Görüntüleme"
  ]);
  expect(roleNames).not.toContain("Tam Yetkili");

  diagnostics.assertClean();
});
