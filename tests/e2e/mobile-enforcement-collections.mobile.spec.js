import { expect, test } from "@playwright/test";

import {
  accountDateInTimeZone,
  buildEnforcementAccountFile,
  calculateMobileEnforcementAccount
} from "../../src/calculations/enforcementAccountAdapters.js";
import {
  I1004_CALCULATION_TOOLS,
  I1004_MOBILE_FILE
} from "../fixtures/enforcement/i-1004.js";
import { attachDiagnostics } from "./support/app.js";
import { e2eCredentials } from "./support/env.js";

const FILE_15K = "11111111-1111-4111-8111-111111111111";
const FILE_50K = "22222222-2222-4222-8222-222222222222";

function fileFixture(id, displayId, fileNo) {
  return {
    ...I1004_MOBILE_FILE,
    id,
    display_id: displayId,
    legacy_id: displayId,
    file_no: fileNo,
    court_or_office: "İstanbul Test İcra Dairesi",
    client_name: `${displayId} Test Alacaklısı`,
    status: "Açık",
    created_at: "2026-09-01T10:00:00Z",
    deleted_at: null,
    account_info: { ...I1004_MOBILE_FILE.account_info }
  };
}

function collectionFixture(id, fileId, amount) {
  return {
    id,
    legacy_id: null,
    file_id: fileId,
    payment_plan_id: null,
    payment_installment_id: null,
    amount,
    currency: "TRY",
    collection_date: "2026-07-20",
    payment_kind: "collection",
    description: "Mobil liste hydration testi",
    metadata: {},
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    deleted_at: null
  };
}

function calculationToolRows() {
  return {
    interest_rates: I1004_CALCULATION_TOOLS.interestRates.map((row, index) => ({
      id: `interest-${index}`,
      legacy_id: null,
      interest_type: row.type,
      from_date: row.from,
      to_date: row.to || null,
      rate: row.rate,
      source: row.source,
      is_active: row.active,
      description: null,
      metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
      created_by_profile: null,
      updated_by_profile: null
    })),
    attorney_fee_tariffs: I1004_CALCULATION_TOOLS.attorneyFeeTariffs.map((row, index) => ({
      id: `tariff-${index}`,
      legacy_id: null,
      name: row.name,
      tariff_year: row.year,
      scope: row.scope,
      from_date: row.from,
      to_date: row.to || null,
      regular_minimum: row.regularMinimum,
      eviction_minimum: row.evictionMinimum,
      maximum_amount: row.maximumAmount,
      is_active: row.active,
      description: null,
      metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
      created_by_profile: null,
      updated_by_profile: null,
      attorney_fee_brackets: row.brackets.map((bracket, bracketIndex) => ({
        id: `bracket-${index}-${bracketIndex}`,
        sequence_no: bracketIndex + 1,
        limit_amount: bracket.limit,
        rate: bracket.rate,
        is_active: true,
        metadata: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        deleted_at: null
      }))
    })),
    calculation_parameters: I1004_CALCULATION_TOOLS.parameters.map((row, index) => ({
      id: `parameter-${index}`,
      parameter_group: "enforcement",
      parameter_key: row.key,
      label: row.key,
      numeric_value: row.value,
      text_value: null,
      unit: null,
      from_date: null,
      to_date: null,
      is_active: row.active,
      description: null,
      metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
      created_by_profile: null,
      updated_by_profile: null
    }))
  };
}

async function fulfillJson(route, rows) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" },
    body: JSON.stringify(rows)
  });
}

test("mobil icra listesi batch collections hydration sonrasında filtre ve detayda aynı hesabı korur", async ({ page }) => {
  test.setTimeout(120_000);
  const diagnostics = attachDiagnostics(page);
  const { email, password } = e2eCredentials();

  await page.goto("/mobile.html");
  await page.locator("#mobileEmail").fill(email);
  await page.locator("#mobilePassword").fill(password);
  await page.locator("#mobileLoginButton").click();
  await expect(page.locator(".mobile-shell")).toBeVisible({ timeout: 30_000 });

  const files = [
    fileFixture(FILE_15K, "İ-1007", "2026/1007"),
    fileFixture(FILE_50K, "İ-1006", "2026/1006")
  ];
  const collections = [
    collectionFixture("collection-15k", FILE_15K, 15_000),
    collectionFixture("collection-50k", FILE_50K, 50_000)
  ];
  const tools = calculationToolRows();
  const batchCollectionRequests = [];

  await page.route("**/rest/v1/files?**", async route => {
    const idFilter = new URL(route.request().url()).searchParams.get("id") || "";
    const rows = idFilter.startsWith("eq.")
      ? files.filter(file => file.id === idFilter.slice(3))
      : files;
    await fulfillJson(route, rows);
  });
  await page.route("**/rest/v1/file_parties?**", route => fulfillJson(route, []));
  await page.route("**/rest/v1/collections?**", async route => {
    const url = new URL(route.request().url());
    const fileFilter = url.searchParams.get("file_id") || "";
    if (fileFilter.startsWith("in.")) batchCollectionRequests.push(url);
    const selectedIds = fileFilter.startsWith("eq.")
      ? [fileFilter.slice(3)]
      : fileFilter.startsWith("in.(")
        ? fileFilter.slice(4, -1).split(",")
        : [];
    await fulfillJson(route, collections.filter(row => selectedIds.includes(row.file_id)));
  });
  await page.route("**/rest/v1/interest_rates?**", route => fulfillJson(route, tools.interest_rates));
  await page.route("**/rest/v1/attorney_fee_tariffs?**", route => fulfillJson(route, tools.attorney_fee_tariffs));
  await page.route("**/rest/v1/calculation_parameters?**", route => fulfillJson(route, tools.calculation_parameters));
  for (const table of ["payment_plans", "file_notes", "timeline_events"]) {
    await page.route(`**/rest/v1/${table}?**`, route => fulfillJson(route, []));
  }

  await page.locator('.mobile-nav[data-route="files"]').click();
  await expect(page.locator("[data-file-id]")).toHaveCount(2);
  await page.locator('[data-file-filter="enforcement"]').click();

  expect(batchCollectionRequests).toHaveLength(1);
  expect(batchCollectionRequests[0].searchParams.get("deleted_at")).toBe("is.null");
  const batchFilter = batchCollectionRequests[0].searchParams.get("file_id") || "";
  expect(batchFilter).toContain(FILE_15K);
  expect(batchFilter).toContain(FILE_50K);

  for (const fixture of [
    { file: files[0], collection: collections[0] },
    { file: files[1], collection: collections[1] }
  ]) {
    const expectedAccount = calculateMobileEnforcementAccount(
      buildEnforcementAccountFile(fixture.file, [fixture.collection]),
      I1004_CALCULATION_TOOLS,
      accountDateInTimeZone()
    );
    const expectedText = new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2
    }).format(expectedAccount.currentDebt);

    await page.locator("#mobileFileSearch").fill(fixture.file.display_id);
    const card = page.locator(`[data-file-id="${fixture.file.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator(".file-card-account")).toContainText(expectedText);
    await card.click();
    await page.locator('[data-detail-tab="account"]').click();
    await expect(page.locator(".enforcement-account-total strong")).toHaveText(expectedText);
    await page.getByRole("button", { name: "Geri" }).click();
    await expect(page.locator("#mobileFileSearch")).toBeVisible();
  }

  expect(batchCollectionRequests).toHaveLength(1);
  diagnostics.assertClean();
});
