import { expect, test } from "@playwright/test";
import { e2eCredentials } from "./support/env.js";
import { attachDiagnostics } from "./support/app.js";

async function expectFileStatusTones(cards) {
  const badges = await cards.locator(".list-tail .mobile-badge").evaluateAll(elements => elements.map(element => ({
    label: element.textContent?.trim() || "",
    classes: Array.from(element.classList)
  })));

  for (const badge of badges) {
    const status = badge.label
      .toLocaleLowerCase("tr-TR")
      .replaceAll("ı", "i")
      .replaceAll("ş", "s")
      .replaceAll("ğ", "g")
      .replaceAll("ç", "c")
      .replaceAll("ö", "o")
      .replaceAll("ü", "u");
    const expectedClass = ["acik", "aktif", "devam ediyor"].includes(status)
      ? "success"
      : status.includes("karara cikmis") || status.includes("sonuclandi")
        ? "file-status-decision"
        : status.includes("istinaf")
          ? "file-status-appeal"
          : status.includes("yargitay") || status.includes("temyiz")
            ? "file-status-supreme"
            : status.includes("durdurulmus") || status.includes("beklemede")
              ? "file-status-paused"
              : status.includes("tahsilat") || status.includes("odeme plan")
                ? "file-status-collection"
                : status.includes("infaz")
                  ? "file-status-execution"
                  : "";

    if (expectedClass) expect(badge.classes, `${badge.label} rozet rengi`).toContain(expectedClass);
    if (status.includes("kapal") || status.includes("kapandi")) {
      expect(badge.classes, `${badge.label} mevcut nötr rengini korumalı`).not.toContain("success");
    }
  }
}

