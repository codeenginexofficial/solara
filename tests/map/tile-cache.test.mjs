import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TileCache,
  TileRequestError,
  MARS_VIKING_TILE_CACHE_POLICY,
  marsTrekTileCachePolicy,
} from '../../src/map/cache/tileCache.ts';

class MemoryTileStore {
  entries = new Map();

  async get(key, now) {
    const entry = this.entries.get(key);
    if (!entry) return { entry: null, evictions: 0 };
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return { entry: null, evictions: 1 };
    }
    entry.lastAccessAt = now;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { entry, evictions: 0 };
  }

  async put(key, entry, now, limits) {
    if (entry.blob.size > limits.maxTileBytes || entry.expiresAt <= now) {
      return { stored: false, evictions: 0 };
    }
    const existing = this.entries.get(key);
    if (existing) this.entries.delete(key);
    let evictions = 0;
    const currentBytes = () => [...this.entries.values()].reduce((sum, item) => sum + item.blob.size, 0);
    for (const [candidateKey, candidate] of [...this.entries]) {
      if (candidate.expiresAt <= now) {
        this.entries.delete(candidateKey);
        evictions += 1;
      }
    }
    while (
      this.entries.size + 1 > limits.maxEntries ||
      currentBytes() + entry.blob.size > limits.maxBytes
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      evictions += 1;
    }
    if (this.entries.size + 1 > limits.maxEntries || currentBytes() + entry.blob.size > limits.maxBytes) {
      return { stored: false, evictions };
    }
    this.entries.set(key, { ...entry, lastAccessAt: now });
    return { stored: true, evictions };
  }

  async delete(key) {
    this.entries.delete(key);
  }
}

const imageResponse = (body = 'tile', headers = {}) =>
  new Response(new Blob([body], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600', ...headers },
  });

const defaultLimits = {
  memoryMaxBytes: 8,
  memoryMaxEntries: 2,
  maxBytes: 64,
  maxEntries: 8,
  maxTileBytes: 16,
  maxConcurrentRequests: 4,
  maxConcurrentPrefetch: 1,
};

test('memory LRU is entry/byte bounded and disk entries can refill it', async () => {
  const store = new MemoryTileStore();
  let requests = 0;
  const cache = new TileCache({
    store,
    limits: defaultLimits,
    fetcher: async () => {
      requests += 1;
      return imageResponse('1234');
    },
  });

  const load = (name) => cache.load(`https://tiles.test/${name}`, {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'visible',
  });

  await load('a');
  await load('b');
  await load('a'); // makes A most-recently used
  await load('c'); // evicts B from memory, not persistent storage
  await cache.flushPersistence();
  const diskHit = await load('b');

  assert.equal(diskHit.size, 4);
  assert.equal(requests, 3);
  assert.ok(cache.getDiagnostics().memoryHits >= 1);
  assert.ok(cache.getDiagnostics().persistentHits >= 1);
  assert.ok(cache.getDiagnostics().evictions >= 1);
});

test('persistent records survive a new cache instance and obey the source lifetime cap', async () => {
  const store = new MemoryTileStore();
  let now = Date.UTC(2026, 10, 15);
  let requests = 0;
  const policy = marsTrekTileCachePolicy('mola-test');
  const first = new TileCache({
    store,
    now: () => now,
    fetcher: async () => {
      requests += 1;
      return imageResponse('persist', {
        'cache-control': '',
        'last-modified': 'Thu, 30 Nov 2017 00:00:00 GMT',
      });
    },
  });
  await first.load('https://trek.test/tile.jpg', { policy, priority: 'visible' });
  await first.flushPersistence();

  const afterReload = new TileCache({
    store,
    now: () => now,
    fetcher: async () => {
      requests += 1;
      return imageResponse('fresh');
    },
  });
  assert.equal((await afterReload.load('https://trek.test/tile.jpg', { policy, priority: 'visible' })).size, 7);
  assert.equal(afterReload.getDiagnostics().persistentHits, 1);
  assert.equal(requests, 1);

  now += 24 * 60 * 60 * 1000 + 1;
  const expired = await afterReload.load('https://trek.test/tile.jpg', { policy, priority: 'visible' });
  assert.equal(expired.size, 5);
  assert.equal(requests, 2);
});

