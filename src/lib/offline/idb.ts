import type { Backend } from "./store";

const DB = "solar-switch-offline";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open local storage."));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Local storage failed."));
        };
      })
  );
}

export const idbAvailable = () => typeof indexedDB !== "undefined";

/** Browser backend. Values are plain JSON-safe objects. */
export const idbBackend: Backend = {
  async get<T>(key: string) {
    return (await run("readonly", (s) => s.get(key))) as T | undefined;
  },
  async set(key, value) {
    await run("readwrite", (s) => s.put(value, key));
  },
  async clear() {
    await run("readwrite", (s) => s.clear());
  }
};