test("ayrı mobil shell temel görüntüleme akışlarını çalıştırır", async ({ page }) => {
  test.setTimeout(120_000);
  const diagnostics = attachDiagnostics(page);
  const { email, password } = e2eCredentials();

  await page.goto("/mobile.html");
  await expect(page.locator("#mobileEmail")).toBeVisible();
  await page.locator("#mobileEmail").fill(email);
  await page.locator("#mobilePassword").fill(password);
  await page.locator("#mobileLoginButton").click();

  await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".welcome-card")).toContainText("Hoş geldiniz");
  await expect(page.locator(".metric-card")).toHaveCount(4);
  await expect(page.locator(".mobile-section")).toHaveCount(3);
  await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
  await expect(page.locator(".mobile-bottom-nav")).toHaveCSS("position", "fixed");
  await expect(page.locator(".mobile-bottom-nav .mobile-nav")).toHaveCount(5);
  await expect(page.locator('.mobile-nav[data-route="hearings"]')).toBeVisible();
  await expect(page.locator('.mobile-nav[data-route="deadlines"]')).toBeVisible();

  const homeDateWindows = await page.evaluate(() => {
    const format = (date, options) => new Intl.DateTimeFormat("tr-TR", options).format(date);
    const dates = Array.from({ length: 8 }, (_, offset) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return date;
    });
    return {
      hearings: dates.slice(0, 3).map(date => format(date, { day: "2-digit", month: "short" })),
      deadlines: dates.map(date => `Son gün: ${format(date, { day: "2-digit", month: "short", year: "numeric" })}`)
    };
  });
  const homeHearingDates = await page.locator(".home-section-hearings .hearing-time small").allTextContents();
  const homeDeadlineDates = await page.locator(".home-section-deadlines .list-meta span:first-child").allTextContents();
  homeHearingDates.forEach(value => expect(homeDateWindows.hearings).toContain(value.trim()));
  homeDeadlineDates.forEach(value => expect(homeDateWindows.deadlines).toContain(value.trim()));

  await page.locator('.mobile-nav[data-route="files"]').click();
  await expect(page.locator("#mobileFileSearch")).toBeVisible();
  await expect(page.locator("[data-file-id]")).toHaveCount(10);
  await expect(page.locator(".mobile-pagination")).toBeVisible();
  await expect(page.locator('.mobile-pagination button:has-text("İlk")')).toBeVisible();
  await expect(page.locator('.mobile-pagination button:has-text("Geri")')).toBeVisible();
  await expect(page.locator('.mobile-pagination button:has-text("İleri")')).toBeVisible();
  await expect(page.locator('.mobile-pagination button:has-text("Son")')).toBeVisible();
  await page.locator('[data-file-filter="law"]').click();
  const firstFile = page.locator("[data-file-id].is-lawsuit").first();
  await expect(firstFile).toBeVisible({ timeout: 30_000 });
  await expect(firstFile.locator(".file-card-title")).toBeVisible();
  await expect(firstFile.locator(".file-card-subject")).toBeVisible();
  await expect(firstFile.locator(".file-card-party")).toBeVisible();
  await expect(firstFile.locator(".file-card-id")).toBeVisible();
  await expect(firstFile.locator(".list-content .file-card-id")).toHaveCount(0);
  await expectFileStatusTones(page.locator("[data-file-id].is-lawsuit"));
  const fileLeadingLayout = await firstFile.locator(".file-card-leading").evaluate(element => {
    const iconBox = element.querySelector(".list-icon")?.getBoundingClientRect();
    const idBox = element.querySelector(".file-card-id")?.getBoundingClientRect();
    return {
      idBelowIcon: Boolean(iconBox && idBox && idBox.top >= iconBox.bottom),
      centerDifference: iconBox && idBox ? Math.abs((iconBox.left + iconBox.width / 2) - (idBox.left + idBox.width / 2)) : 99
    };
  });
  expect(fileLeadingLayout.idBelowIcon).toBe(true);
  expect(fileLeadingLayout.centerDifference).toBeLessThanOrEqual(1);
  await firstFile.click();
  await expect(page.locator(".file-hero")).toBeVisible();
  await expect(page.locator('[data-detail-tab="hearings"]')).toBeVisible();
  await expect(page.locator('[data-detail-tab="payments"]')).toHaveCount(0);

  await page.locator('.mobile-nav[data-route="files"]').click();
  await page.locator('[data-file-filter="enforcement"]').click();
  const firstEnforcementFile = page.locator("[data-file-id].is-enforcement").first();
  await expect(firstEnforcementFile).toBeVisible({ timeout: 30_000 });
  await expect(firstEnforcementFile.locator(".file-card-party")).toBeVisible();
  await expect(firstEnforcementFile.locator(".file-card-account")).toContainText("Güncel Kapak Hesabı");
  await expect(firstEnforcementFile.locator(".file-card-id")).toBeVisible();
  await expectFileStatusTones(page.locator("[data-file-id].is-enforcement"));
  const enforcementLeadingLayout = await firstEnforcementFile.locator(".file-card-leading").evaluate(element => {
    const iconBox = element.querySelector(".list-icon")?.getBoundingClientRect();
    const idBox = element.querySelector(".file-card-id")?.getBoundingClientRect();
    return {
      idBelowIcon: Boolean(iconBox && idBox && idBox.top >= iconBox.bottom),
      centerDifference: iconBox && idBox ? Math.abs((iconBox.left + iconBox.width / 2) - (idBox.left + idBox.width / 2)) : 99
    };
  });
  expect(enforcementLeadingLayout.idBelowIcon).toBe(true);
  expect(enforcementLeadingLayout.centerDifference).toBeLessThanOrEqual(1);
  await firstEnforcementFile.click();
  await expect(page.locator(".file-hero")).toBeVisible();
  await expect(page.locator('[data-detail-tab="account"]')).toBeVisible();
  await expect(page.locator('[data-detail-tab="hearings"]')).toHaveCount(0);
  await expect(page.locator('[data-detail-tab="deadlines"]')).toHaveCount(0);
  await expect(page.locator('[data-detail-tab="tasks"]')).toHaveCount(0);
  await expect(page.locator('[data-detail-tab="payments"]')).toBeVisible();
  await page.locator('[data-detail-tab="parties"]').click();
  await expect(page.locator(".detail-panel")).toBeVisible();
  await page.locator('[data-detail-tab="account"]').click();
  await expect(page.locator(".enforcement-account-card")).toBeVisible();

  await page.locator('.mobile-nav[data-route="hearings"]').click();
  await expect(page.getByRole("heading", { name: "Duruşmalar" })).toBeVisible();
  await expect(page.locator('[data-hearing-view="week"]')).toHaveClass(/active/);
  await expect(page.locator('[data-hearing-view="day"]')).toBeVisible();
  await expect(page.locator('[data-hearing-view="month"]')).toBeVisible();
  await expect(page.locator('[data-action="print-hearings"]')).toHaveCount(0);
  await expect(page.locator(".mobile-print-hearings")).toHaveCount(0);
  await expect(page.locator(".hearing-arrow")).toHaveCount(0);

  await page.locator('.mobile-nav[data-route="deadlines"]').click();
  await expect(page.getByRole("heading", { name: "Süreli İşler" })).toBeVisible();
  await expect(page.locator("[data-deadline-filter]")).toHaveCount(2);
  const firstDeadline = page.locator("[data-deadline-id]").first();
  await expect(firstDeadline).toBeVisible();
  await expect(firstDeadline.locator(".record-file-label")).toBeVisible();
  await expect(firstDeadline.locator(".mobile-badge")).toContainText(/gün|Bugün|Tamamlandı/i);
  await firstDeadline.click();
  await expect(page.getByRole("heading", { name: "Süreli İş Detayı" })).toBeVisible();
  await expect(page.locator(".info-card")).toContainText("Kalan Süre");
  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page.getByRole("heading", { name: "Süreli İşler" })).toBeVisible();

  await page.locator('.mobile-nav[data-route="calendar"]').click();
  await expect(page.locator(".calendar-card")).toBeVisible();

  await page.locator('button[data-route="more"][aria-label="Menü"]').click();
  await expect(page.getByRole("heading", { name: "Diğer" })).toBeVisible();
  await expect(page.locator('.more-menu [data-route="settings"]')).toHaveCount(0);
  await expect(page.locator('.more-menu [data-action="refresh"]')).toContainText("Veri ve Senkronizasyon");
  const moreIconBox = await page.locator(".more-menu .list-icon").first().evaluate(element => {
    const box = element.getBoundingClientRect();
    const svg = element.querySelector("svg")?.getBoundingClientRect();
    return { boxWidth: box.width, boxHeight: box.height, svgWidth: svg?.width, svgHeight: svg?.height };
  });
  expect(moreIconBox).toEqual({ boxWidth: 42, boxHeight: 42, svgWidth: 24, svgHeight: 24 });
  await page.locator('.more-menu [data-action="refresh"]').click();
  await expect(page.locator("#mobileToast")).toContainText("Veriler yenileniyor");
  await expect(page.getByRole("heading", { name: "Diğer" })).toBeVisible();
  await page.locator('button[data-route="more"][aria-label="Menü"]').click();
  await expect(page.getByRole("heading", { name: "Takvim" })).toBeVisible();
  await page.locator('button[data-route="more"][aria-label="Menü"]').click();
  await page.locator('.more-menu [data-route="tasks"]').click();
  await expect(page.getByRole("heading", { name: "Görevler" })).toBeVisible();
  await expect(page.locator("[data-task-filter]")).toHaveCount(2);

  await page.getByRole("button", { name: "Geri" }).click();
  await page.locator('.more-menu [data-route="clients"]').click();
  await expect(page.getByRole("heading", { name: "Müvekkiller" })).toBeVisible();
  await expect(page.locator("#mobileClientSearch")).toBeVisible();
  await expect(page.locator(".mobile-list-card").first()).not.toContainText(/Telefon:\s*\d{11}/);
  const firstClient = page.locator("[data-client-id]").first();
  await expect(firstClient).toBeVisible();
  await firstClient.click();
  await expect(page.getByRole("heading", { name: "Müvekkil Kartı" })).toBeVisible();
  await expect(page.locator(".client-detail-hero")).toBeVisible();
  await expect(page.locator(".info-card")).toContainText(/TCKN|VKN/);
  const linkedClientFile = page.locator(".client-file-list [data-file-id]").first();
  await expect(linkedClientFile).toBeVisible();
  await linkedClientFile.click();
  await expect(page.locator(".file-hero")).toBeVisible();
  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page.locator(".client-detail-hero")).toBeVisible();

  await page.locator('.mobile-nav[data-route="home"]').click();
  await page.locator(".topbar-profile-button").click();
  await expect(page.locator(".profile-overview")).toBeVisible();
  await expect(page.locator(".profile-overview .profile-avatar")).toHaveCount(0);
  await expect(page.locator('.profile-logout-link[data-action="logout"]')).toContainText("Çıkış Yap");
  await expect(page.locator('.profile-settings-link[data-route="settings"]')).toHaveCount(0);
  const profileLogoutIcon = await page.locator(".profile-logout-link .list-icon").evaluate(element => {
    const box = element.getBoundingClientRect();
    const svg = element.querySelector("svg")?.getBoundingClientRect();
    return { boxWidth: box.width, boxHeight: box.height, svgWidth: svg?.width, svgHeight: svg?.height };
  });
  expect(profileLogoutIcon).toEqual({ boxWidth: 42, boxHeight: 42, svgWidth: 24, svgHeight: 24 });

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const nav = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
      const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navBottom: nav?.bottom,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index)
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs((layout.navBottom || 0) - viewport.height)).toBeLessThanOrEqual(1);
    expect(layout.duplicateIds).toEqual([]);
  }
  await expect(page.locator('button:has-text("Yeni Dosya"), button:has-text("Yeni Duruşma"), button:has-text("Yeni Görev")')).toHaveCount(0);
  diagnostics.assertClean();
});
