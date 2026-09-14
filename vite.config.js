import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const appTemplatePath = path.resolve("outputs/hukuk-burosu-takip-sistemi.html");
const appRuntimeModuleId = "virtual:bkt-app-runtime-url";
const resolvedAppRuntimeModuleId = `\0${appRuntimeModuleId}`;
const appRuntimeDevPath = "/__bkt_app_runtime.js";
const tauriDevHost = process.env.TAURI_DEV_HOST;

function appRuntimeModule() {
  let serveMode = false;

  function readRuntimeSource() {
    const template = fs.readFileSync(appTemplatePath, "utf8");
    const scripts = [...template.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    if (scripts.length !== 1) {
      throw new Error(`BKT uygulama şablonunda tam olarak bir inline runtime scripti bekleniyordu; bulunan: ${scripts.length}.`);
    }
    return scripts[0][1];
  }

  return {
    name: "bkt-app-runtime-module",
    configResolved(config) {
      serveMode = config.command === "serve";
    },
    configureServer(server) {
      server.watcher.add(appTemplatePath);
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== appRuntimeDevPath) return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.end(readRuntimeSource());
      });
    },
    resolveId(id) {
      return id === appRuntimeModuleId ? resolvedAppRuntimeModuleId : null;
    },
    load(id) {
      if (id !== resolvedAppRuntimeModuleId) return null;
      if (serveMode) return `export default ${JSON.stringify(appRuntimeDevPath)};`;
      this.addWatchFile(appTemplatePath);
      const referenceId = this.emitFile({
        type: "asset",
        name: "bkt-app-runtime.js",
        source: readRuntimeSource()
      });
      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
    }
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [appRuntimeModule()],
  server: {
    host: tauriDevHost || "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 5173
        }
      : undefined,
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/src-tauri/target/**",
        "**/test-artifacts/**",
        "**/playwright-report/**"
      ]
    }
  },
  build: {
    rollupOptions: {
      input: {
        desktop: path.resolve("index.html"),
        mobile: path.resolve("mobile.html")
      }
    }
  }
});
