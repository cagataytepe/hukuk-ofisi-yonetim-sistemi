import { createClient } from "@supabase/supabase-js";
import {
  createMobileAuthStorage,
  getRememberSessionPreference,
  setRememberSessionPreference
} from "./mobile/session-persistence.mjs";

const config = window.BKT_SUPABASE_CONFIG;
const isMobileEntry = /(?:^|\/)mobile\.html$/i.test(window.location.pathname)
  || Boolean(document.querySelector("#mobileApp"));

if (!config?.url || !config?.publishableKey) {
  throw new Error("Supabase bağlantı bilgileri eksik.");
}

const mobileAuthStorage = isMobileEntry ? createMobileAuthStorage() : undefined;

export function setMobileSessionPersistence(remember) {
  if (!isMobileEntry) return;
  setRememberSessionPreference(Boolean(remember));
}

export function getMobileSessionPersistence() {
  return !isMobileEntry || getRememberSessionPreference();
}

export const supabase = createClient(
  config.url,
  config.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !isMobileEntry,
      ...(mobileAuthStorage ? { storage: mobileAuthStorage } : {})
    }
  }
);
