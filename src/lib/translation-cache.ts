/**
 * IndexedDB-based translation cache.
 * Stores translated chapter text keyed by (chapterUrl + language).
 * Uses LRU eviction to keep storage bounded (max 200 entries ≈ 40-80 MB).
 */

const DB_NAME = "novel-reader-cache";
const DB_VERSION = 1;
const STORE_NAME = "translations";
const MAX_ENTRIES = 200;

interface CacheEntry {
  key: string;
  chapterUrl: string;
  language: string;
  translatedText: string;
  createdAt: number;
  accessedAt: number;
  size: number; // bytes (approx)
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("accessedAt", "accessedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(chapterUrl: string, language: string): string {
  return `${language}::${chapterUrl}`;
}

export async function getCachedTranslation(
  chapterUrl: string,
  language: string
): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const key = cacheKey(chapterUrl, language);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        if (entry) {
          // Update access time (LRU)
          entry.accessedAt = Date.now();
          store.put(entry);
          resolve(entry.translatedText);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedTranslation(
  chapterUrl: string,
  language: string,
  translatedText: string
): Promise<void> {
  try {
    const db = await openDB();
    const key = cacheKey(chapterUrl, language);
    const entry: CacheEntry = {
      key,
      chapterUrl,
      language,
      translatedText,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      size: new Blob([translatedText]).size,
    };

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);

    // Evict oldest entries if over limit
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_ENTRIES) {
        const toRemove = countReq.result - MAX_ENTRIES;
        const idx = store.index("accessedAt");
        const cursor = idx.openCursor();
        let removed = 0;
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c && removed < toRemove) {
            c.delete();
            removed++;
            c.continue();
          }
        };
      }
    };
  } catch {
    // Cache write failures are non-critical
  }
}

export async function clearTranslationCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // ignore
  }
}
