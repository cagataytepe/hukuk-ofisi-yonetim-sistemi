import { expect, test } from "@playwright/test";
import { attachDiagnostics, login } from "./support/app.js";

test("bildirim merkezi filtre, okundu ve kalıcılık akışını çalıştırır", async ({ page }) => {
  const diagnostics = attachDiagnostics(page);
  await login(page);
  await page.locator("#notificationCenterButton").click();
  await expect(page.locator("#notificationDrawer")).toHaveClass(/open/);
  await expect(page.locator("#notificationList")).not.toContainText("Bildirimler yükleniyor", { timeout: 20_000 });
  await page.locator('[data-notification-filter="urgent"]').click();
  await expect(page.locator('[data-notification-filter="urgent"]')).toHaveClass(/active/);
  await page.locator('[data-notification-filter="all"]').click();
  const unread = page.locator("#notificationList .notification-item.unread").first();
  if (await unread.count()) await unread.click();
  if (!await page.locator("#notificationDrawer").evaluate(element => element.classList.contains("open"))) await page.locator("#notificationCenterButton").click();
  await page.locator("#markAllNotificationsRead").click();
  await expect(page.locator("#notificationUnreadBadge")).toBeHidden();
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator("#notificationUnreadBadge")).toBeHidden();
  diagnostics.assertClean();
});
