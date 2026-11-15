import {
  IndexedDbTileStore,
  type StoredTile,
  type TileStore,
  type TileStoreLimits,
} from './indexedDbTileStore';

export type TileRequestPriority = 'visible' | 'adjacent' | 'next-zoom' | 'idle';

export interface TileCachePolicy {
  /** Stable source identity keeps policies and revisions from sharing records. */
  namespace: string;
  /** Maximum browser-managed freshness lifetime for this source. */
  maxAgeCapMs: number;
  /** Allow a bounded HTTP Last-Modified heuristic when Cache-Control/Expires are absent. */
  allowLastModifiedHeuristic?: boolean;
}

export interface TileLoadOptions {
  policy: TileCachePolicy;
  priority: TileRequestPriority;
  prefetchGeneration?: number;
}

export interface TileCacheLimits extends TileStoreLimits {
  memoryMaxBytes: number;
  memoryMaxEntries: number;
  maxConcurrentRequests: number;
  maxConcurrentPrefetch: number;
}

export interface TileCacheDiagnostics {
  memoryHits: number;
  memoryMisses: number;
  persistentHits: number;
  persistentMisses: number;
  networkRequests: number;
  prefetchRequests: number;
  evictions: number;
  storageFailures: number;
  deduplicatedRequests: number;
  queuedRequests: number;
  activeRequests: number;
}

export class TileRequestError extends Error {
  readonly kind: 'http-404' | 'http-server' | 'http-other' | 'network-error' | 'invalid-response';
  readonly status?: number;

