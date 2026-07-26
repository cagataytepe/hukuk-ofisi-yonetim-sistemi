import fs from "node:fs";
import path from "node:path";

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.test.local");

export function e2eCredentials() {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL ve E2E_USER_PASSWORD .env.test.local veya environment içinde tanımlı olmalıdır.");
  }
  return { email, password };
}

export function e2ePrefix(label = "RUN") {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `E2E-${stamp}-${label}`;
}
