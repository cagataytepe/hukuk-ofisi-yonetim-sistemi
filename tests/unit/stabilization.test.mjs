import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllSupabaseRows } from "../../src/calculations/calculationTools.js";
import {
  DESKTOP_LAST_EMAIL_KEY,
  DESKTOP_LOGON_SESSION_KEY,
  DESKTOP_REMEMBER_PREFERENCE_KEY,
  createDesktopAuthController
} from "../../src/desktop/session-persistence.mjs";
import {
  createMobileAuthStorage,
  setRememberSessionPreference
} from "../../src/mobile/session-persistence.mjs";
import { daysUntilLocalDate, localIsoDate } from "../../src/shared/localDate.mjs";
import { collectPaginatedRows } from "../../src/shared/repositoryPagination.mjs";
import { isValidIsoDate, parseTurkishMoney } from "../../src/shared/userInput.mjs";

const AUTH_KEY = "sb-project-auth-token";
const LOGON_A = "00000000:0000a001";
const LOGON_B = "00000000:0000b002";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    entries() { return [...values.entries()]; }
  };
}

function supabasePages(total) {
  const rows = Array.from({ length: total }, (_, id) => ({ id }));
  return () => ({
    range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null })
  });
}

test("Supabase sayfalama 1001 kaydın tamamını döndürür", async () => {
  const rows = await fetchAllSupabaseRows(supabasePages(1001));
  assert.equal(rows.length, 1001);
  assert.deepEqual(rows.map(row => row.id), Array.from({ length: 1001 }, (_, id) => id));
});

test("REST sayfalama 1500 kaydın tamamını ve sırasını korur", async () => {
  const source = Array.from({ length: 1500 }, (_, id) => ({ id }));
  const ranges = [];
  const rows = await collectPaginatedRows(async (from, to) => {
    ranges.push([from, to]);
    return source.slice(from, to + 1);
  });

  assert.equal(rows.length, 1500);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(rows[1499].id, 1499);
});

test("yerel gün hesabı uygulama yeniden açılmadan gece yarısında ilerler", () => {
  const beforeMidnight = new Date(2026, 8, 17, 23, 59, 0);
  const afterMidnight = new Date(2026, 8, 18, 0, 1, 0);

  assert.equal(localIsoDate(beforeMidnight), "2026-09-17");
  assert.equal(localIsoDate(afterMidnight), "2026-09-18");
  assert.equal(daysUntilLocalDate("2026-09-18", beforeMidnight), 1);
  assert.equal(daysUntilLocalDate("2026-09-18", afterMidnight), 0);
});

test("Türkçe ve makine para biçimleri ortak parser ile okunur", () => {
  const cases = new Map([
    ["1", 1],
    ["1,50", 1.5],
    ["1.250", 1250],
    ["1.250,50", 1250.5],
    ["12.345.678,90", 12345678.9],
    ["1250.50", 1250.5],
    ["1 250,50", 1250.5],
    ["₺1.250,50", 1250.5]
  ]);

  cases.forEach((expected, input) => assert.equal(parseTurkishMoney(input), expected, input));
  ["", "abc", "1.2.3,45", "1,2,3", "12.34.567,89", "1.250,500"].forEach(input => {
    assert.equal(parseTurkishMoney(input), null, input);
  });
});

test("ödeme tarihi yalnız gerçek YYYY-MM-DD tarihi ise kabul edilir", () => {
  assert.equal(isValidIsoDate("2026-10-11"), true);
  assert.equal(isValidIsoDate("2024-02-29"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("11.10.2026"), false);
  assert.equal(isValidIsoDate("2026-1-01"), false);
});

test("Beni Hatırla açıkken aynı Windows logon oturumunda Supabase oturumu geri yüklenir", () => {
  const local = memoryStorage();
  const first = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  first.beginSignIn(true);
  first.storage.setItem(AUTH_KEY, "remembered-session");
  assert.equal(first.storage.getItem(AUTH_KEY), "remembered-session");
  first.completeSignIn("Avukat@BKT.Test");

  const reopened = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  assert.equal(reopened.storage.getItem(AUTH_KEY), "remembered-session");
  assert.equal(reopened.getStatus().canRestoreSession, true);
  assert.deepEqual(reopened.getPreferences(), { lastEmail: "avukat@bkt.test", remember: true });
});

test("Beni Hatırla kapalıyken aynı Windows logon oturumunda uygulama yeniden açılışı şifre ister", () => {
  const local = memoryStorage();
  const first = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  first.beginSignIn(false);
  first.storage.setItem(AUTH_KEY, "process-only-session");
  assert.equal(first.storage.getItem(AUTH_KEY), "process-only-session");
  first.completeSignIn("avukat@bkt.test");
  assert.equal(first.storage.getItem(AUTH_KEY), "process-only-session");

  const reopened = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  assert.equal(reopened.storage.getItem(AUTH_KEY), null);
  assert.deepEqual(reopened.getPreferences(), { lastEmail: "avukat@bkt.test", remember: false });
});

test("Beni Hatırla açık olsa da farklı Windows logon oturumunda otomatik giriş engellenir", () => {
  const local = memoryStorage();
  const first = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  first.beginSignIn(true);
  first.storage.setItem(AUTH_KEY, "old-windows-session");
  first.completeSignIn("avukat@bkt.test");

  const afterWindowsRestart = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_B });
  assert.equal(afterWindowsRestart.storage.getItem(AUTH_KEY), null);
  assert.equal(local.getItem(DESKTOP_LOGON_SESSION_KEY), null);
  assert.deepEqual(afterWindowsRestart.getPreferences(), { lastEmail: "avukat@bkt.test", remember: true });
});

