import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.test.local");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-artifacts/reports", open: "never" }],
    ["json", { outputFile: "test-artifacts/reports/results.json" }]
  ],
  outputDir: "test-artifacts/results",
  use: {
    baseURL: "http://127.0.0.1:5173/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    acceptDownloads: true
  },
  webServer: {
    command: "npm.cmd run dev",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /.*\.mobile\.spec\.(js|ts)/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "msedge",
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "mobile",
      testMatch: /.*\.mobile\.spec\.(js|ts)/,
      use: {
        ...devices["Pixel 5"],
        channel: "msedge",
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