  constructor(
    message: string,
    kind: 'http-404' | 'http-server' | 'http-other' | 'network-error' | 'invalid-response',
    status?: number,
  ) {
    super(message);
    this.name = 'TileRequestError';
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_LIMITS: TileCacheLimits = {
  memoryMaxBytes: 24 * 1024 * 1024,
  memoryMaxEntries: 192,
  maxBytes: 128 * 1024 * 1024,
  maxEntries: 2048,
  maxTileBytes: 2 * 1024 * 1024,
  maxConcurrentRequests: 8,
  maxConcurrentPrefetch: 2,
};

const PRIORITY_RANK: Record<TileRequestPriority, number> = {
  visible: 0,
  adjacent: 1,
  'next-zoom': 2,
  idle: 3,
};

const ZERO_DIAGNOSTICS = (): TileCacheDiagnostics => ({
  memoryHits: 0,
  memoryMisses: 0,
  persistentHits: 0,
  persistentMisses: 0,
  networkRequests: 0,
  prefetchRequests: 0,
  evictions: 0,
  storageFailures: 0,
  deduplicatedRequests: 0,
  queuedRequests: 0,
  activeRequests: 0,
});

interface MemoryEntry extends StoredTile {}

interface TileFlight {
  key: string;
  url: string;
  policy: TileCachePolicy;
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  priority: TileRequestPriority;
  prefetchGenerations: Set<number>;
  visibleDemand: boolean;
  stage: 'storage' | 'queued' | 'network' | 'settled';
  settled: boolean;
  networkStartedAsPrefetch: boolean;
  controller: AbortController | null;
}

export interface TileCacheOptions {
  limits?: Partial<TileCacheLimits>;
  store?: TileStore;
  fetcher?: typeof fetch;
  now?: () => number;
}

/**
 * Bounded cache for encoded public map tiles. OpenLayers holds decoded tile
 * objects; this cache keeps only short lived Blob references and bounded IDB
 * records. Network scheduling always reserves capacity for visible tiles.
 */
export class TileCache {
  readonly limits: TileCacheLimits;
  private readonly store: TileStore;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly flights = new Map<string, TileFlight>();
  private readonly queue: TileFlight[] = [];
  private readonly persistenceWrites = new Set<Promise<void>>();
  private memoryBytes = 0;
  private activeRequests = 0;
  private activePrefetch = 0;
  private readonly diagnostics = ZERO_DIAGNOSTICS();

  constructor(options: TileCacheOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.store = options.store ?? new IndexedDbTileStore();
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  load(url: string, options: TileLoadOptions): Promise<Blob> {
    const key = `${options.policy.namespace}\u0000${url}`;
    const cached = this.readMemory(key);
    if (cached) {
      this.diagnostics.memoryHits += 1;
      return Promise.resolve(cached.blob);
    }
    this.diagnostics.memoryMisses += 1;

    const existing = this.flights.get(key);
    if (existing) {
      this.diagnostics.deduplicatedRequests += 1;
      this.promote(existing, options);
      return existing.promise;
    }

    let resolve!: (blob: Blob) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Blob>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const flight: TileFlight = {
      key,
      url,
      policy: options.policy,
      promise,
      resolve,
      reject,
      priority: options.priority,
      prefetchGenerations: new Set(
        options.prefetchGeneration === undefined ? [] : [options.prefetchGeneration],
      ),
      visibleDemand: options.priority === 'visible',
      stage: 'storage',
      settled: false,
      networkStartedAsPrefetch: false,
      controller: null,
    };
    this.flights.set(key, flight);
    if (flight.visibleDemand) this.preemptSpeculation(flight);
    void this.loadFromPersistentOrQueue(flight);
    return promise;
  }

  cancelPrefetchGeneration(generation: number): void {
    for (const flight of this.flights.values()) {
      if (!flight.prefetchGenerations.delete(generation) || flight.visibleDemand) continue;
      if (flight.prefetchGenerations.size > 0) continue;
      if (flight.stage === 'queued') {
        const index = this.queue.indexOf(flight);
        if (index >= 0) this.queue.splice(index, 1);
        this.finishWithError(flight, new DOMException('Tile prefetch superseded.', 'AbortError'));
      } else if (flight.stage === 'storage') {
        // The IDB read cannot be cancelled, but it will not be followed by a
        // network request when its last generation has been superseded.
        flight.priority = 'idle';
      } else if (flight.stage === 'network') {
        flight.controller?.abort();
      }
    }
    this.updateDiagnostics();
  }

  invalidate(url: string, policy: TileCachePolicy): void {
    const key = `${policy.namespace}\u0000${url}`;
    const memoryEntry = this.memory.get(key);
    if (memoryEntry) {
      this.memory.delete(key);
      this.memoryBytes -= memoryEntry.blob.size;
      this.diagnostics.evictions += 1;
    }
    const deletion = this.store
      .delete?.(key)
      .then(() => undefined)
      .catch(() => {
        this.diagnostics.storageFailures += 1;
      });
    if (deletion) this.trackPersistence(deletion);
    this.updateDiagnostics();
  }

  getDiagnostics(): TileCacheDiagnostics {
    return {
      ...this.diagnostics,
      queuedRequests: this.queue.length,
      activeRequests: this.activeRequests,
    };
  }

  /** Wait for pending best-effort IDB writes; useful to diagnostics and tests. */
  async flushPersistence(): Promise<void> {
    while (this.persistenceWrites.size > 0) {
      await Promise.all([...this.persistenceWrites]);
    }
  }

  private async loadFromPersistentOrQueue(flight: TileFlight): Promise<void> {
    try {
      const result = await this.store.get(flight.key, this.now());
      this.diagnostics.evictions += result.evictions;
      if (result.entry) {
        this.diagnostics.persistentHits += 1;
        if (flight.settled) return;
        this.writeMemory(flight.key, result.entry);
        this.finishWithBlob(flight, result.entry.blob);
        return;
      }
      this.diagnostics.persistentMisses += 1;
    } catch {
      // Browser quota, private mode, blocked IDB, and structured-clone errors
      // must not stop a tile from loading over the network.
      this.diagnostics.storageFailures += 1;
      this.diagnostics.persistentMisses += 1;
    }

    if (flight.settled) return;
    if (!flight.visibleDemand && flight.prefetchGenerations.size === 0) {
      this.finishWithError(flight, new DOMException('Tile prefetch superseded.', 'AbortError'));
      return;
    }
    flight.stage = 'queued';
    this.queue.push(flight);
    this.pump();
  }

  private promote(flight: TileFlight, options: TileLoadOptions): void {
    if (options.priority === 'visible') {
      flight.visibleDemand = true;
      flight.priority = 'visible';
      this.preemptSpeculation(flight);
    } else {
      flight.priority = PRIORITY_RANK[options.priority] < PRIORITY_RANK[flight.priority]
        ? options.priority
        : flight.priority;
      if (options.prefetchGeneration !== undefined) {
        flight.prefetchGenerations.add(options.prefetchGeneration);
      }
    }
    if (flight.stage === 'queued') this.pump();
  }

  private preemptSpeculation(except: TileFlight): void {
    for (const flight of this.flights.values()) {
      if (
        flight !== except &&
        flight.stage === 'network' &&
        flight.networkStartedAsPrefetch &&
        !flight.visibleDemand
      ) {
        flight.controller?.abort();
      }
    }
  }

  private pump(): void {
    this.queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    while (this.activeRequests < this.limits.maxConcurrentRequests) {
      const index = this.queue.findIndex(
        (flight) => flight.visibleDemand || this.activePrefetch < this.limits.maxConcurrentPrefetch,
      );
      if (index < 0) break;
      const [flight] = this.queue.splice(index, 1);
      if (!flight || flight.settled) continue;
      this.startNetwork(flight);
    }
    this.updateDiagnostics();
  }

  private startNetwork(flight: TileFlight): void {
    flight.stage = 'network';
    flight.networkStartedAsPrefetch = !flight.visibleDemand;
    this.activeRequests += 1;
    if (flight.networkStartedAsPrefetch) {
      this.activePrefetch += 1;
      this.diagnostics.prefetchRequests += 1;
    }
    flight.controller = new AbortController();
    this.diagnostics.networkRequests += 1;
    this.updateDiagnostics();

    void this.fetcher(flight.url, {
      mode: 'cors',
      credentials: 'omit',
      signal: flight.controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const kind = response.status === 404
            ? 'http-404'
            : response.status >= 500
              ? 'http-server'
              : 'http-other';
          throw new TileRequestError(`Tile request failed with HTTP ${response.status}.`, kind, response.status);
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (!contentType.startsWith('image/')) {
          throw new TileRequestError('Tile response did not have an image content type.', 'invalid-response');
        }
        const blob = await response.blob();
        if (blob.size === 0) {
          throw new TileRequestError('Tile response body was empty.', 'invalid-response');
        }

        const expiresAt = computeExpiry(response.headers, this.now(), flight.policy);
        if (expiresAt !== null && blob.size <= this.limits.maxTileBytes) {
          const entry: StoredTile = { blob, expiresAt, lastAccessAt: this.now() };
          this.writeMemory(flight.key, entry);
          this.persist(flight.key, entry);
        }
        this.finishWithBlob(flight, blob);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.finishWithError(flight, error);
          return;
        }
        if (error instanceof TileRequestError) {
          this.finishWithError(flight, error);
        } else {
          this.finishWithError(
            flight,
            new TileRequestError('Tile request could not be completed.', 'network-error'),
          );
        }
      })
      .finally(() => {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        if (flight.networkStartedAsPrefetch) {
          this.activePrefetch = Math.max(0, this.activePrefetch - 1);
        }
        this.updateDiagnostics();
        this.pump();
      });
  }

  private persist(key: string, entry: StoredTile): void {
    const write = this.store
      .put(key, entry, this.now(), this.limits)
      .then((result) => {
        this.diagnostics.evictions += result.evictions;
      })
      .catch(() => {
        // Persistence is best-effort: quota/storage problems do not fail a tile.
        this.diagnostics.storageFailures += 1;
      });
    this.trackPersistence(write);
  }

  private trackPersistence(write: Promise<void>): void {
    this.persistenceWrites.add(write);
    void write.then(() => this.persistenceWrites.delete(write));
  }

  private readMemory(key: string): MemoryEntry | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.memory.delete(key);
      this.memoryBytes -= entry.blob.size;
      this.diagnostics.evictions += 1;
      return null;
    }
    this.memory.delete(key);
    entry.lastAccessAt = this.now();
    this.memory.set(key, entry);
    return entry;
  }