test("Beni Hatırla kapalı ve Windows logon oturumu farklıysa her durumda şifre istenir", () => {
  const local = memoryStorage();
  const first = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  first.beginSignIn(false);
  first.storage.setItem(AUTH_KEY, "temporary-session");
  first.completeSignIn("avukat@bkt.test");

  const reopened = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_B });
  assert.equal(reopened.storage.getItem(AUTH_KEY), null);
  assert.equal(reopened.getPreferences().remember, false);
});

for (const remember of [true, false]) {
  test(`Çıkış Yap otomatik girişi temizler ve Beni Hatırla=${remember} tercihini korur`, () => {
    const local = memoryStorage();
    const controller = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
    controller.beginSignIn(remember);
    controller.storage.setItem(AUTH_KEY, "active-session");
    controller.completeSignIn("avukat@bkt.test");
    controller.clearAutomaticSignIn();

    const reopened = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
    assert.equal(reopened.storage.getItem(AUTH_KEY), null);
    assert.deepEqual(reopened.getPreferences(), { lastEmail: "avukat@bkt.test", remember });
  });
}

test("başarısız giriş otomatik giriş yetkisi oluşturmaz ve son başarılı e-postayı bozmaz", () => {
  const local = memoryStorage({
    [DESKTOP_LAST_EMAIL_KEY]: "onceki@bkt.test",
    [DESKTOP_REMEMBER_PREFERENCE_KEY]: "true"
  });
  const controller = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  controller.beginSignIn(true);
  controller.storage.setItem(AUTH_KEY, "incomplete-login-session");
  controller.cancelSignIn();

  assert.equal(controller.storage.getItem(AUTH_KEY), null);
  assert.equal(local.getItem(DESKTOP_LOGON_SESSION_KEY), null);
  assert.deepEqual(controller.getPreferences(), { lastEmail: "onceki@bkt.test", remember: true });
});

test("eski sürümden kalan Supabase tokenı Windows logon doğrulaması olmadan açılmaz", () => {
  const local = memoryStorage({
    [AUTH_KEY]: "legacy-session",
    [DESKTOP_REMEMBER_PREFERENCE_KEY]: "true",
    [DESKTOP_LAST_EMAIL_KEY]: "avukat@bkt.test"
  });
  const controller = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });

  assert.equal(controller.storage.getItem(AUTH_KEY), null);
  assert.equal(local.getItem(AUTH_KEY), null);
  assert.equal(controller.getPreferences().lastEmail, "avukat@bkt.test");
});

test("masaüstü giriş tercihleri hiçbir koşulda şifre saklamaz", () => {
  const local = memoryStorage();
  const controller = createDesktopAuthController({ localStorage: local, logonSessionId: LOGON_A });
  controller.beginSignIn(true);
  controller.storage.setItem(AUTH_KEY, "opaque-supabase-session");
  controller.completeSignIn("avukat@bkt.test");

  const serialized = JSON.stringify(local.entries());
  assert.equal(serialized.includes("secret-password"), false);
  assert.equal(local.getItem(DESKTOP_LAST_EMAIL_KEY), "avukat@bkt.test");
});

test("mobil Beni Hatırla storage davranışı masaüstü katmanından etkilenmez", () => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  setRememberSessionPreference(true, { localStorage, sessionStorage });
  const mobileStorage = createMobileAuthStorage({ localStorage, sessionStorage });
  mobileStorage.setItem(AUTH_KEY, "mobile-session");

  assert.equal(localStorage.getItem(AUTH_KEY), "mobile-session");
  assert.equal(sessionStorage.getItem(AUTH_KEY), null);
});
