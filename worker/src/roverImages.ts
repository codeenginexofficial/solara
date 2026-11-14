/**
 * NASA Perseverance raw-image feed proxy.
 *
 * The upstream destination is fixed to NASA's Mars 2020 feed. Query values
 * are validated before they are translated to NASA's feed parameters; this
 * module is not a general URL proxy.
 */

export type RoverImageResolution = 'small' | 'medium' | 'large' | 'full_res';

export interface RoverImageFiles {
  small?: string;
  medium?: string;
  large?: string;
  full_res?: string;
}

/** NASA raw-feed fields retained verbatim; their tuple frames are not map coordinates. */
export interface RoverImageSourceMetadata {
  site?: string;
  drive?: string;
  sampleType?: string;
  sclk?: string;
  mastAz?: string;
  mastEl?: string;
  xyz?: string;
  attitude?: string;
  filterName?: string;
  cameraPosition?: string;
  cameraVector?: string;
  cameraModelType?: string;
  cameraModelComponentList?: string;
}

export interface PerseveranceImage {
  imageId: string;
  sol?: number;
  instrument?: string;
  title?: string;
  caption?: string;
  dateTakenUtc?: string;
  dateTakenMars?: string;
  dateReceived?: string;
  sourceMetadata: RoverImageSourceMetadata;
  credit?: string;
  sourceLink?: string;
  imageFiles: RoverImageFiles;
}

export interface PerseveranceImagePage {
  source: {
    provider: 'NASA Mars raw images feed';
    endpoint: string;
    mission: 'mars2020';
    fetchedAt: string;
  };
  page: number;
  limit: number;
  totalResults: number | null;
  totalImages: number | null;
  images: PerseveranceImage[];
  cacheStatus: 'fresh' | 'cached' | 'stale';
  staleReason?: 'timeout' | 'upstream-unavailable' | 'invalid-response';
}

const NASA_RAW_IMAGES_ENDPOINT = 'https://mars.nasa.gov/rss/api/';
const NASA_RAW_IMAGES_SOURCE =
  'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=50&page=0&order=sol+desc';
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 64;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_PAGE = 100_000;
const MAX_SOL = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

const IMAGE_RESOLUTIONS: readonly RoverImageResolution[] = [
  'small',
  'medium',
  'large',
  'full_res',
];

/** Camera codes requested for the Perseverance gallery, matching NASA feed values. */
const CAMERA_CODES = new Set([
  'NAVCAM_LEFT',
  'NAVCAM_RIGHT',
  'FRONT_HAZCAM_LEFT_A',
  'REAR_HAZCAM_LEFT',
  'MCZ_LEFT',
  'MCZ_RIGHT',
  'SUPERCAM_RMI',
  'SHERLOC_WATSON',
  'PIXL_MCC',
  'SKYCAM',
  'CACHECAM',
]);

interface CacheEntry {
  page: PerseveranceImagePage;
  expiresAt: number;
  staleUntil: number;
}

interface ImageQuery {
  page: number;
  limit: number;
  sol?: number;
  camera?: string;
  refresh: boolean;
}

