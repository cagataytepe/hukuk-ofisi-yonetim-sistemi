import { expect } from "@playwright/test";
import { e2eCredentials } from "./env.js";

export function attachDiagnostics(page, { ignoreExpectedAuthFailures = false, ignoreExpectedLegacyIdRetries = false, ignoreFetchAbortNoise = false } = {}) {
  const events = [];
  page.on("console", message => {
    if (message.type() === "error") {
      const text = message.text();
      if (ignoreExpectedAuthFailures && text.includes("Supabase Auth")) return;
      if (ignoreExpectedLegacyIdRetries && text.includes("server responded with a status of 409")) return;
      if (ignoreFetchAbortNoise && text.includes("Failed to fetch")) return;
      events.push({ type: "console.error", text });
    }
  });
  page.on("pageerror", error => {
    events.push({ type: "pageerror", text: error.message });
  });
  page.on("requestfailed", request => {
    const text = request.failure()?.errorText || "";
    if (ignoreFetchAbortNoise && text === "net::ERR_ABORTED") return;
    events.push({ type: "requestfailed", url: sanitizeUrl(request.url()), text });
  });
  page.on("response", response => {
    const status = response.status();
    if (status >= 400) {
      const url = response.url();
      const expectedAuthFailure = url.includes("/auth/v1/token") && status === 400;
      const expectedLegacyIdRetry = ignoreExpectedLegacyIdRetries && status === 409 && url.includes("/rest/v1/files");
      if (!expectedAuthFailure && !expectedLegacyIdRetry) events.push({ type: "http", status, url: sanitizeUrl(url) });
    }
  });
  return {
    events,
    mark() {
      return events.length;
    },
    assertClean() {
      let from = 0;
      let to = events.length;
      if (arguments[0] && typeof arguments[0] === "object") {
        from = arguments[0].from ?? from;
        to = arguments[0].to ?? to;
      }
      const scopedEvents = events.slice(from, to);
      expect(scopedEvents, JSON.stringify(scopedEvents, null, 2)).toEqual([]);
    }
  };
}

function sanitizeUrl(url) {
  return String(url || "").replace(/access_token=[^&]+/g, "access_token=[redacted]").replace(/apikey=[^&]+/g, "apikey=[redacted]");
}

export async function login(page) {
  const { email, password } = e2eCredentials();
  await page.goto("/");
  await expect(page.locator("#loginEmail")).toBeVisible();
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", password);
  await page.locator("#loginForm button[type='submit']").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/, { timeout: 30_000 });
  await expect(page.locator("#pageTitle")).toBeVisible();
}

export async function logout(page) {
  page.once("dialog", dialog => dialog.accept().catch(() => {}));
  await page.locator("#logoutButton").click();
  await expect(page.locator("#loginEmail")).toBeVisible();
}

export async function gotoSection(page, sectionId, { timeout = 15_000, soft = false } = {}) {
  if (!page || page.isClosed()) {
    const message = `Sayfa kapalı olduğu için ${sectionId} bölümüne geçilemedi.`;
    if (soft) {
      console.warn(message);
      return false;
    }
    throw new Error(message);
  }
  const section = page.locator(`section#${sectionId}`);
  const isAlreadyActive = await section.evaluate(element => element.classList.contains("active")).catch(() => false);
  if (isAlreadyActive) return true;

  const button = page.locator(`[data-section="${sectionId}"]`).first();
  const hasButton = await button.count().catch(() => 0);
  if (!hasButton) {
    const message = `${sectionId} bölüm butonu bulunamadı.`;
    if (soft) {
      console.warn(message);
      return false;
    }
    throw new Error(message);
  }

  try {
    await button.waitFor({ state: "visible", timeout });
    await button.click({ timeout });
    await expect(section).toHaveClass(/active/, { timeout });
    return true;
  } catch (error) {
    if (!soft) throw error;
    console.warn("E2E section navigation skipped.", safeErrorSummary(error));
    return false;
  }
}

export async function expectNoVisibleUuid(page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
}

export async function selectFirstOption(page, selector) {
  await page.waitForFunction(sel => {
    const select = document.querySelector(sel);
    return select && [...select.options].some(option => option.value.trim());
  }, selector);
  const value = await page.$eval(selector, select => {
    const option = [...select.options].find(item => item.value.trim());
    return option?.value || "";
  });
  await page.selectOption(selector, value);
  return value;
}

