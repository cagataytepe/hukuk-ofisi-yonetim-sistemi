import { expect, test } from "@playwright/test";
import { e2eCredentials } from "./support/env.js";
import { attachDiagnostics } from "./support/app.js";

test("mobil ana sayfa özet alanı hedef genişliklerde taşmadan görünür", async ({ page }, testInfo) => {
  const diagnostics = attachDiagnostics(page);
  const { email, password } = e2eCredentials();

  await page.goto("/mobile.html");
  await page.locator("#mobileEmail").fill(email);
  await page.locator("#mobilePassword").fill(password);
  await page.locator("#mobileLoginButton").click();

  await expect(page.locator(".daily-summary-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#mobileDailySummaryTitle")).toHaveText("Günün Özeti");
  await expect(page.locator(".daily-summary-row")).toHaveCount(3);
  await expect(page.locator(".dashboard-summary-card")).toHaveCount(3);
  await expect(page.locator(".dashboard-summary-card").nth(0)).toContainText("Duruşmalar");
  await expect(page.locator(".dashboard-summary-card").nth(1)).toContainText("Süreli İşler");
  await expect(page.locator(".dashboard-summary-card").nth(2)).toContainText("Bana Atanmış Görevler");

  for (const width of [390, 414, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const hero = document.querySelector(".daily-summary-card");
      const cards = [...document.querySelectorAll(".dashboard-summary-card")];
      const descriptions = [...document.querySelectorAll(".daily-summary-row > span:last-child")];
      const cardTops = cards.map(card => Math.round(card.getBoundingClientRect().top));
      const heroBackground = hero ? getComputedStyle(hero, "::before").backgroundImage : "";
      return {
        documentFits: document.documentElement.scrollWidth <= window.innerWidth,
        cardsShareRow: cardTops.length === 3 && cardTops.every(top => top === cardTops[0]),
        descriptionsFit: descriptions.every(description => description.scrollWidth <= description.clientWidth),
        heroHeight: Math.round(hero?.getBoundingClientRect().height || 0),
        hasCourthouseBackground: heroBackground.includes("courthouse-columns.svg")
      };
    });

    expect(layout.documentFits, `${width}px genişlikte yatay taşma olmamalı`).toBe(true);
    expect(layout.cardsShareRow, `${width}px genişlikte sayaçlar aynı satırda kalmalı`).toBe(true);
    expect(layout.descriptionsFit, `${width}px genişlikte açıklamalar taşmamalı`).toBe(true);
    expect(layout.heroHeight, `${width}px genişlikte hero gereksiz büyümemeli`).toBeLessThan(270);
    expect(layout.hasCourthouseBackground).toBe(true);

    if (width === 390) {
      await testInfo.attach("mobile-dashboard-summary-390", {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png"
      });
    }
  }

  diagnostics.assertClean();
});
