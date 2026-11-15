/**
 * Server-side DEM point sampling from the verified NASA Trek ImageServer.
 *
 * Source (verified live 2026-11-15):
 *   Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw ImageServer
 *   https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer
 *
 * Evidence:
 *  - ImageServer metadata: pixelSizeX/Y = 0.00337412083064107°; extent lon
 *    -180 … 179.9984479044183, lat -89.99922395220915 … 90; pixelType S16.
 *  - identify at (77.42982, 18.46611) → value "-2520" (metres, areoid).
 *    Neighbour values at ±1 pixel: N -2508, S -2534, E -2536, W -2499.
 *  - NoData is returned as the string "NoData" (verified at lon 179.999 /
 *    lat 0, lat 0 / -90, and lat 0 / 89.999).
 *
 * The service is the same dataset the app catalog records as
 * `mola-hrsc-blend-200m-dem`; this module reuses that catalog record for the
 * query URL, extent, and published limitations. It is deliberately ol-free
 * and framework-free so the Worker can call it from a tool dispatcher.
 *
 * Honesty rules:
 *  - Outside the declared extent: `outside_coverage`, no request is made.
 *  - NoData: `no_data`, elevation null. Never zero.
 *  - Request failure: `unavailable`, elevation null.
 *  - ~200 m/px regional terrain; not hazard-grade. Values are derived from a
 *    2018 blend registered to MOLA (1999–2001), not current observations.
 */

import { MOLA_HRSC_BLEND_DEM_DATASET } from '../../../src/data/catalog/datasets';
import { MARS_SPHERE_RADIUS_M } from '../../../src/science/terrain/geometry';
import type {
  CoordinateServiceStatus,
  ElevationDatasetMetadata,
  MarsPlanetocentricPoint,
  ServiceProvenance,
  TerrainElevationResult,
} from './contracts';

/** Native ImageServer pixel size, verified from live metadata 2026-11-15. */
export const DEM_PIXEL_SIZE_DEG = 0.00337412083064107;

/** Exact verified identify endpoint used by every DEM query. */
export const DEM_IDENTIFY_URL =
  MOLA_HRSC_BLEND_DEM_DATASET.queryEndpoint ?? MOLA_HRSC_BLEND_DEM_DATASET.sourceUrl;

const QUERY_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 512;
const NO_DATA_STRING = /^nodata$/i;

export interface RawDemSample {
  status: CoordinateServiceStatus;
  elevationM: number | null;
  fetchedAt: string;
  fromCache: boolean;
  errorMessage?: string;
}

interface CacheEntry {
  sample: RawDemSample;
  expiresAt: number;
}

const identifyCache = new Map<string, CacheEntry>();

export const DEM_DATASET_METADATA: ElevationDatasetMetadata = {
  datasetId: MOLA_HRSC_BLEND_DEM_DATASET.id,
  title: MOLA_HRSC_BLEND_DEM_DATASET.title,
  provider: MOLA_HRSC_BLEND_DEM_DATASET.provider,
  dataClass: 'derived',
  verticalReference:
    'Mars areoid (MOLA reference). The MOLA+HRSC blend is registered to MOLA topography; treat as derived, not a raw laser shot.',
  nominalResolutionMPerPixel: 200,
  pixelSizeDeg: DEM_PIXEL_SIZE_DEG,
  uncertaintyNote:
    'Total elevation uncertainty is at least ±3 m (areoid ±1.8 m). Blending artifacts can occur where HRSC and MOLA disagree.',
  observationPeriod:
    MOLA_HRSC_BLEND_DEM_DATASET.observationPeriod ?? 'MOLA laser points 1999–2001; blend published 2018',
  limitations: [...MOLA_HRSC_BLEND_DEM_DATASET.limitations],
};

/** Rounding used for the in-memory identify cache (five decimal places). */
function cacheKey(longitudeEastDeg: number, latitudePlanetocentricDeg: number): string {
  return `${longitudeEastDeg.toFixed(5)},${latitudePlanetocentricDeg.toFixed(5)}`;
}

