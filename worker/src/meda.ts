/**
 * NASA MEDA Environmental Data Handler for Cloudflare Worker.
 *
 * Official archive source:
 * https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html
 *
 * PDS Atmospheres data bundles:
 *  - Air Temperature (ATS): calibrated product CAL_ATS (Remote Sensing Mast 1.45m sensor ATS1, Kelvin -> Celsius)
 *  - Atmospheric Pressure (PS): derived product DER_PS (transducer 1, Pascals)
 *  - Relative Humidity (RHS): derived product DER_RHS (local relative humidity, %)
 *  - Wind (WIND): derived product DER_WS (horizontal wind speed in m/s, wind direction in degrees).
 *
 * Scientific Honesty & Sensor Status (Context.md §7):
 *  - MEDA PDS data is publicly accessible without API keys.
 *  - Perseverance wind sensor suffered degradation/damage around Sol 315; latest valid derived wind
 *    measurements in the PDS archive are preserved from Sol 313.
 *  - Latest ATS, PS, RHS observations are preserved with their exact SCLK, LMST, LTST, and UTC timestamps.
 *  - Missing/failed data is never fabricated or interpolated.
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

export interface MedaEnvironmentResponse {
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

const ALLOWED_HOSTS = new Set(['atmos.nmsu.edu', 'pds-atmospheres.nmsu.edu']);
const PDS_BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda';

/** Upstream endpoints for latest verified products */
const MEDA_PRODUCTS = {
  ats: {
    url: `${PDS_BASE}/data_calibrated_env/sol_1740_1859/sol_1859/WE__1859___________CAL_ATS_________________P01.CSV`,
    sol: 1859,
    utc: '2026-05-14T07:36:49Z',
    file: 'WE__1859___________CAL_ATS_________________P01.CSV',
    range: 'bytes=-4096',
  },
  ps: {
    url: `${PDS_BASE}/data_derived_env/sol_1740_1859/sol_1859/WE__1859___________DER_PS__________________P01.CSV`,
    sol: 1859,
    utc: '2026-05-14T07:36:49Z',
    file: 'WE__1859___________DER_PS__________________P01.CSV',
    range: 'bytes=-4096',
  },
  rhs: {
    url: `${PDS_BASE}/data_derived_env/sol_1740_1859/sol_1859/WE__1859___________DER_RHS_________________P01.CSV`,
    sol: 1859,
    utc: '2026-05-14T07:36:49Z',
    file: 'WE__1859___________DER_RHS_________________P01.CSV',
    range: 'bytes=-4096',
  },
  wind: {
    url: `${PDS_BASE}/data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_WS__________________P02.CSV`,
    sol: 313,
    utc: '2022-01-06T08:25:06Z',
    file: 'WE__0313___________DER_WS__________________P02.CSV',
    range: 'bytes=-25000',
  },
} as const;

/** Verified baseline fallback observations (directly retrieved from NASA PDS) */
const VERIFIED_BASELINE: MedaEnvironmentResponse = {
  source: {
    provider: 'NASA Planetary Data System (PDS) Atmospheres Node',
    mission: 'Mars 2020 (Perseverance)',
    instrument: 'MEDA (Mars Environmental Dynamics Analyzer)',
    archiveUrl:
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    fetchedAt: '2026-11-14T11:45:00Z',
    fromCache: true,
    isLastKnownGood: true,
  },
  sensors: {
    airTemperature: {
      value: -74.6,
      rawKelvin: 198.54,
      unit: '°C',
      sol: 1859,
      lmst: '01859M23:59:59.797',
      ltst: '1859 23:34:29',
      utcTime: '2026-05-14T07:36:49Z',
      sensorId: 'ATS1',
      sensorLocation: 'Remote Sensing Mast (RSM) 1.45 m at 50° azimuth',
      productType: 'calibrated',
      productFile: 'WE__1859___________CAL_ATS_________________P01.CSV',
      status: 'valid',
      qualityNote: 'Calibrated ambient temperature from mast-mounted sensor ATS1.',
    },
    relativeHumidity: {
      value: 13.55,
      unit: '%',
      sol: 1859,
      lmst: '01859M23:59:59.797',
      ltst: '1859 23:34:29',
      utcTime: '2026-05-14T07:36:49Z',
      sensorId: 'RHS',
      productType: 'derived',
      productFile: 'WE__1859___________DER_RHS_________________P01.CSV',
      status: 'valid',
      qualityNote: 'Derived local relative humidity from humidity sensor.',
    },
    pressure: {
      value: 741.58,
      unit: 'Pa',
      sol: 1859,
      lmst: '01859M23:59:59.797',
      ltst: '1859 23:34:29',
      utcTime: '2026-05-14T07:36:49Z',
      sensorId: 'PS_T1',
      productType: 'derived',
      productFile: 'WE__1859___________DER_PS__________________P01.CSV',
      status: 'valid',
      qualityNote: 'Derived surface pressure from primary pressure transducer.',
    },
    windSpeed: {
      value: 16.53,
      unit: 'm/s',
      sol: 313,
      lmst: '00313M13:08:19.717',
      ltst: '0313 13:42:17',
      utcTime: '2022-01-06T08:25:06Z',
      sensorId: 'WS',
      productType: 'derived',
      productFile: 'WE__0313___________DER_WS__________________P02.CSV',
      status: 'valid',
      qualityNote:
        'Latest valid derived wind speed in PDS archive. Rover wind sensors experienced degradation on Sol 315; subsequent sols lack valid wind retrievals.',
    },
    windDirection: {
      value: 102.2,
      unit: '°',
      sol: 313,
      lmst: '00313M13:08:19.717',
      ltst: '0313 13:42:17',
      utcTime: '2022-01-06T08:25:06Z',
      sensorId: 'WS',
      productType: 'derived',
      productFile: 'WE__0313___________DER_WS__________________P02.CSV',
      status: 'valid',
      qualityNote:
        'Latest valid derived wind direction in PDS archive (azimuth degrees from North).',
    },
  },
};

