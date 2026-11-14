/**
 * Client adapter for NASA MEDA environmental observations.
 *
 * Calls the SOLARA backend Worker endpoint GET /api/meda/environment/latest
 * which queries the NASA Planetary Data System (PDS) Atmospheres Node archive.
 *
 * Ol-free; conforms to scientific honesty rules (Context.md §7).
 */

export interface MedaSensorObservation<T = number> {
  value: T | null;
  unit: string;
  sol: number;
  lmst: string;
  ltst: string;
  utcTime: string;
  sensorId: string;
  productType: 'derived' | 'calibrated';
  productFile: string;
  status: 'valid' | 'missing' | 'sensor_unavailable';
  qualityNote?: string;
}

export interface MedaEnvironmentData {
  source: {
    provider: string;
    mission: string;
    instrument: string;
    archiveUrl: string;
    fetchedAt: string;
    fromCache: boolean;
    isLastKnownGood: boolean;
  };
  sensors: {
    airTemperature: MedaSensorObservation & {
      sensorLocation: string;
      rawKelvin: number | null;
    };
    relativeHumidity: MedaSensorObservation;
    pressure: MedaSensorObservation;
    windSpeed: MedaSensorObservation;
    windDirection: MedaSensorObservation;
  };
  errors?: string[];
}

export class MedaServiceError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** In-memory cached result to avoid redundant network queries across component re-renders */
let cachedData: MedaEnvironmentData | null = null;
let lastFetchTime = 0;
const CLIENT_CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory client cache

/**
 * Fetch the latest verified MEDA environmental observations from the Worker proxy.
 */
export async function fetchMedaEnvironment(options?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<MedaEnvironmentData> {
  const now = Date.now();
  if (!options?.forceRefresh && cachedData && now - lastFetchTime < CLIENT_CACHE_TTL_MS) {
    return cachedData;
  }

  const url = options?.forceRefresh
    ? '/api/meda/environment/latest?refresh=true'
    : '/api/meda/environment/latest';

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
    });
  } catch (e) {
    if (cachedData) {
      return {
        ...cachedData,
        source: {
          ...cachedData.source,
          isLastKnownGood: true,
        },
      };
    }
    throw new MedaServiceError(
      `MEDA archive request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    if (cachedData) {
      return {
        ...cachedData,
        source: {
          ...cachedData.source,
          isLastKnownGood: true,
        },
      };
    }
    throw new MedaServiceError(
      `MEDA archive returned HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new MedaServiceError('MEDA archive response was not valid JSON.');
  }

  const data = json as MedaEnvironmentData;
  if (!data?.sensors?.airTemperature || !data?.sensors?.pressure) {
    throw new MedaServiceError('Malformed MEDA environment response structure.');
  }

  cachedData = data;
  lastFetchTime = now;
  return data;
}
