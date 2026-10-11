import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeGeneratedFilename } from "../../src/platform/generatedFileSaver.js";
import { datedReportFilename, formatFilenameDate } from "../../src/shared/reportFilename.mjs";

test("rapor tarihleri Windows dosya adına uygun biçimde üretilir", () => {
  assert.equal(formatFilenameDate("2026-10-12"), "12.10.2026");
  assert.equal(formatFilenameDate("2026-02-29"), "");
  assert.equal(
    datedReportFilename("2026-10-12", "2026-10-16", "Duruşma Listesi", "pdf"),
    "12.10.2026 - 16.10.2026 Duruşma Listesi.pdf"
  );
});

test("kaydetme katmanı Windows için yasaklı karakterleri ve aygıt adlarını temizler", () => {
  assert.equal(
    sanitizeGeneratedFilename('12/10/2026: Duruşma <Listesi>?*.pdf'),
    "12_10_2026_ Duruşma _Listesi___.pdf"
  );
  assert.equal(sanitizeGeneratedFilename("CON.pdf"), "_CON.pdf");
  assert.equal(sanitizeGeneratedFilename("rapor. "), "rapor");
});
