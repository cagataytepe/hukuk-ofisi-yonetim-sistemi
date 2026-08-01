import { isTauriRuntime, runtimeEnvironment } from "./runtimeEnvironment.js";

function normalizeExtensions(extensions = []) {
  return [...new Set(extensions
    .map(extension => String(extension || "").trim().replace(/^\.+/, "").toLowerCase())
    .filter(Boolean))];
}

function filenameWithExtension(filename, extensions) {
  const safeName = String(filename || "dosya").trim() || "dosya";
  const normalized = normalizeExtensions(extensions);
  if (!normalized.length || normalized.some(extension => safeName.toLowerCase().endsWith(`.${extension}`))) {
    return safeName;
  }
  return `${safeName}.${normalized[0]}`;
}

function asBlob(data, mimeType) {
  if (data instanceof Blob) return data;
  return new Blob([data], { type: mimeType || "application/octet-stream" });
}

async function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new TextEncoder().encode(String(data ?? ""));
}

function downloadInBrowser({ filename, mimeType, data, extensions }) {
  const blob = asBlob(data, mimeType);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameWithExtension(filename, extensions);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { status: "saved", environment: "web" };
}

export async function saveGeneratedFile({ filename, mimeType, data, extensions = [] }) {
  if (!isTauriRuntime()) {
    return downloadInBrowser({ filename, mimeType, data, extensions });
  }

  const normalizedExtensions = normalizeExtensions(extensions);
  const suggestedName = filenameWithExtension(filename, normalizedExtensions);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs")
  ]);
  const targetPath = await save({
    defaultPath: suggestedName,
    filters: normalizedExtensions.length
      ? [{ name: suggestedName.split(".").pop()?.toUpperCase() || "Dosya", extensions: normalizedExtensions }]
      : []
  });

  if (!targetPath) return { status: "cancelled", environment: "tauri" };
  await writeFile(targetPath, await asBytes(data));
  return { status: "saved", environment: "tauri" };
}

export const desktopRuntime = Object.freeze({
  environment: runtimeEnvironment(),
  isTauri: isTauriRuntime(),
  saveGeneratedFile
});
