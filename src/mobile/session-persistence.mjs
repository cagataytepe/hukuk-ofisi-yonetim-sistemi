export const MOBILE_REMEMBER_PREFERENCE_KEY = "bkt.mobile.remember-session";
export const LEGACY_SESSION_ONLY_KEY = "bkt.mobile.session-only";

function storages(overrides = {}) {
  return {
    local: overrides.localStorage || globalThis.localStorage,
    session: overrides.sessionStorage || globalThis.sessionStorage
  };
}

export function getRememberSessionPreference(overrides = {}) {
  const { local, session } = storages(overrides);
  const value = local.getItem(MOBILE_REMEMBER_PREFERENCE_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return session.getItem(LEGACY_SESSION_ONLY_KEY) !== "true";
}

export function setRememberSessionPreference(remember, overrides = {}) {
  const { local, session } = storages(overrides);
  local.setItem(MOBILE_REMEMBER_PREFERENCE_KEY, remember ? "true" : "false");
  if (remember) session.removeItem(LEGACY_SESSION_ONLY_KEY);
  else session.setItem(LEGACY_SESSION_ONLY_KEY, "true");
}

export function createMobileAuthStorage(overrides = {}) {
  const { local, session } = storages(overrides);
  return {
    getItem(key) {
      if (!getRememberSessionPreference({ localStorage: local, sessionStorage: session })) {
        return session.getItem(key);
      }
      const persisted = local.getItem(key);
      if (persisted !== null) return persisted;
      const legacySession = session.getItem(key);
      if (legacySession !== null) {
        local.setItem(key, legacySession);
        session.removeItem(key);
      }
      return legacySession;
    },
    setItem(key, value) {
      const remember = getRememberSessionPreference({ localStorage: local, sessionStorage: session });
      const selected = remember ? local : session;
      const alternate = remember ? session : local;
      alternate.removeItem(key);
      selected.setItem(key, value);
    },
    removeItem(key) {
      local.removeItem(key);
      session.removeItem(key);
    }
  };
}