test('persistent LRU evicts the least recently used record at the configured budget', async () => {
  const store = new MemoryTileStore();
  let requests = 0;
  const limits = {
    ...defaultLimits,
    memoryMaxBytes: 4,
    memoryMaxEntries: 1,
    maxBytes: 8,
    maxEntries: 2,
    maxTileBytes: 4,
  };
  const fetcher = async () => {
    requests += 1;
    return imageResponse('1234');
  };
  const first = new TileCache({ store, limits, fetcher });
  const options = (priority = 'visible') => ({ policy: MARS_VIKING_TILE_CACHE_POLICY, priority });
  await first.load('https://tiles.test/disk-a', options());
  await first.load('https://tiles.test/disk-b', options());
  await first.flushPersistence();

  const nextSession = new TileCache({ store, limits, fetcher });
  await nextSession.load('https://tiles.test/disk-a', options()); // refresh A's persistent LRU age
  await nextSession.load('https://tiles.test/disk-c', options());
  await nextSession.flushPersistence();

  assert.equal(requests, 3);
  assert.equal(store.entries.size, 2);
  assert.ok([...store.entries.keys()].some((key) => key.endsWith('/disk-a')));
  assert.ok([...store.entries.keys()].some((key) => key.endsWith('/disk-c')));
  assert.ok(![...store.entries.keys()].some((key) => key.endsWith('/disk-b')));
});

test('no-store responses are not retained and HTTP failures can be retried', async () => {
  let requests = 0;
  const cache = new TileCache({
    store: new MemoryTileStore(),
    fetcher: async () => {
      requests += 1;
      if (requests === 1) return new Response('error', { status: 503, headers: { 'content-type': 'text/plain' } });
      return imageResponse('ok', { 'cache-control': 'no-store' });
    },
  });
  const options = { policy: MARS_VIKING_TILE_CACHE_POLICY, priority: 'visible' };
  await assert.rejects(cache.load('https://tiles.test/retry', options), (error) =>
    error instanceof TileRequestError && error.kind === 'http-server',
  );
  await cache.load('https://tiles.test/retry', options);
  await cache.load('https://tiles.test/retry', options);
  assert.equal(requests, 3);
});

test('same-tile requests deduplicate and a visible request promotes queued work', async () => {
  const store = new MemoryTileStore();
  let resolveFetch;
  let requests = 0;
  const cache = new TileCache({
    store,
    fetcher: () => {
      requests += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const url = 'https://tiles.test/shared';
  const background = cache.load(url, {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'idle',
    prefetchGeneration: 3,
  });
  const visible = cache.load(url, {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'visible',
  });
  await new Promise((resolve) => setImmediate(resolve));
  resolveFetch(imageResponse('same'));
  assert.equal((await background).size, 4);
  assert.equal((await visible).size, 4);
  assert.equal(requests, 1);
  assert.equal(cache.getDiagnostics().deduplicatedRequests, 1);
});

test('visible work aborts irrelevant speculative traffic and takes the freed slot', async () => {
  const store = new MemoryTileStore();
  const started = [];
  const cache = new TileCache({
    store,
    limits: { ...defaultLimits, maxConcurrentRequests: 1, maxConcurrentPrefetch: 1 },
    fetcher: (url, { signal }) => {
      started.push(url);
      if (url.endsWith('/background')) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      }
      return Promise.resolve(imageResponse('visible'));
    },
  });
  const background = cache.load('https://tiles.test/background', {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'idle',
    prefetchGeneration: 11,
  }).catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  const visible = cache.load('https://tiles.test/visible', {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'visible',
  });

  assert.equal((await visible).size, 7);
  assert.equal((await background).name, 'AbortError');
  assert.deepEqual(started, ['https://tiles.test/background', 'https://tiles.test/visible']);
});

test('IndexedDB/quota failures fail open to network and are recorded', async () => {
  const store = {
    get: async () => { throw new DOMException('quota', 'QuotaExceededError'); },
    put: async () => { throw new DOMException('quota', 'QuotaExceededError'); },
    delete: async () => undefined,
  };
  const cache = new TileCache({ store, fetcher: async () => imageResponse('ok') });
  assert.equal((await cache.load('https://tiles.test/storage-failure', {
    policy: MARS_VIKING_TILE_CACHE_POLICY,
    priority: 'visible',
  })).size, 2);
  await cache.flushPersistence();
  assert.equal(cache.getDiagnostics().storageFailures, 2);
});
