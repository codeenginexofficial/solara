/** NASA Image and Video Library adapter for non-location-linked Mars video. */

const NASA_API_ROOT = 'https://images-api.nasa.gov';
const NASA_ASSET_HOST = 'images-assets.nasa.gov';
const VIDEO_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry<NasaMarsVideoSearchPage>>();
const manifestCache = new Map<string, CacheEntry<NasaMarsVideoFile[]>>();

export interface NasaMarsVideo {
  nasaId: string;
  title: string;
  description?: string;
  dateCreated?: string;
  center?: string;
  credit?: string;
  thumbnailUrl?: string;
  externalUrl: string;
}

export interface NasaMarsVideoSearchPage {
  videos: NasaMarsVideo[];
  totalHits: number | null;
  page: number;
}

export interface NasaMarsVideoFile {
  url: string;
  fileSize?: number;
}

export class NasaMarsVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NasaMarsVideoError';
  }
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) return undefined;
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (!cache.has(key) && cache.size >= 64) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + VIDEO_METADATA_CACHE_TTL_MS });
}

async function fetchJson(
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abortForCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortForCaller, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new NasaMarsVideoError(`${label} timed out.`);
    throw new NasaMarsVideoError(`Could not reach ${label.toLowerCase()}.`);
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortForCaller);
  }

  if (!response.ok) throw new NasaMarsVideoError(`${label} returned HTTP ${response.status}.`);
  try {
    return await response.json() as unknown;
  } catch {
    throw new NasaMarsVideoError(`${label} returned unreadable JSON.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength = 8_000): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= maxLength
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nasaAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.hostname !== NASA_ASSET_HOST || !['http:', 'https:'].includes(url.protocol)) return undefined;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function searchNasaMarsVideos(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<NasaMarsVideoSearchPage> {
  const cacheKey = `${query.trim().toLocaleLowerCase()}|${page}`;
  const cached = readCache(searchCache, cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ q: query, media_type: 'video', page_size: '12', page: String(page) });
  const payload = await fetchJson(`${NASA_API_ROOT}/search?${params}`, 'NASA video search', signal);
  const collection = isRecord(payload) && isRecord(payload.collection) ? payload.collection : null;
  if (!collection || !Array.isArray(collection.items)) {
    throw new NasaMarsVideoError('NASA video search returned an unexpected response.');
  }

  const videos: NasaMarsVideo[] = [];
  for (const item of collection.items) {
    if (!isRecord(item) || !Array.isArray(item.data)) continue;
    const metadata = item.data.find(isRecord);
    if (!metadata || metadata.media_type !== 'video') continue;
    const nasaId = boundedText(metadata.nasa_id, 500);
    const title = boundedText(metadata.title, 1_000);
    if (!nasaId || !title) continue;
    const links = Array.isArray(item.links) ? item.links : [];
    const thumbnail = links
      .filter(isRecord)
      .find((link) => link.render === 'image' && (link.rel === 'preview' || !link.rel));
    videos.push({
      nasaId,
      title,
      description: boundedText(metadata.description),
      dateCreated: boundedText(metadata.date_created, 100),
      center: boundedText(metadata.center, 100),
      credit: boundedText(metadata.photographer, 500) ?? boundedText(metadata.secondary_creator, 500),
      thumbnailUrl: nasaAssetUrl(thumbnail?.href),
      externalUrl: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
    });
  }

  const metadata = isRecord(collection.metadata) ? collection.metadata : {};
  const result = { videos, totalHits: numberValue(metadata.total_hits), page };
  writeCache(searchCache, cacheKey, result);
  return result;
}

export async function fetchNasaMarsVideoFiles(
  nasaId: string,
  signal?: AbortSignal,
): Promise<NasaMarsVideoFile[]> {
  if (!nasaId || nasaId.length > 500) throw new NasaMarsVideoError('NASA video ID is invalid.');
  const cached = readCache(manifestCache, nasaId);
  if (cached) return cached;

  const url = `${NASA_API_ROOT}/asset/${encodeURIComponent(nasaId)}`;
  const payload = await fetchJson(url, 'NASA video manifest', signal);
  const collection = isRecord(payload) && isRecord(payload.collection) ? payload.collection : null;
  if (!collection || !Array.isArray(collection.items)) {
    throw new NasaMarsVideoError('NASA returned an unexpected video manifest.');
  }

  const files: NasaMarsVideoFile[] = [];
  const seen = new Set<string>();
  for (const item of collection.items) {
    if (!isRecord(item)) continue;
    const rawUrl = boundedText(item.href, 2_000);
    const safeUrl = nasaAssetUrl(rawUrl);
    if (!safeUrl || !/\.mp4(?:$|[?#])/i.test(safeUrl) || seen.has(safeUrl)) continue;
    seen.add(safeUrl);
    const fileSize = numberValue(item.size);
    files.push({ url: safeUrl, ...(fileSize === null ? {} : { fileSize }) });
  }
  writeCache(manifestCache, nasaId, files);
  return files;
}
