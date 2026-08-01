export function isTauriRuntime() {
  return Boolean(globalThis.__TAURI_INTERNALS__?.invoke);
}

export function runtimeEnvironment() {
  return isTauriRuntime() ? "tauri" : "web";
}
