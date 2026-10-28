export const DESKTOP_LAST_EMAIL_KEY = "bkt.desktop.last-successful-email";
export const DESKTOP_REMEMBER_PREFERENCE_KEY = "bkt.desktop.remember-session";
export const DESKTOP_LOGON_SESSION_KEY = "bkt.desktop.authorized-logon-session";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function usableStorage(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function"
    ? storage
    : memoryStorage();
}

function normalizeLogonSessionId(value) {
  return String(value || "").trim();
}

function isSupabaseAuthKey(key) {
  return /^sb-.+-auth-token(?:\.\d+)?$/i.test(String(key || ""));
}

function storageKeys(storage) {
  const keys = [];
  for (let index = 0; index < Number(storage.length || 0); index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

export function createDesktopAuthController({ localStorage, logonSessionId } = {}) {
  const local = usableStorage(localStorage || globalThis.localStorage);
  const volatile = memoryStorage();
  const currentLogonSessionId = normalizeLogonSessionId(logonSessionId);
  const knownAuthKeys = new Set(storageKeys(local).filter(isSupabaseAuthKey));
  let pendingRemember = null;

  function storedRememberPreference() {
    return local.getItem(DESKTOP_REMEMBER_PREFERENCE_KEY) === "true";
  }

  function storedLogonSessionId() {
    return normalizeLogonSessionId(local.getItem(DESKTOP_LOGON_SESSION_KEY));
  }

  function persistentSessionAllowed() {
    return Boolean(
      storedRememberPreference()
      && currentLogonSessionId
      && storedLogonSessionId() === currentLogonSessionId
    );
  }

  function removePersistentAuthTokens() {
    storageKeys(local).filter(isSupabaseAuthKey).forEach(key => local.removeItem(key));
  }

  function clearAuthTokens() {
    knownAuthKeys.forEach(key => {
      local.removeItem(key);
      volatile.removeItem(key);
    });
    removePersistentAuthTokens();
  }

  if (!persistentSessionAllowed()) {
    removePersistentAuthTokens();
    local.removeItem(DESKTOP_LOGON_SESSION_KEY);
  }

  const storage = {
    getItem(key) {
      knownAuthKeys.add(key);
      if (pendingRemember !== null) {
        return pendingRemember && currentLogonSessionId
          ? local.getItem(key)
          : volatile.getItem(key);
      }
      if (persistentSessionAllowed()) return local.getItem(key);
      local.removeItem(key);
      return volatile.getItem(key);
    },
    setItem(key, value) {
      knownAuthKeys.add(key);
      const remember = pendingRemember === null ? persistentSessionAllowed() : pendingRemember;
      if (remember && currentLogonSessionId) {
        volatile.removeItem(key);
        local.setItem(key, value);
      } else {
        local.removeItem(key);
        volatile.setItem(key, value);
      }
    },
    removeItem(key) {
      knownAuthKeys.add(key);
      local.removeItem(key);
      volatile.removeItem(key);
    }
  };

  return {
    storage,
    beginSignIn(remember) {
      pendingRemember = Boolean(remember);
      clearAuthTokens();
    },
    completeSignIn(email) {
      const remember = pendingRemember === true;
      const normalizedEmail = String(email || "").trim().toLocaleLowerCase("tr-TR");
      local.setItem(DESKTOP_REMEMBER_PREFERENCE_KEY, remember ? "true" : "false");
      if (normalizedEmail) local.setItem(DESKTOP_LAST_EMAIL_KEY, normalizedEmail);
      if (remember && currentLogonSessionId) {
        local.setItem(DESKTOP_LOGON_SESSION_KEY, currentLogonSessionId);
        knownAuthKeys.forEach(key => {
          const value = volatile.getItem(key);
          if (value !== null) {
            local.setItem(key, value);
            volatile.removeItem(key);
          }
        });
      } else {
        local.removeItem(DESKTOP_LOGON_SESSION_KEY);
      }
      pendingRemember = null;
    },
    cancelSignIn() {
      clearAuthTokens();
      local.removeItem(DESKTOP_LOGON_SESSION_KEY);
      pendingRemember = null;
    },
    clearAutomaticSignIn() {
      clearAuthTokens();
      local.removeItem(DESKTOP_LOGON_SESSION_KEY);
      pendingRemember = null;
    },
    getPreferences() {
      return {
        lastEmail: String(local.getItem(DESKTOP_LAST_EMAIL_KEY) || "").trim(),
        remember: storedRememberPreference()
      };
    },
    getStatus() {
      return {
        hasTrustedLogonSession: Boolean(currentLogonSessionId),
        canRestoreSession: persistentSessionAllowed()
      };
    }
  };
}
