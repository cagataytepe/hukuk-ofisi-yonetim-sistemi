import { createClient } from "@supabase/supabase-js";

const config = window.BKT_SUPABASE_CONFIG;
const mobileSessionOnlyKey = "bkt.mobile.session-only";
const isMobileEntry = /(?:^|\/)mobile\.html$/i.test(window.location.pathname);

if (!config?.url || !config?.publishableKey) {
  throw new Error("Supabase bağlantı bilgileri eksik.");
}

const mobileAuthStorage = isMobileEntry
  ? {
      getItem(key) {
        const storage = sessionStorage.getItem(mobileSessionOnlyKey) === "true" ? sessionStorage : localStorage;
        return storage.getItem(key);
      },
      setItem(key, value) {
        const sessionOnly = sessionStorage.getItem(mobileSessionOnlyKey) === "true";
        const storage = sessionOnly ? sessionStorage : localStorage;
        const alternateStorage = sessionOnly ? localStorage : sessionStorage;
        alternateStorage.removeItem(key);
        storage.setItem(key, value);
      },
      removeItem(key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    }
  : undefined;

export function setMobileSessionPersistence(remember) {
  if (!isMobileEntry) return;
  if (remember) sessionStorage.removeItem(mobileSessionOnlyKey);
  else sessionStorage.setItem(mobileSessionOnlyKey, "true");
}

export const supabase = createClient(
  config.url,
  config.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(mobileAuthStorage ? { storage: mobileAuthStorage } : {})
    }
  }
);
