import appHtml from "../outputs/hukuk-burosu-takip-sistemi.html?raw";
import bktLogoUrl from "../outputs/bkt-logo.png";
import appRuntimeUrl from "virtual:bkt-app-runtime-url";
import "../outputs/supabase-config.js";
import { desktopRuntime } from "./platform/generatedFileSaver.js";
import * as enforcementCalculator from "./calculations/enforcementCalculator.js";
import * as enforcementAccountAdapters from "./calculations/enforcementAccountAdapters.js";

window.BKT_DESKTOP_RUNTIME = desktopRuntime;
window.BKT_ENFORCEMENT_CALCULATOR = enforcementCalculator;
window.BKT_ENFORCEMENT_ACCOUNT_ADAPTERS = enforcementAccountAdapters;

const assetMap = new Map([
  ["bkt-logo.png", bktLogoUrl]
]);

function resolveAppAsset(value) {
  if (!value) return value;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return value;
  return assetMap.get(value) || `/outputs/${value.replace(/^\.?\//, "")}`;
}

function copyHeadAssets(sourceDocument) {
  document.title = sourceDocument.title || document.title;
  document.documentElement.lang = sourceDocument.documentElement.lang || "tr";

  document.head.querySelectorAll("[data-bkt-template-head]").forEach(node => node.remove());

  sourceDocument.head.querySelectorAll("style, link[rel='stylesheet']").forEach(node => {
    const clone = node.cloneNode(true);
    clone.setAttribute("data-bkt-template-head", "true");
    if (clone.tagName === "LINK") {
      clone.setAttribute("href", resolveAppAsset(clone.getAttribute("href")));
    }
    document.head.appendChild(clone);
  });
}

function rewriteBodyAssets(sourceDocument) {
  sourceDocument.body.querySelectorAll("[src]").forEach(element => {
    element.setAttribute("src", resolveAppAsset(element.getAttribute("src")));
  });
  sourceDocument.body.querySelectorAll("[href]").forEach(element => {
    element.setAttribute("href", resolveAppAsset(element.getAttribute("href")));
  });
}

function loadAppRuntime() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = appRuntimeUrl;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Uygulama çalışma kodu yüklenemedi."));
    document.body.appendChild(script);
  });
}

async function bootstrapApplication() {
  await import("../services/browserRepositoryBridge.js");

  const parser = new DOMParser();
  const sourceDocument = parser.parseFromString(appHtml, "text/html");
  const scripts = Array.from(sourceDocument.body.querySelectorAll("script"));

  scripts.forEach(script => script.remove());
  copyHeadAssets(sourceDocument);
  rewriteBodyAssets(sourceDocument);

  document.body.className = sourceDocument.body.className;
  document.body.innerHTML = sourceDocument.body.innerHTML;

  await loadAppRuntime();
}

bootstrapApplication().catch(error => {
  console.error("Uygulama başlatılamadı.", error);
  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#eef2f4;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <section style="max-width:420px;background:white;border:1px solid #d7dfe3;border-radius:8px;padding:24px;text-align:center;box-shadow:0 22px 55px rgba(21,32,38,.14);">
        <strong style="display:block;margin-bottom:8px;color:#172026;">Uygulama başlatılamadı.</strong>
        <span style="color:#5d6972;">Supabase bağlantı bilgilerini ve Vite kurulumunu kontrol edin.</span>
      </section>
    </main>
  `;
});
