export interface StoredTile {
  blob: Blob;
  expiresAt: number;
  lastAccessAt: number;
}

export interface TileStoreRead {
  entry: StoredTile | null;
  evictions: number;
}

export interface TileStoreWrite {
  stored: boolean;
  evictions: number;
}

export interface TileStoreLimits {
  maxBytes: number;
  maxEntries: number;
  maxTileBytes: number;
}

export interface TileStore {
  get(key: string, now: number): Promise<TileStoreRead>;
  put(key: string, entry: StoredTile, now: number, limits: TileStoreLimits): Promise<TileStoreWrite>;
  delete(key: string): Promise<void>;
}

interface UsageRecord {
  id: 'usage';
  bytes: number;
  entries: number;
}

const DATABASE_NAME = 'solara-mars-tile-cache';
const DATABASE_VERSION = 1;
const TILE_STORE = 'tiles';
const META_STORE = 'meta';

/** IndexedDB blob store with transactional expiry and LRU eviction. */
export class IndexedDbTileStore implements TileStore {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly databaseName: string;

  constructor(databaseName = DATABASE_NAME) {
    this.databaseName = databaseName;
  }

  async get(key: string, now: number): Promise<TileStoreRead> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([TILE_STORE, META_STORE], 'readwrite');
      const tiles = transaction.objectStore(TILE_STORE);
      const meta = transaction.objectStore(META_STORE);
      let result: TileStoreRead = { entry: null, evictions: 0 };

      const request = tiles.get(key) as IDBRequest<StoredTile | undefined>;
      request.onsuccess = () => {
        const entry = request.result;
        if (!entry) return;

        if (entry.expiresAt <= now) {
          tiles.delete(key);
          result.evictions = 1;
          const usageRequest = meta.get('usage') as IDBRequest<UsageRecord | undefined>;
          usageRequest.onsuccess = () => {
            const usage = usageRequest.result;
            if (!usage) return;
            usage.bytes = Math.max(0, usage.bytes - entry.blob.size);
            usage.entries = Math.max(0, usage.entries - 1);
            meta.put(usage);
          };
          return;
        }

        entry.lastAccessAt = now;
        tiles.put(entry, key);
        result = { entry, evictions: 0 };
      };

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB tile read failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB tile read was aborted.'));
    });
  }

  async put(
    key: string,
    entry: StoredTile,
    now: number,
    limits: TileStoreLimits,
  ): Promise<TileStoreWrite> {
    if (entry.blob.size > limits.maxTileBytes || entry.expiresAt <= now) {
      return { stored: false, evictions: 0 };
    }

    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([TILE_STORE, META_STORE], 'readwrite');
      const tiles = transaction.objectStore(TILE_STORE);
      const meta = transaction.objectStore(META_STORE);
      let result: TileStoreWrite = { stored: false, evictions: 0 };

      const existingRequest = tiles.get(key) as IDBRequest<StoredTile | undefined>;
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result;
        const usageRequest = meta.get('usage') as IDBRequest<UsageRecord | undefined>;
        usageRequest.onsuccess = () => {
          const usage = usageRequest.result ?? { id: 'usage', bytes: 0, entries: 0 };
          if (existing) {
            usage.bytes = Math.max(0, usage.bytes - existing.blob.size);
            usage.entries = Math.max(0, usage.entries - 1);
            tiles.delete(key);
          }

          const fits = () =>
            usage.entries + 1 <= limits.maxEntries &&
            usage.bytes + entry.blob.size <= limits.maxBytes;

          const storeIfFits = () => {
            if (!fits()) return;
            tiles.put(entry, key);
            usage.entries += 1;
            usage.bytes += entry.blob.size;
            meta.put(usage);
            result.stored = true;
          };

          const evictLeastRecentlyUsed = () => {
            if (fits()) {
              storeIfFits();
              return;
            }
            const cursorRequest = tiles.index('lastAccessAt').openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) {
                meta.put(usage);
                return;
              }
              const oldEntry = cursor.value as StoredTile;
              usage.bytes = Math.max(0, usage.bytes - oldEntry.blob.size);
              usage.entries = Math.max(0, usage.entries - 1);
              result.evictions += 1;
              cursor.delete();
              if (fits()) {
                storeIfFits();
                return;
              }
              cursor.continue();
            };
          };

          const expiredRequest = tiles.index('expiresAt').openCursor(IDBKeyRange.upperBound(now));
          expiredRequest.onsuccess = () => {
            const cursor = expiredRequest.result;
            if (!cursor) {
              evictLeastRecentlyUsed();
              return;
            }
            const expiredEntry = cursor.value as StoredTile;
            usage.bytes = Math.max(0, usage.bytes - expiredEntry.blob.size);
            usage.entries = Math.max(0, usage.entries - 1);
            result.evictions += 1;
            cursor.delete();
            cursor.continue();
          };
        };
      };

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB tile write failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB tile write was aborted.'));
    });
  }

  async delete(key: string): Promise<void> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([TILE_STORE, META_STORE], 'readwrite');
      const tiles = transaction.objectStore(TILE_STORE);
      const meta = transaction.objectStore(META_STORE);
      const request = tiles.get(key) as IDBRequest<StoredTile | undefined>;
      request.onsuccess = () => {
        const entry = request.result;
        if (!entry) return;
        tiles.delete(key);
        const usageRequest = meta.get('usage') as IDBRequest<UsageRecord | undefined>;
        usageRequest.onsuccess = () => {
          const usage = usageRequest.result;
          if (!usage) return;
          usage.bytes = Math.max(0, usage.bytes - entry.blob.size);
          usage.entries = Math.max(0, usage.entries - 1);
          meta.put(usage);
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB tile removal failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB tile removal was aborted.'));
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
    }

    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        const tiles = database.objectStoreNames.contains(TILE_STORE)
          ? request.transaction!.objectStore(TILE_STORE)
          : database.createObjectStore(TILE_STORE);
        if (!tiles.indexNames.contains('expiresAt')) {
          tiles.createIndex('expiresAt', 'expiresAt', { unique: false });
        }
        if (!tiles.indexNames.contains('lastAccessAt')) {
          tiles.createIndex('lastAccessAt', 'lastAccessAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          const meta = database.createObjectStore(META_STORE, { keyPath: 'id' });
          meta.put({ id: 'usage', bytes: 0, entries: 0 } satisfies UsageRecord);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        if (blocked) database.close();
        else resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('IndexedDB tile cache upgrade is blocked by another tab.'));
      };
    }).catch((error: unknown): IDBDatabase => {
      this.databasePromise = null;
      throw error;
    });
    this.databasePromise = databasePromise;
    return databasePromise;
  }
}
