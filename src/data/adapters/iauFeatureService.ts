import { normalizeMarsLongitudeEast, validateMarsLatitude } from '../../lib/marsLocation';

const IAU_FEATURE_QUERY = 'https://trek.nasa.gov/mars/trekarcgis/rest/services/outreach_nomenclature/MapServer/0/query';

export interface IauFeature {
  featureId: number | null;
  name: string;
  lon: number;
  lat: number;
  featureType: string | null;
  diameterKm: number | null;
  detailUrl: string | null;
}

interface ArcGisFeatureResponse {
  features?: Array<{
    attributes?: Record<string, unknown>;
    geometry?: { x?: unknown; y?: unknown };
  }>;
  error?: { message?: unknown };
}

function trustedDetailUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'planetarynames.wr.usgs.gov') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Search the NASA Trek service for IAU Gazetteer surface-feature names.
 * Coordinates come from returned geometry, which is requested in Mars GCS;
 * values are normalized to east-positive longitude. */
export async function searchIauFeatures(query: string, signal: AbortSignal): Promise<IauFeature[]> {
  const clean = query.trim();
  if (clean.length < 2 || clean.length > 80) return [];
  const escaped = clean.replaceAll("'", "''").replace(/[%_]/g, ' ');
  const params = new URLSearchParams({
    where: `clean_name LIKE '%${escaped}%'`,
    outFields: 'FID,clean_name,center_lon,center_lat,type,diameter,link',
    returnGeometry: 'true',
    outSR: '104905',
    resultRecordCount: '12',
    orderByFields: 'clean_name',
    f: 'json',
  });
  const response = await fetch(`${IAU_FEATURE_QUERY}?${params.toString()}`, {
    signal,
    mode: 'cors',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`IAU Gazetteer search returned HTTP ${response.status}.`);
  const payload = await response.json() as ArcGisFeatureResponse;
  if (payload.error) {
    const message = typeof payload.error.message === 'string' ? payload.error.message : 'ArcGIS query error';
    throw new Error(`IAU Gazetteer search failed: ${message}`);
  }
  if (!Array.isArray(payload.features)) throw new Error('IAU Gazetteer response has no feature list.');

  return payload.features.flatMap((feature): IauFeature[] => {
    const attributes = feature.attributes;
    const name = attributes?.clean_name;
    const x = feature.geometry?.x;
    const y = feature.geometry?.y;
    if (typeof name !== 'string' || !name.trim() || typeof x !== 'number' || typeof y !== 'number') return [];
    try {
      const lat = validateMarsLatitude(y);
      const lon = normalizeMarsLongitudeEast(x);
      const rawId = attributes?.FID;
      const rawDiameter = attributes?.diameter;
      return [{
        featureId: typeof rawId === 'number' && Number.isInteger(rawId) ? rawId : null,
        name: name.trim(),
        lon,
        lat,
        featureType: typeof attributes?.type === 'string' ? attributes.type : null,
        diameterKm: typeof rawDiameter === 'number' && Number.isFinite(rawDiameter) ? rawDiameter : null,
        detailUrl: trustedDetailUrl(attributes?.link),
      }];
    } catch {
      return [];
    }
  });
}