function planetocentricPoint(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
): MarsPlanetocentricPoint {
  return {
    longitudeEastDeg,
    latitudePlanetocentricDeg,
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT',
  };
}

function isFiniteCoordinate(longitudeEastDeg: number, latitudePlanetocentricDeg: number): boolean {
  return Number.isFinite(longitudeEastDeg) && Number.isFinite(latitudePlanetocentricDeg);
}

/** Declared service extent from the catalog (query coverage), not tile coverage. */
function isInsideDemExtent(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
): boolean {
  const bbox = MOLA_HRSC_BLEND_DEM_DATASET.boundingBox;
  if (!bbox) return true;
  return (
    longitudeEastDeg >= bbox.westLon &&
    longitudeEastDeg <= bbox.eastLon &&
    latitudePlanetocentricDeg >= bbox.southLat &&
    latitudePlanetocentricDeg <= bbox.northLat
  );
}

async function fetchIdentify(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  signal?: AbortSignal,
): Promise<RawDemSample> {
  const endpoint = MOLA_HRSC_BLEND_DEM_DATASET.queryEndpoint;
  const fetchedAt = new Date().toISOString();
  if (!endpoint) {
    return {
      status: 'unavailable',
      elevationM: null,
      fetchedAt,
      fromCache: false,
      errorMessage: 'The DEM catalog record has no query endpoint configured.',
    };
  }

  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({
      x: longitudeEastDeg,
      y: latitudePlanetocentricDeg,
      spatialReference: { wkid: 104905 },
    }),
    geometryType: 'esriGeometryPoint',
    sr: '104905',
    returnGeometry: 'false',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: 'unavailable',
        elevationM: null,
        fetchedAt,
        fromCache: false,
        errorMessage: `DEM identify returned HTTP ${response.status} ${response.statusText}.`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        status: 'unavailable',
        elevationM: null,
        fetchedAt,
        fromCache: false,
        errorMessage: 'DEM identify returned a non-JSON response.',
      };
    }

    const record = body as { value?: unknown; error?: { message?: unknown } };
    if (record.error) {
      const message =
        typeof record.error.message === 'string' ? record.error.message : 'unknown ArcGIS error';
      return {
        status: 'unavailable',
        elevationM: null,
        fetchedAt,
        fromCache: false,
        errorMessage: `DEM identify failed: ${message}`,
      };
    }

    const value = record.value;
    if (typeof value === 'string' && NO_DATA_STRING.test(value.trim())) {
      return { status: 'no_data', elevationM: null, fetchedAt, fromCache: false };
    }

    const elevation =
      typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
    if (!Number.isFinite(elevation)) {
      return {
        status: 'unavailable',
        elevationM: null,
        fetchedAt,
        fromCache: false,
        errorMessage: `DEM identify returned an unexpected value: ${String(value)}.`,
      };
    }

    return { status: 'available', elevationM: elevation, fetchedAt, fromCache: false };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      status: 'unavailable',
      elevationM: null,
      fetchedAt,
      fromCache: false,
      errorMessage: aborted
        ? 'DEM identify request timed out or was aborted.'
        : `DEM identify request failed: ${error instanceof Error ? error.message : String(error)}.`,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Low-level DEM identify with a short in-memory cache. Returns a structured
 * status instead of throwing for expected conditions. Invalid or off-planet
 * coordinates are rejected without a network request.
 */
