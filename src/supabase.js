import { createClient } from "@supabase/supabase-js";
import { createDesktopAuthController } from "./desktop/session-persistence.mjs";
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
const desktopBootstrap = window.BKT_WINDOWS_AUTH_BOOTSTRAP || {};
const desktopTauriRuntime = !isMobileEntry && desktopBootstrap.isWindowsTauri === true;
const desktopLogonSessionId = String(desktopBootstrap.logonSessionId || "").trim();
const desktopLogonSessionError = String(desktopBootstrap.error || "").trim();

const desktopAuthController = desktopTauriRuntime
  ? createDesktopAuthController({ logonSessionId: desktopLogonSessionId })
  : null;

export function setMobileSessionPersistence(remember) {
  if (!isMobileEntry) return;
  setRememberSessionPreference(Boolean(remember));
}

export function getMobileSessionPersistence() {
  return !isMobileEntry || getRememberSessionPreference();
}

export function beginDesktopSignIn(remember) {
  desktopAuthController?.beginSignIn(Boolean(remember));
}

export function completeDesktopSignIn(email) {
  desktopAuthController?.completeSignIn(email);
}

export function cancelDesktopSignIn() {
  desktopAuthController?.cancelSignIn();
}

export function clearDesktopAutomaticSignIn() {
  desktopAuthController?.clearAutomaticSignIn();
}

export function getDesktopLoginPreferences() {
  return desktopAuthController?.getPreferences() || { lastEmail: "", remember: false };
}

export function getDesktopSessionStatus() {
  const status = desktopAuthController?.getStatus() || {
    hasTrustedLogonSession: false,
    canRestoreSession: false
  };
  return {
    ...status,
    isTauriRuntime: desktopTauriRuntime,
    error: desktopLogonSessionError
  };
}

export const supabase = createClient(
  config.url,
  config.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !isMobileEntry,
      ...(mobileAuthStorage
        ? { storage: mobileAuthStorage }
        : desktopAuthController
          ? { storage: desktopAuthController.storage }
          : {})
    }
  }
);
