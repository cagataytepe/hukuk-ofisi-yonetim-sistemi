import assert from "node:assert/strict";
import test from "node:test";
import {
  createMobileAuthStorage,
  getRememberSessionPreference,
  setRememberSessionPreference
} from "../../src/mobile/session-persistence.mjs";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test("remembered Supabase session survives a simulated Android cold start", () => {
  const localStorage = memoryStorage();
  const firstSessionStorage = memoryStorage();
  setRememberSessionPreference(true, { localStorage, sessionStorage: firstSessionStorage });
  const firstProcess = createMobileAuthStorage({ localStorage, sessionStorage: firstSessionStorage });
  firstProcess.setItem("sb-project-auth-token", "supabase-managed-session");

  const secondProcess = createMobileAuthStorage({ localStorage, sessionStorage: memoryStorage() });
  assert.equal(secondProcess.getItem("sb-project-auth-token"), "supabase-managed-session");
  secondProcess.setItem("sb-project-auth-token", "refreshed-supabase-session");
  assert.equal(localStorage.getItem("sb-project-auth-token"), "refreshed-supabase-session");
});

test("session-only login disappears after process death and explicit logout clears both stores", () => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  setRememberSessionPreference(false, { localStorage, sessionStorage });
  const firstProcess = createMobileAuthStorage({ localStorage, sessionStorage });
  firstProcess.setItem("sb-project-auth-token", "temporary-session");
  assert.equal(getRememberSessionPreference({ localStorage, sessionStorage }), false);
  assert.equal(localStorage.getItem("sb-project-auth-token"), null);

  const afterProcessDeath = createMobileAuthStorage({ localStorage, sessionStorage: memoryStorage() });
  assert.equal(afterProcessDeath.getItem("sb-project-auth-token"), null);

  setRememberSessionPreference(true, { localStorage, sessionStorage });
  const remembered = createMobileAuthStorage({ localStorage, sessionStorage });
  remembered.setItem("sb-project-auth-token", "remembered-session");
  remembered.removeItem("sb-project-auth-token");
  assert.equal(localStorage.getItem("sb-project-auth-token"), null);
  assert.equal(sessionStorage.getItem("sb-project-auth-token"), null);
});
