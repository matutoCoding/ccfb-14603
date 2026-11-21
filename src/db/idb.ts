// IndexedDB 封装：批次 / 焙笼 / 记录 / 师傅 / 大结果对象 五个仓库
import type { StoreName, DbSchema } from '../types';

const DB_NAME = 'tanbei-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores: StoreName[] = ['batches', 'baskets', 'records', 'masters', 'results'];
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function idbPut<K extends StoreName>(store: K, item: DbSchema[K][number]): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(item as any));
}

export async function idbGet<K extends StoreName>(store: K, id: string): Promise<DbSchema[K][number] | undefined> {
  return tx(store, 'readonly', (s) => s.get(id));
}

export async function idbAll<K extends StoreName>(store: K): Promise<DbSchema[K]> {
  return tx(store, 'readonly', (s) => s.getAll());
}

export async function idbDelete<K extends StoreName>(store: K, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id));
}

export async function idbClear(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

export async function idbBulkPut<K extends StoreName>(store: K, items: DbSchema[K][number][]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const it of items) s.put(it as any);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
