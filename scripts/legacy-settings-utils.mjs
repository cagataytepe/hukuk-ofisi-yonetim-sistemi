import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const legacySettingsKey = "hukukBurosuTakipDemo.v2";

export const businessStateKeys = [
  "files",
  "cases",
  "hearings",
  "deadlines",
  "tasks",
  "documents",
  "clients",
  "collections",
  "paymentPlans",
  "calculationSettings",
  "users",
  "migrations"
];

export const preferenceStateKeys = [
  "preferences",
  "ui",
  "theme",
  "filters",
  "pageSize",
  "view",
  "lastSection",
  "officeName"
];

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return { flags, values };
}

export function loadEnv(filePath = ".env") {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) return;
  const text = fs.readFileSync(absolute, "utf8");
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const [, key, rawValue] = match;
    if (process.env[key]) return;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  });
}

export function createAdminClient() {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY veya SUPABASE_ANON_KEY .env içinde bulunmalıdır.");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function readLegacySettings(supabase) {
  const { data, error } = await supabase
    .from("settings")
    .select("id,setting_key,setting_value,created_at,updated_at,deleted_at")
    .eq("setting_key", legacySettingsKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function writeLegacySettings(supabase, value) {
  const { data, error } = await supabase
    .from("settings")
    .upsert({
      setting_key: legacySettingsKey,
      setting_value: value,
      deleted_at: null,
      updated_at: new Date().toISOString()
    }, { onConflict: "setting_key" })
    .select("id,setting_key,updated_at")
    .single();
  if (error) throw error;
  return data;
}

export function estimateBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function collectLegacyStateStats(state = {}) {
  const files = Array.isArray(state.files) ? state.files : Array.isArray(state.cases) ? state.cases : [];
  const embeddedFileDocuments = files.reduce((sum, file) => {
    const metadata = file?.metadata && typeof file.metadata === "object" ? file.metadata : {};
    return sum
      + arrayCount(file?.documents)
      + arrayCount(metadata.documents)
      + arrayCount(file?.supportingDocuments)
      + arrayCount(metadata.supportingDocuments);
  }, 0);
  const base64Matches = JSON.stringify(state || {}).match(/data:[^"']+;base64,/g) || [];
  const presentBusinessKeys = businessStateKeys.filter(key => Object.prototype.hasOwnProperty.call(state, key));
  const presentPreferenceKeys = preferenceStateKeys.filter(key => Object.prototype.hasOwnProperty.call(state, key));
  const unexpectedKeys = Object.keys(state || {})
    .filter(key => !businessStateKeys.includes(key) && !preferenceStateKeys.includes(key));
  return {
    totalBytes: estimateBytes(state),
    totalMb: Number((estimateBytes(state) / 1024 / 1024).toFixed(3)),
    presentBusinessKeys,
    presentPreferenceKeys,
    unexpectedKeys,
    counts: {
      files: arrayCount(state.files || state.cases),
      cases: arrayCount(state.cases),
      hearings: arrayCount(state.hearings),
      deadlines: arrayCount(state.deadlines),
      tasks: arrayCount(state.tasks),
      clients: arrayCount(state.clients),
      collections: arrayCount(state.collections),
      paymentPlans: arrayCount(state.paymentPlans),
      documents: arrayCount(state.documents) + embeddedFileDocuments,
      base64Payloads: base64Matches.length
    }
  };
}

export function cleanLegacyState(state = {}) {
  const cleaned = {};
  for (const key of preferenceStateKeys) {
    if (Object.prototype.hasOwnProperty.call(state, key)) cleaned[key] = state[key];
  }
  for (const key of Object.keys(state)) {
    if (!businessStateKeys.includes(key) && !preferenceStateKeys.includes(key)) {
      cleaned[key] = state[key];
    }
  }
  return cleaned;
}

export function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
