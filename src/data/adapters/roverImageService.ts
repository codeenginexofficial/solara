/** Client adapter for the fixed NASA Perseverance raw-image Worker routes. */

export type RoverImageResolution = 'small' | 'medium' | 'large' | 'full_res';

export interface RoverImageFiles {
  small?: string;
  medium?: string;
  large?: string;
  full_res?: string;
}

/** Raw NASA fields preserved without interpreting their coordinate frames. */
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
    provider: string;
    endpoint: string;
    mission: string;
    fetchedAt: string;
  };
  page: number;
  limit: number;
  totalResults: number | null;
  totalImages: number | null;
  images: PerseveranceImage[];
  cacheStatus: 'fresh' | 'cached' | 'stale';
  staleReason?: string;
}

export interface PerseveranceImageQuery {
  page: number;
  limit: number;
  sol?: number;
  camera?: string;
  refresh?: boolean;
}

export type RoverImageServiceErrorCode =
  | 'network-error'
  | 'invalid-response'
  | 'invalid-query'
  | 'upstream-timeout'
  | 'upstream-unavailable'
  | 'upstream-invalid-response'
  | 'image-not-found'
  | 'resolution-unavailable'
  | 'image-unavailable';

export class RoverImageServiceError extends Error {
  readonly code: RoverImageServiceErrorCode;

  constructor(code: RoverImageServiceErrorCode, message: string) {
    super(message);
    this.name = 'RoverImageServiceError';
    this.code = code;
  }
}

const IMAGE_RESOLUTIONS: readonly RoverImageResolution[] = [
  'small',
  'medium',
  'large',
  'full_res',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

function parseSourceMetadata(value: unknown): RoverImageSourceMetadata {
  if (!isRecord(value)) return {};
  const metadata: RoverImageSourceMetadata = {};
  const fields: Array<[keyof RoverImageSourceMetadata, number]> = [
    ['site', 100],
    ['drive', 100],
    ['sampleType', 100],
    ['sclk', 100],
    ['mastAz', 100],
    ['mastEl', 100],
    ['xyz', 500],
    ['attitude', 500],
    ['filterName', 100],
    ['cameraPosition', 1_000],
    ['cameraVector', 1_000],
    ['cameraModelType', 100],
    ['cameraModelComponentList', 4_000],
  ];
  for (const [key, maxLength] of fields) {
    const parsed = optionalString(value[key], maxLength);
    if (parsed) metadata[key] = parsed;
  }
  return metadata;
}

function optionalCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isNasaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'mars.nasa.gov';
  } catch {
    return false;
  }
}

function parseImage(value: unknown): PerseveranceImage | null {
  if (!isRecord(value)) return null;
  const imageId = optionalString(value.imageId, 180);
  if (!imageId || !/^[A-Za-z0-9_-]+$/.test(imageId)) return null;
  const rawFiles = isRecord(value.imageFiles) ? value.imageFiles : {};
  const imageFiles: RoverImageFiles = {};
  for (const resolution of IMAGE_RESOLUTIONS) {
    const file = rawFiles[resolution];
    if (isNasaUrl(file)) imageFiles[resolution] = file;
  }

  return {
    imageId,
    ...(typeof value.sol === 'number' && Number.isSafeInteger(value.sol) && value.sol >= 0
      ? { sol: value.sol }
      : {}),
    instrument: optionalString(value.instrument, 100),
    title: optionalString(value.title, 500),
    caption: optionalString(value.caption),
    dateTakenUtc: optionalString(value.dateTakenUtc, 100),
    dateTakenMars: optionalString(value.dateTakenMars, 100),
    dateReceived: optionalString(value.dateReceived, 100),
    sourceMetadata: parseSourceMetadata(value.sourceMetadata),
    credit: optionalString(value.credit, 500),
    sourceLink: isNasaUrl(value.sourceLink) ? value.sourceLink : undefined,
    imageFiles,
  };
}

function parsePage(value: unknown): PerseveranceImagePage {
  if (!isRecord(value) || !isRecord(value.source) || !Array.isArray(value.images)) {
    throw new RoverImageServiceError(
      'invalid-response',
      'NASA returned an unexpected rover image response.',
    );
  }
  const page = optionalCount(value.page);
  const limit = optionalCount(value.limit);
  const fetchedAt = optionalString(value.source.fetchedAt, 100);
  const cacheStatus = value.cacheStatus;
  if (
    page === null ||
    limit === null ||
    !fetchedAt ||
    (cacheStatus !== 'fresh' && cacheStatus !== 'cached' && cacheStatus !== 'stale')
  ) {
    throw new RoverImageServiceError(
      'invalid-response',
      'NASA returned incomplete rover image results.',
    );
  }
  return {
    source: {
      provider: optionalString(value.source.provider, 200) ?? 'NASA Mars raw images feed',
      endpoint: isNasaUrl(value.source.endpoint)
        ? value.source.endpoint
        : 'https://mars.nasa.gov/mars2020/multimedia/raw-images/',
      mission: optionalString(value.source.mission, 100) ?? 'mars2020',
      fetchedAt,
    },
    page,
    limit,
    totalResults: optionalCount(value.totalResults),
    totalImages: optionalCount(value.totalImages),
    images: value.images
      .map(parseImage)
      .filter((image): image is PerseveranceImage => image !== null),
    cacheStatus,
    staleReason: optionalString(value.staleReason, 100),
  };
}

function isServiceErrorCode(value: unknown): value is RoverImageServiceErrorCode {
  return (
    value === 'network-error' ||
    value === 'invalid-response' ||
    value === 'invalid-query' ||
    value === 'upstream-timeout' ||
    value === 'upstream-unavailable' ||
    value === 'upstream-invalid-response' ||
    value === 'image-not-found' ||
    value === 'resolution-unavailable' ||
    value === 'image-unavailable'
  );
}

export async function fetchPerseveranceImages(
  query: PerseveranceImageQuery,
  signal?: AbortSignal,
): Promise<PerseveranceImagePage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
  });
  if (query.sol !== undefined) params.set('sol', String(query.sol));
  if (query.camera) params.set('camera', query.camera);
  if (query.refresh) params.set('refresh', 'true');

  let response: Response;
  try {
    response = await fetch(`/api/rovers/perseverance/images?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RoverImageServiceError(
      'network-error',
      'Could not reach the NASA rover image service.',
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RoverImageServiceError(
      'invalid-response',
      'The rover image service returned an unreadable response.',
    );
  }

  if (!response.ok) {
    const error = isRecord(payload) ? payload.error : undefined;
    const message = isRecord(payload) ? optionalString(payload.message, 500) : undefined;
    throw new RoverImageServiceError(
      isServiceErrorCode(error) ? error : 'invalid-response',
      message ?? 'NASA rover images are unavailable right now.',
    );
  }

  return parsePage(payload);
}

export function roverImageDownloadUrl(
  imageId: string,
  resolution: RoverImageResolution,
): string {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(imageId)) {
    throw new RoverImageServiceError('invalid-response', 'NASA returned an invalid image ID.');
  }
  const params = new URLSearchParams({ resolution });
  return `/api/rovers/perseverance/images/${encodeURIComponent(imageId)}/download?${params}`;
}