const responseCache = new Map<string, CacheEntry>();

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function fail(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function sourceScalar(value: unknown, maxLength = 1_000): string | undefined {
  if (typeof value === 'string') return boundedString(value, maxLength);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) || isRecord(value)) {
    try {
      return boundedString(JSON.stringify(value), maxLength);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function countValue(value: unknown): number | null {
  return nonNegativeInteger(value) ?? null;
}

function safeNasaUrl(value: unknown): string | undefined {
  const raw = boundedString(value, 2_000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'mars.nasa.gov') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeImage(value: unknown): PerseveranceImage | null {
  if (!isRecord(value)) return null;
  const imageId = boundedString(value.imageid, 180);
  if (!imageId || !/^[A-Za-z0-9_-]+$/.test(imageId)) return null;

  const camera = isRecord(value.camera) ? value.camera : undefined;
  const extended = isRecord(value.extended) ? value.extended : undefined;
  const rawFiles = isRecord(value.image_files) ? value.image_files : undefined;
  const imageFiles: RoverImageFiles = {};
  if (rawFiles) {
    for (const resolution of IMAGE_RESOLUTIONS) {
      const url = safeNasaUrl(rawFiles[resolution]);
      if (url) imageFiles[resolution] = url;
    }
  }

  const sourceMetadata: RoverImageSourceMetadata = {
    site: sourceScalar(value.site, 100),
    drive: sourceScalar(value.drive, 100),
    sampleType: sourceScalar(value.sample_type, 100),
    sclk: sourceScalar(extended?.sclk, 100),
    mastAz: sourceScalar(extended?.mastAz, 100),
    mastEl: sourceScalar(extended?.mastEl, 100),
    xyz: sourceScalar(extended?.xyz, 500),
    attitude: sourceScalar(value.attitude, 500),
    filterName: sourceScalar(camera?.filter_name, 100),
    cameraPosition: sourceScalar(camera?.camera_position, 1_000),
    cameraVector: sourceScalar(camera?.camera_vector, 1_000),
    cameraModelType: sourceScalar(camera?.camera_model_type, 100),
    cameraModelComponentList: sourceScalar(camera?.camera_model_component_list, 4_000),
  };
  for (const [key, item] of Object.entries(sourceMetadata)) {
    if (item === undefined) delete sourceMetadata[key as keyof RoverImageSourceMetadata];
  }

  return {
    imageId,
    sol: nonNegativeInteger(value.sol),
    instrument: boundedString(camera?.instrument, 100),
    title: boundedString(value.title, 500),
    caption: boundedString(value.caption),
    dateTakenUtc: boundedString(value.date_taken_utc, 100),
    dateTakenMars: boundedString(value.date_taken_mars, 100),
    dateReceived: boundedString(value.date_received, 100),
    sourceMetadata,
    credit: boundedString(value.credit, 500),
    sourceLink: safeNasaUrl(value.link),
    imageFiles,
  };
}

function parseQuery(url: URL): ImageQuery | Response {
  const accepted = new Set(['page', 'limit', 'sol', 'camera', 'refresh']);
  for (const key of url.searchParams.keys()) {
    if (!accepted.has(key)) {
      return fail('invalid-query', `Unsupported query parameter: ${key}.`, 400);
    }
    if (url.searchParams.getAll(key).length > 1) {
      return fail('invalid-query', `Query parameter ${key} must appear once.`, 400);
    }
  }

  const parseBoundedInteger = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number | Response => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) {
      return fail('invalid-query', `${key} must be a whole number from ${min} to ${max}.`, 400);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      return fail('invalid-query', `${key} must be a whole number from ${min} to ${max}.`, 400);
    }
    return value;
  };

  const page = parseBoundedInteger('page', 0, 0, MAX_PAGE);
  if (page instanceof Response) return page;
  const limit = parseBoundedInteger('limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit instanceof Response) return limit;
  const rawSol = url.searchParams.get('sol');
  const sol = rawSol === null ? undefined : parseBoundedInteger('sol', 0, 0, MAX_SOL);
  if (sol instanceof Response) return sol;

  const rawCamera = url.searchParams.get('camera');
  if (rawCamera !== null && !CAMERA_CODES.has(rawCamera)) {
    return fail('invalid-query', 'camera must be one of the supported NASA camera codes.', 400);
  }

  const rawRefresh = url.searchParams.get('refresh');
  if (rawRefresh !== null && rawRefresh !== 'true' && rawRefresh !== 'false') {
    return fail('invalid-query', 'refresh must be true or false.', 400);
  }

  return {
    page,
    limit,
    ...(sol === undefined ? {} : { sol }),
    ...(rawCamera === null ? {} : { camera: rawCamera }),
    refresh: rawRefresh === 'true',
  };
}

function cacheKey(query: ImageQuery): string {
  return `${query.page}|${query.limit}|${query.sol ?? ''}|${query.camera ?? ''}`;
}

function withCacheStatus(
  page: PerseveranceImagePage,
  cacheStatus: PerseveranceImagePage['cacheStatus'],
  staleReason?: PerseveranceImagePage['staleReason'],
): PerseveranceImagePage {
  return {
    ...page,
    cacheStatus,
    ...(staleReason ? { staleReason } : {}),
  };
}

function cacheResponse(page: PerseveranceImagePage, status: 'cached' | 'stale'): Response {
  return json(withCacheStatus(page, status), 200, { 'x-solara-cache': status.toUpperCase() });
}

function storeCache(key: string, page: PerseveranceImagePage, now: number): void {
  if (!responseCache.has(key) && responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = [...responseCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]?.[0];
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, {
    page,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + CACHE_TTL_MS + STALE_TTL_MS,
  });
}

function nasaListUrl(query: ImageQuery): URL {
  const url = new URL(NASA_RAW_IMAGES_ENDPOINT);
  url.searchParams.set('feed', 'raw_images');
  url.searchParams.set('category', 'mars2020');
  url.searchParams.set('feedtype', 'json');
  url.searchParams.set('num', String(query.limit));
  url.searchParams.set('page', String(query.page));
  url.searchParams.set('order', 'sol desc');
  if (query.sol !== undefined) url.searchParams.set('sol', String(query.sol));
  if (query.camera) url.searchParams.set('search', `|${query.camera}|`);
  return url;
}

async function fetchJson(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('upstream-unavailable');
    try {
      return await response.json();
    } catch {
      throw new Error('invalid-response');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('timeout');
    if (
      error instanceof Error &&
      (error.message === 'upstream-unavailable' || error.message === 'invalid-response')
    ) {
      throw error;
    }
    throw new Error('upstream-unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function normalizePage(value: unknown, query: ImageQuery, fetchedAt: string): PerseveranceImagePage {
  if (!isRecord(value) || !Array.isArray(value.images)) {
    throw new Error('invalid-response');
  }
  const images = value.images
    .map(normalizeImage)
    .filter((image): image is PerseveranceImage => image !== null);
  return {
    source: {
      provider: 'NASA Mars raw images feed',
      endpoint: NASA_RAW_IMAGES_SOURCE,
      mission: 'mars2020',
      fetchedAt,
    },
    page: query.page,
    limit: query.limit,
    totalResults: countValue(value.total_results),
    totalImages: countValue(value.total_images),
    images,
    cacheStatus: 'fresh',
  };
}

/** Handles GET /api/rovers/perseverance/images. */
export async function handlePerseveranceImages(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseQuery(url);
  if (parsed instanceof Response) return parsed;

  const key = cacheKey(parsed);
  const now = Date.now();
  const cached = responseCache.get(key);
  if (!parsed.refresh && cached && now < cached.expiresAt) {
    return cacheResponse(cached.page, 'cached');
  }

  try {
    const upstream = await fetchJson(nasaListUrl(parsed));
    const page = normalizePage(upstream, parsed, new Date().toISOString());
    storeCache(key, page, Date.now());
    return json(page, 200, { 'x-solara-cache': 'MISS' });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'upstream-unavailable';
    const staleReason: PerseveranceImagePage['staleReason'] =
      reason === 'timeout' ? 'timeout' : reason === 'invalid-response' ? 'invalid-response' : 'upstream-unavailable';
    if (cached && Date.now() < cached.staleUntil) {
      return cacheResponse(withCacheStatus(cached.page, 'stale', staleReason), 'stale');
    }
    if (staleReason === 'timeout') {
      return fail('upstream-timeout', 'NASA’s raw-image feed did not respond before the timeout.', 504);
    }
    if (staleReason === 'invalid-response') {
      return fail('upstream-invalid-response', 'NASA’s raw-image feed returned an invalid response.', 502);
    }
    return fail('upstream-unavailable', 'NASA’s raw-image feed is unavailable right now.', 502);
  }
}

function imageIdFromPath(pathname: string): string | null {
  const match = /^\/api\/rovers\/perseverance\/images\/([A-Za-z0-9_-]{1,180})\/download$/.exec(pathname);
  return match?.[1] ?? null;
}

/** Handles GET /api/rovers/perseverance/images/:imageId/download. */
export async function handlePerseveranceImageDownload(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const imageId = imageIdFromPath(url.pathname);
  if (!imageId) return fail('invalid-image-id', 'Image ID is invalid.', 400);

  for (const key of url.searchParams.keys()) {
    if (key !== 'resolution' || url.searchParams.getAll(key).length > 1) {
      return fail('invalid-query', 'Only one resolution parameter is supported.', 400);
    }
  }

  const rawResolution = url.searchParams.get('resolution') ?? 'full_res';
  if (!IMAGE_RESOLUTIONS.includes(rawResolution as RoverImageResolution)) {
    return fail('invalid-resolution', 'Resolution must be small, medium, large, or full_res.', 400);
  }

  const metadataUrl = new URL(NASA_RAW_IMAGES_ENDPOINT);
  metadataUrl.searchParams.set('feed', 'raw_images');
  metadataUrl.searchParams.set('category', 'mars2020');
  metadataUrl.searchParams.set('feedtype', 'json');
  metadataUrl.searchParams.set('id', imageId);

  let page: unknown;
  try {
    page = await fetchJson(metadataUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'upstream-unavailable';
    if (reason === 'timeout') {
      return fail('upstream-timeout', 'NASA’s image record did not respond before the timeout.', 504);
    }
    if (reason === 'invalid-response') {
      return fail('upstream-invalid-response', 'NASA’s image record returned an invalid response.', 502);
    }
    return fail('upstream-unavailable', 'NASA’s image record is unavailable right now.', 502);
  }

  const imageRecords = isRecord(page)
    ? Array.isArray(page.images)
      ? page.images
      : Array.isArray(page.image)
        ? page.image
        : null
    : null;
  if (!imageRecords) {
    return fail('upstream-invalid-response', 'NASA’s image record returned an invalid response.', 502);
  }
  const image = imageRecords.map(normalizeImage).find((item) => item?.imageId === imageId);
  if (!image) return fail('image-not-found', 'NASA did not return this image ID.', 404);
  const imageUrl = image.imageFiles[rawResolution as RoverImageResolution];
  if (!imageUrl) {
    return fail('resolution-unavailable', 'NASA did not provide this image resolution.', 404);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok || !safeNasaUrl(response.url)) {
      return fail('image-unavailable', 'NASA’s image file is unavailable right now.', 502);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return fail('invalid-image-response', 'NASA returned a non-image response.', 502);
    }
    const extension = contentType.toLowerCase().includes('png') ? 'png' : 'jpg';
    return new Response(response.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-disposition': `attachment; filename="${imageId}.${extension}"`,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return fail(
      controller.signal.aborted ? 'upstream-timeout' : 'image-unavailable',
      controller.signal.aborted
        ? 'NASA’s image file did not respond before the timeout.'
        : 'NASA’s image file is unavailable right now.',
      controller.signal.aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timer);
  }
}