  private writeMemory(key: string, entry: MemoryEntry): void {
    const previous = this.memory.get(key);
    if (previous) {
      this.memory.delete(key);
      this.memoryBytes -= previous.blob.size;
    }
    if (entry.blob.size > this.limits.memoryMaxBytes || entry.expiresAt <= this.now()) return;

    const updated = { ...entry, lastAccessAt: this.now() };
    this.memory.set(key, updated);
    this.memoryBytes += updated.blob.size;
    while (
      this.memory.size > this.limits.memoryMaxEntries ||
      this.memoryBytes > this.limits.memoryMaxBytes
    ) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.memory.get(oldestKey);
      this.memory.delete(oldestKey);
      if (oldest) this.memoryBytes = Math.max(0, this.memoryBytes - oldest.blob.size);
      this.diagnostics.evictions += 1;
    }
  }

  private finishWithBlob(flight: TileFlight, blob: Blob): void {
    if (flight.settled) return;
    flight.settled = true;
    flight.stage = 'settled';
    this.flights.delete(flight.key);
    flight.resolve(blob);
  }

  private finishWithError(flight: TileFlight, error: unknown): void {
    if (flight.settled) return;
    flight.settled = true;
    flight.stage = 'settled';
    this.flights.delete(flight.key);
    flight.reject(error);
  }

  private updateDiagnostics(): void {
    this.diagnostics.queuedRequests = this.queue.length;
    this.diagnostics.activeRequests = this.activeRequests;
  }
}

