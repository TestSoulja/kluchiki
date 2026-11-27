// IndexedDB: одна база, один объект-файл (тот же JSON, что экспорт) и
// настройки рядом (plan.md §6). Других мест браузерного хранилища нет.

const DB_NAME = 'kluchiki';
const DB_VERSION = 1;
const VAULT_STORE = 'vault';
const SETTINGS_STORE = 'settings';
const VAULT_KEY = 'file';
const PREVIOUS_KEY = 'file.previous';

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('ошибка IndexedDB'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('ошибка транзакции'));
    transaction.onabort = () => reject(transaction.error ?? new Error('транзакция отменена'));
  });
}

function createAdapter(db) {
  return {
    async readVault() {
      const tx = db.transaction(VAULT_STORE, 'readonly');
      const value = await requestAsPromise(tx.objectStore(VAULT_STORE).get(VAULT_KEY));
      return typeof value === 'string' ? value : undefined;
    },
    async writeVault(text) {
      if (typeof text !== 'string') throw new TypeError('writeVault: ожидалась строка');
      const tx = db.transaction(VAULT_STORE, 'readwrite');
      const store = tx.objectStore(VAULT_STORE);
      // Одна предыдущая копия до перезаписи: если файл не пуст и новый
      // текст отличается, прежний кладётся под file.previous. Открывается
      // он паролем, который действовал при его записи (plan.md §6).
      const current = await requestAsPromise(store.get(VAULT_KEY));
      if (typeof current === 'string' && current !== text) {
        store.put(current, PREVIOUS_KEY);
      }
      store.put(text, VAULT_KEY);
      await transactionDone(tx);
    },
    async readSettings() {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const rows = await requestAsPromise(tx.objectStore(SETTINGS_STORE).getAll());
      const out = {};
      for (const row of rows) {
        if (row && typeof row.key === 'string') out[row.key] = row.value;
      }
      return out;
    },
    async writeSetting(key, value) {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      if (value === undefined || value === null) {
        tx.objectStore(SETTINGS_STORE).delete(key);
      } else {
        tx.objectStore(SETTINGS_STORE).put({ key, value });
      }
      await transactionDone(tx);
    },
    async clearAll() {
      const tx = db.transaction([VAULT_STORE, SETTINGS_STORE], 'readwrite');
      tx.objectStore(VAULT_STORE).clear();
      tx.objectStore(SETTINGS_STORE).clear();
      await transactionDone(tx);
    },
    close() {
      db.close();
    },
  };
}

export function openDatabase(indexedDb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDb) {
      reject(new Error('браузер не дал локальное хранилище (IndexedDB)'));
      return;
    }
    let request;
    try {
      request = indexedDb.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new Error('браузер не дал локальное хранилище (IndexedDB)'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(createAdapter(request.result));
    request.onerror = () =>
      reject(request.error ?? new Error('браузер не дал локальное хранилище (IndexedDB)'));
    request.onblocked = () =>
      reject(new Error('браузер не дал локальное хранилище (IndexedDB)'));
  });
}

// true — браузер обещает хранить; false — отказал; null — не умеет.
export async function requestPersistence(storage = globalThis.navigator?.storage) {
  if (!storage || typeof storage.persist !== 'function') return null;
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return true;
    }
    return await storage.persist();
  } catch {
    return false;
  }
}
