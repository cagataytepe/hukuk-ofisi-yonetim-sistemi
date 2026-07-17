export class LocalStorageRepository {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.mode = "localStorage";
  }

  getItem(key) {
    return this.storage.getItem(key);
  }

  setItem(key, value) {
    this.storage.setItem(key, value);
  }

  removeItem(key) {
    this.storage.removeItem(key);
  }

  getJson(key, fallback = null) {
    const value = this.getItem(key);
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  setJson(key, value) {
    this.setItem(key, JSON.stringify(value));
  }
}