function computeExpiry(
  headers: Headers,
  now: number,
  policy: TileCachePolicy,
): number | null {
  const cacheControl = (headers.get('cache-control') ?? '').toLowerCase();
  const directives = cacheControl.split(',').map((item) => item.trim());
  if (
    directives.some((item) =>
      item === 'no-store' || item.startsWith('no-store=') ||
      item === 'no-cache' || item.startsWith('no-cache='),
    ) ||
    (headers.get('vary') ?? '').trim() === '*'
  ) {
    return null;
  }

  const maxAge = directives.find((item) => item.startsWith('max-age='));
  if (maxAge) {
    const seconds = Number.parseInt(maxAge.slice('max-age='.length).replaceAll('"', ''), 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const ageSeconds = Number.parseFloat(headers.get('age') ?? '0');
    const remainingMs = Math.max(0, seconds - (Number.isFinite(ageSeconds) ? ageSeconds : 0)) * 1000;
    return remainingMs > 0 ? now + Math.min(remainingMs, policy.maxAgeCapMs) : null;
  }

  const expires = Date.parse(headers.get('expires') ?? '');
  if (Number.isFinite(expires)) {
    const remainingMs = expires - now;
    return remainingMs > 0 ? now + Math.min(remainingMs, policy.maxAgeCapMs) : null;
  }

  if (!policy.allowLastModifiedHeuristic) return null;
  const lastModified = Date.parse(headers.get('last-modified') ?? '');
  if (!Number.isFinite(lastModified) || lastModified > now) return null;
  const heuristicMs = Math.max(60_000, (now - lastModified) * 0.1);
  return now + Math.min(heuristicMs, policy.maxAgeCapMs);
}

export const MARS_VIKING_TILE_CACHE_POLICY: TileCachePolicy = {
  namespace: 'mars-viking-mdim21-v1',
  maxAgeCapMs: 60 * 60 * 1000,
};

/** Esri's global CTX service was observed publishing max-age=2592000 (30d).
 * The cache honors shorter source directives and caps persistence at 30d. */
export const MARS_GLOBAL_CTX_TILE_CACHE_POLICY: TileCachePolicy = {
  namespace: 'mars-global-ctx-v01-esri-tiles-v1',
  maxAgeCapMs: 30 * 24 * 60 * 60 * 1000,
};

export function marsTrekTileCachePolicy(datasetId: string): TileCachePolicy {
  return {
    namespace: `mars-trek-${datasetId}-v1`,
    maxAgeCapMs: 24 * 60 * 60 * 1000,
    allowLastModifiedHeuristic: true,
  };
}

export const marsTileCache = new TileCache();