export async function identifyDemElevation(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  options: { signal?: AbortSignal; bypassCache?: boolean } = {},
): Promise<RawDemSample> {
  if (!isFiniteCoordinate(longitudeEastDeg, latitudePlanetocentricDeg)) {
    return {
      status: 'unavailable',
      elevationM: null,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      errorMessage: 'The coordinate must contain finite longitude and latitude values.',
    };
  }
  if (
    latitudePlanetocentricDeg < -90 ||
    latitudePlanetocentricDeg > 90 ||
    longitudeEastDeg < -180 ||
    longitudeEastDeg > 180
  ) {
    return {
      status: 'outside_coverage',
      elevationM: null,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      errorMessage: 'The coordinate is outside the Mars planetocentric domain.',
    };
  }
  if (!isInsideDemExtent(longitudeEastDeg, latitudePlanetocentricDeg)) {
    return {
      status: 'outside_coverage',
      elevationM: null,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      errorMessage:
        'The coordinate is outside the DEM service declared extent (lon -180…179.9984, lat -89.9992…90).',
    };
  }

  const key = cacheKey(longitudeEastDeg, latitudePlanetocentricDeg);
  if (!options.bypassCache) {
    const entry = identifyCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return { ...entry.sample, fromCache: true };
    }
    if (entry) identifyCache.delete(key);
  }

  let sample = await fetchIdentify(longitudeEastDeg, latitudePlanetocentricDeg, options.signal);
  // Trek's public service intermittently drops individual identify requests
  // (observed 2026-11-15). One retry improves reliability without hiding a
  // persistent failure: the second result is reported as-is.
  if (sample.status === 'unavailable' && !options.signal?.aborted) {
    sample = await fetchIdentify(longitudeEastDeg, latitudePlanetocentricDeg, options.signal);
  }
  if (sample.status === 'available' || sample.status === 'no_data') {
    if (!identifyCache.has(key) && identifyCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...identifyCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]?.[0];
      if (oldest) identifyCache.delete(oldest);
    }
    identifyCache.set(key, { sample, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return sample;
}

function provenance(sample: RawDemSample): ServiceProvenance {
  return {
    provider: MOLA_HRSC_BLEND_DEM_DATASET.provider,
    datasetId: MOLA_HRSC_BLEND_DEM_DATASET.id,
    sourceUrl: DEM_IDENTIFY_URL,
    retrievedAt: sample.fetchedAt,
    spatialResolutionM: 200,
    method: 'ArcGIS ImageServer identify (point, nearest pixel)',
    fromCache: sample.fromCache,
  };
}

/** `get_terrain_elevation` service: one DEM point with provenance and status. */
export async function getTerrainElevation(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  options: { signal?: AbortSignal; bypassCache?: boolean } = {},
): Promise<TerrainElevationResult> {
  const sample = await identifyDemElevation(longitudeEastDeg, latitudePlanetocentricDeg, options);
  const warnings: string[] = [];
  if (sample.status === 'no_data') {
    warnings.push(
      'The DEM service reported NoData at this point. Elevation is unknown, not zero; no value is interpolated.',
    );
  } else if (sample.status === 'outside_coverage') {
    warnings.push(
      'No DEM query was made because the point is outside the service declared extent. Elevation is unknown here.',
    );
  } else if (sample.status === 'unavailable') {
    warnings.push(
      sample.errorMessage ?? 'The DEM service did not return a usable elevation for this point.',
    );
  }
  warnings.push(
    '~200 m/px regional blend (MOLA+HRSC), not a site survey; vertical uncertainty is at least ±3 m and rock-scale relief is not resolved.',
  );

  return {
    tool: 'get_terrain_elevation',
    status: sample.status,
    location: planetocentricPoint(longitudeEastDeg, latitudePlanetocentricDeg),
    elevationM: sample.elevationM,
    unit: 'm',
    noData: sample.status === 'no_data',
    dataset: DEM_DATASET_METADATA,
    provenance: provenance(sample),
    warnings,
  };
}

const METRES_PER_DEGREE = (Math.PI * MARS_SPHERE_RADIUS_M) / 180;

/**
 * Ground length of one native DEM pixel step at a latitude.
 * N–S spacing is constant on the sphere; E–W spacing shrinks with cos(lat).
 */
export function demGroundSpacingMeters(latitudePlanetocentricDeg: number): {
  northSouthM: number;
  eastWestM: number;
} {
  const northSouthM = DEM_PIXEL_SIZE_DEG * METRES_PER_DEGREE;
  const eastWestM =
    northSouthM * Math.cos((latitudePlanetocentricDeg * Math.PI) / 180);
  return { northSouthM, eastWestM };
}

/** Normalize a longitude into [-180, 180) for neighbour sampling. */
export function wrapLongitude(longitudeEastDeg: number): number {
  return ((((longitudeEastDeg + 180) % 360) + 360) % 360) - 180;
}
