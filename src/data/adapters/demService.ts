/**
 * Live Trek ImageServer elevation identify.
 *
 * Queries the verified MOLA+HRSC blend DEM ImageServer
 * (Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw) for the elevation at a
 * single geographic point. Used for point lookups (LocationPanel); the route
 * engine uses the prepared grid instead (see adapters/elevationGrid.ts) so
 * routing never depends on per-request network availability.
 *
 * Verified on 2026-11-13:
 *  - identify?f=json with geometry {"x":lon,"y":lat} + sr=104905 responds
 *    HTTP 200 with { value: "-2520" } at the Jezero check point
 *    (77.42982°E, 18.46611°N); CORS reflects the browser origin.
 *  - NoData cells return the string "NoData" instead of a number.
 *
 * This module is ol-free.
 */

import { getDatasetById } from '../catalog/datasets';

const DEM_DATASET_ID = 'mola-hrsc-blend-200m-dem';

export interface DemIdentifyResult {
  datasetId: string;
  /** Elevation in metres relative to the Mars areoid (MOLA-registered). */
  elevationM: number | null;
  /** True when the service explicitly answered NoData for this point. */
  noData: boolean;
  /** ISO timestamp of the completed query. */
  fetchedAt: string;
}

export class DemIdentifyError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** In-memory cache keyed by 5-decimal-rounded lon/lat. */
const identifyCache = new Map<string, DemIdentifyResult>();

function cacheKey(lon: number, lat: number): string {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Query the live DEM service for the elevation at a point. Throws
 * DemIdentifyError on request failure; returns elevationM=null +
 * noData=true when the service answers NoData.
 */
export async function identifyElevation(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<DemIdentifyResult> {
  const key = cacheKey(lon, lat);
  const cached = identifyCache.get(key);
  if (cached) return cached;

  const dataset = getDatasetById(DEM_DATASET_ID);
  if (!dataset?.queryEndpoint) {
    throw new DemIdentifyError(`DEM dataset "${DEM_DATASET_ID}" is not configured for live queries.`);
  }

  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 104905 } }),
    geometryType: 'esriGeometryPoint',
    sr: '104905',
    returnGeometry: 'false',
  });

  let response: Response;
  try {
    response = await fetch(`${dataset.queryEndpoint}?${params.toString()}`, {
      signal,
      mode: 'cors',
    });
  } catch (e) {
    throw new DemIdentifyError(
      `DEM identify request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!response.ok) {
    throw new DemIdentifyError(
      `DEM identify request failed: HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DemIdentifyError('DEM identify response is not valid JSON.');
  }

  const value = (body as { value?: unknown }).value;
  const fetchedAt = new Date().toISOString();

  let result: DemIdentifyResult;
  if (typeof value === 'string' && /nodata/i.test(value)) {
    result = { datasetId: DEM_DATASET_ID, elevationM: null, noData: true, fetchedAt };
  } else {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
    if (!Number.isFinite(n)) {
      throw new DemIdentifyError(`DEM identify returned an unexpected value: ${String(value)}`);
    }
    result = { datasetId: DEM_DATASET_ID, elevationM: n, noData: false, fetchedAt };
  }

  identifyCache.set(key, result);
  return result;
}