export async function fillDatalistByPrefix(page, inputSelector, listSelector, prefix) {
  await page.locator(inputSelector).fill(prefix);
  await page.waitForFunction(({ listSelector: list, prefix: value }) => {
    const element = document.querySelector(list);
    return element && [...element.options].some(option => option.value.includes(value));
  }, { listSelector, prefix });
  const optionValue = await page.$eval(listSelector, (list, value) => {
    const option = [...list.options].find(item => item.value.includes(value));
    return option?.value || "";
  }, prefix);
  await page.locator(inputSelector).fill(optionValue);
  await page.locator(inputSelector).dispatchEvent("input");
  await page.locator(inputSelector).dispatchEvent("change");
  return optionValue;
}

export async function clickRowActionByText(page, rowContainerSelector, rowText, actionSelector, { confirm = false } = {}) {
  const row = page.locator(rowContainerSelector).filter({ hasText: rowText }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  if (confirm) page.once("dialog", dialog => dialog.accept().catch(() => {}));
  await row.locator(actionSelector).first().click();
}

export async function createLawsuitFile(page, prefix) {
  await gotoSection(page, "cases");
  await page.locator("#openNewFileForm").click();
  await page.locator('[data-file-type-card="Hukuk Dosyası"]').click();
  await expect(page.locator("#caseCourt")).toBeVisible();
  await page.fill("#caseCourt", `${prefix} İstanbul Test Mahkemesi`);
  await page.fill("#caseFileNo", `${prefix}/1 E.`);
  await page.fill("#caseOpenDate", todayIso());
  await page.fill("#caseSubject", `${prefix} test konusu`);
  await selectFirstOption(page, "#caseLawyer");
  if (await page.locator("#caseStatus option").count()) await page.selectOption("#caseStatus", { label: "Açık" }).catch(() => {});
  await page.locator("#caseStepNext").click();
  await expect(page.locator("#lawClientPartyRows .law-party-name").first()).toBeVisible();
  await page.locator("#lawClientPartyRows .law-party-name").first().fill(`${prefix} Müvekkil`);
  await page.locator("#lawClientPartyRows .party-represented").first().check();
  await page.locator("#lawOpponentPartyRows .law-party-name").first().fill(`${prefix} Karşı Taraf`);
  await page.locator("#caseStepNext").click();
  await page.locator("#caseSubmit").click();
  await expect(page.locator("#caseRows")).toContainText(prefix, { timeout: 30_000 });
}

export async function openFileDetailByPrefix(page, prefix) {
  await gotoSection(page, "cases");
  await page.fill("#fileListSearch", prefix);
  await expect(page.locator("#caseRows")).toContainText(prefix, { timeout: 15_000 });
  await page.locator("#caseRows [data-view-file]").first().click();
  await expect(page.locator("#fileDetailPanel")).toBeVisible();
}

export async function deleteFileByPrefix(page, prefix, { timeout = 15_000 } = {}) {
  if (!page || page.isClosed()) {
    console.warn("E2E cleanup skipped because the page is closed.", { prefix });
    return false;
  }
  try {
    const navigated = await gotoSection(page, "cases", { timeout, soft: true });
    if (!navigated || page.isClosed()) return false;
    await page.fill("#fileListSearch", prefix, { timeout });
    const row = page.locator("#caseRows tr").filter({ hasText: prefix }).first();
    const rowVisible = await row.isVisible({ timeout: Math.min(timeout, 5_000) }).catch(() => false);
    if (!rowVisible) {
      console.warn("E2E cleanup skipped; prefix row was not found.", { prefix });
      return false;
    }
    page.once("dialog", dialog => dialog.accept().catch(() => {}));
    await row.locator("[data-delete-case]").click({ timeout });
    await expect(row).toHaveCount(0, { timeout }).catch(() => {});
    return true;
  } catch (error) {
    console.error("E2E cleanup failed", safeErrorSummary(error));
    return false;
  }
}

export function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function safeErrorSummary(error) {
  return {
    name: error?.name,
    message: String(error?.message || error || "").slice(0, 500)
  };
}