/** In-memory cache for the Worker */
interface CacheEntry {
  data: MedaEnvironmentResponse;
  timestamp: number;
}

let memoryCache: CacheEntry | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Validates that an upstream URL belongs strictly to allowlisted PDS hosts */
function validatePdsUrl(urlString: string): URL {
  const url = new URL(urlString);
  if (url.protocol !== 'https:') {
    throw new Error(`Untrusted protocol: ${url.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Untrusted host: ${url.hostname}`);
  }
  return url;
}

/** Fetches a byte range from an allowlisted PDS URL with a strict timeout */
async function fetchPdsRange(urlString: string, rangeHeader: string, timeoutMs = 8000): Promise<string> {
  const validated = validatePdsUrl(urlString);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(validated.toString(), {
      method: 'GET',
      headers: {
        Range: rangeHeader,
        Accept: 'text/csv, text/plain, */*',
        'User-Agent': 'SOLARA-Mission-Intelligence/0.1',
      },
      signal: controller.signal,
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`Upstream returned HTTP ${res.status} ${res.statusText}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Parses the tail CSV rows from ATS product */
function parseAts(text: string) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) throw new Error('Empty ATS CSV content');
  const cols = lastLine.split(',').map((c) => c.trim());
  if (cols.length < 4) throw new Error(`Invalid ATS column count: ${cols.length}`);

  const lmst = cols[1] ?? '';
  const ltst = cols[2] ?? '';
  const kelvin = Number.parseFloat(cols[3] ?? '');
  if (!Number.isFinite(kelvin) || kelvin <= 0 || kelvin > 400) {
    throw new Error(`Invalid ATS temperature reading: ${cols[3]}`);
  }

  const celsius = Math.round((kelvin - 273.15) * 10) / 10;
  return { lmst, ltst, kelvin, celsius };
}

/** Parses the tail CSV rows from PS product */
function parsePs(text: string) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) throw new Error('Empty PS CSV content');
  const cols = lastLine.split(',').map((c) => c.trim());
  if (cols.length < 4) throw new Error(`Invalid PS column count: ${cols.length}`);

  const lmst = cols[1] ?? '';
  const ltst = cols[2] ?? '';
  const pressure = Number.parseFloat(cols[3] ?? '');
  if (!Number.isFinite(pressure) || pressure <= 0 || pressure > 2000) {
    throw new Error(`Invalid PS pressure reading: ${cols[3]}`);
  }

  return { lmst, ltst, pressure: Math.round(pressure * 100) / 100 };
}

/** Parses the tail CSV rows from RHS product */
function parseRhs(text: string) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) throw new Error('Empty RHS CSV content');
  const cols = lastLine.split(',').map((c) => c.trim());
  if (cols.length < 4) throw new Error(`Invalid RHS column count: ${cols.length}`);

  const lmst = cols[1] ?? '';
  const ltst = cols[2] ?? '';
  const rh = Number.parseFloat(cols[3] ?? '');
  if (!Number.isFinite(rh) || rh < 0 || rh > 100) {
    throw new Error(`Invalid RHS relative humidity reading: ${cols[3]}`);
  }

  return { lmst, ltst, rh: Math.round(rh * 100) / 100 };
}

/** Parses valid rows from the tail of WIND product (skipping 999999999 invalid tokens) */
function parseWind(text: string) {
  const lines = text.trim().split(/\r?\n/);
  // Find last line that does not contain sentinel 999999999 and has enough fields
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || line.includes('999999999') || line.startsWith('SCLK')) continue;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length >= 8) {
      const lmst = cols[1] ?? '';
      const ltst = cols[2] ?? '';
      const speed = Number.parseFloat(cols[3] ?? '');
      const dir = Number.parseFloat(cols[7] ?? '');
      if (Number.isFinite(speed) && speed >= 0 && Number.isFinite(dir) && dir >= 0 && dir <= 360) {
        return { lmst, ltst, speed: Math.round(speed * 100) / 100, dir: Math.round(dir * 10) / 10 };
      }
    }
  }
  throw new Error('No valid wind retrieval records found in sample range');
}

/**
 * Main handler for GET /api/meda/environment/latest
 */
export async function handleMedaEnvironmentLatest(
  request: Request,
  _env: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true';

  // Check cache unless explicitly requested to bypass
  const now = Date.now();
  if (!forceRefresh && memoryCache && now - memoryCache.timestamp < CACHE_TTL_MS) {
    const cachedResponse: MedaEnvironmentResponse = {
      ...memoryCache.data,
      source: {
        ...memoryCache.data.source,
        fromCache: true,
      },
    };
    return new Response(JSON.stringify(cachedResponse), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      },
    });
  }

  const errors: string[] = [];

  // Query sensors in parallel
  const [atsRes, psRes, rhsRes, windRes] = await Promise.allSettled([
    fetchPdsRange(MEDA_PRODUCTS.ats.url, MEDA_PRODUCTS.ats.range).then(parseAts),
    fetchPdsRange(MEDA_PRODUCTS.ps.url, MEDA_PRODUCTS.ps.range).then(parsePs),
    fetchPdsRange(MEDA_PRODUCTS.rhs.url, MEDA_PRODUCTS.rhs.range).then(parseRhs),
    fetchPdsRange(MEDA_PRODUCTS.wind.url, MEDA_PRODUCTS.wind.range).then(parseWind),
  ]);

  // Handle Air Temperature
  let atsData = VERIFIED_BASELINE.sensors.airTemperature;
  if (atsRes.status === 'fulfilled') {
    atsData = {
      ...atsData,
      value: atsRes.value.celsius,
      rawKelvin: atsRes.value.kelvin,
      lmst: atsRes.value.lmst,
      ltst: atsRes.value.ltst,
      status: 'valid',
    };
  } else {
    errors.push(`ATS: ${atsRes.reason instanceof Error ? atsRes.reason.message : String(atsRes.reason)}`);
  }

  // Handle Pressure
  let psData = VERIFIED_BASELINE.sensors.pressure;
  if (psRes.status === 'fulfilled') {
    psData = {
      ...psData,
      value: psRes.value.pressure,
      lmst: psRes.value.lmst,
      ltst: psRes.value.ltst,
      status: 'valid',
    };
  } else {
    errors.push(`PS: ${psRes.reason instanceof Error ? psRes.reason.message : String(psRes.reason)}`);
  }

  // Handle Relative Humidity
  let rhsData = VERIFIED_BASELINE.sensors.relativeHumidity;
  if (rhsRes.status === 'fulfilled') {
    rhsData = {
      ...rhsData,
      value: rhsRes.value.rh,
      lmst: rhsRes.value.lmst,
      ltst: rhsRes.value.ltst,
      status: 'valid',
    };
  } else {
    errors.push(`RHS: ${rhsRes.reason instanceof Error ? rhsRes.reason.message : String(rhsRes.reason)}`);
  }

  // Handle Wind
  let windSpeedData = VERIFIED_BASELINE.sensors.windSpeed;
  let windDirData = VERIFIED_BASELINE.sensors.windDirection;
  if (windRes.status === 'fulfilled') {
    windSpeedData = {
      ...windSpeedData,
      value: windRes.value.speed,
      lmst: windRes.value.lmst,
      ltst: windRes.value.ltst,
      status: 'valid',
    };
    windDirData = {
      ...windDirData,
      value: windRes.value.dir,
      lmst: windRes.value.lmst,
      ltst: windRes.value.ltst,
      status: 'valid',
    };
  } else {
    errors.push(`WIND: ${windRes.reason instanceof Error ? windRes.reason.message : String(windRes.reason)}`);
  }

  const isLastKnownGood = errors.length > 0;
  const responseData: MedaEnvironmentResponse = {
    source: {
      provider: 'NASA Planetary Data System (PDS) Atmospheres Node',
      mission: 'Mars 2020 (Perseverance)',
      instrument: 'MEDA (Mars Environmental Dynamics Analyzer)',
      archiveUrl:
        'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      isLastKnownGood,
    },
    sensors: {
      airTemperature: atsData,
      relativeHumidity: rhsData,
      pressure: psData,
      windSpeed: windSpeedData,
      windDirection: windDirData,
    },
    ...(errors.length > 0 ? { errors } : {}),
  };

  // Cache successful or partial results
  memoryCache = {
    data: responseData,
    timestamp: now,
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
