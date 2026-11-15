/**
 * Optional rover services for the scientific assistant.
 *
 * SOLARA has NO live rover-position feed. Everything here is historical:
 *  - `getNearbyHistoricalRoverTrack` queries the verified NASA Trek
 *    Perseverance traverse MapServer for sol-tagged path segments near a
 *    point and reports the nearest path vertex/segment midpoint. The result
 *    is explicitly a localization-derived historical track, never a live
 *    rover position and never an astronaut route.
 *  - `listPerseveranceRoverImages` reuses the existing NASA raw-image proxy
 *    handler (sol query, cache/stale semantics) and returns metadata only.
 *    NASA's `xyz`/camera tuples are not map coordinates; no capture position
 *    is assigned.
 *
 * Data sources verified 2026-11-15:
 *  - Traverse: https://trek.nasa.gov/mars/trekarcgis/rest/services/
 *      Perseverance_Traverse_Path/MapServer/0/query
 *    f=json + outSR=104905 works; f=geojson + outSR=104905 is rejected by the
 *    service ("The provided output spatial reference is not supported with
 *    geoJSON format"), so the adapter requests Esri JSON and converts paths.
 *  - Images: NASA Mars raw-images feed via worker/src/roverImages.ts.
 */

import {
  PERSEVERANCE_TRAVERSE_DATASET,
  TREK_ARCGIS_SERVICES,
} from '../../../src/data/catalog/datasets';
import { groundDistanceMeters, MARS_SPHERE_RADIUS_M } from '../../../src/science/terrain/geometry';
import {
  handlePerseveranceImages,
  type PerseveranceImage,
  type PerseveranceImagePage,
} from '../roverImages';
import type {
  HistoricalRoverTrackInput,
  HistoricalRoverTrackResult,
  MarsPlanetocentricPoint,
  RoverImageryMetadataInput,
  RoverImageryMetadataResult,
} from './contracts';

const QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_RADIUS_M = 2_000;
const MAX_SEARCH_RADIUS_M = 10_000;
const MIN_SEARCH_RADIUS_M = 100;
const MAX_IMAGES_LIMIT = 100;

const TRAVERSE_QUERY_URL = `${TREK_ARCGIS_SERVICES}/Perseverance_Traverse_Path/MapServer/0/query`;

type LonLat = [number, number];

interface TrackSegment {
  sol: number;
  coordinates: LonLat[];
}

interface NearestTrackPoint {
  longitudeEastDeg: number;
  latitudePlanetocentricDeg: number;
  sol: number;
  distanceM: number;
}

function point(
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validCoordinate(value: unknown): value is LonLat {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function queryEnvelope(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  radiusM: number,
): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const metresPerDegree = (Math.PI * MARS_SPHERE_RADIUS_M) / 180;
  const latDelta = radiusM / metresPerDegree;
  const cosLat = Math.max(0.001, Math.cos((latitudePlanetocentricDeg * Math.PI) / 180));
  const lonDelta = radiusM / (metresPerDegree * cosLat);
  return {
    xmin: longitudeEastDeg - lonDelta,
    ymin: latitudePlanetocentricDeg - latDelta,
    xmax: longitudeEastDeg + lonDelta,
    ymax: latitudePlanetocentricDeg + latDelta,
  };
}

/** Esri JSON (f=json) → validated sol-tagged line segments. */
function parseTraverseFeatures(value: unknown): TrackSegment[] {
  if (!value || typeof value !== 'object') return [];
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const segments: TrackSegment[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const attributes = (feature as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object') continue;
    const sol = (attributes as { sol?: unknown }).sol;
    if (typeof sol !== 'number' || !Number.isSafeInteger(sol) || sol < 0) continue;

    const geometry = (feature as { geometry?: unknown }).geometry;
    if (!geometry || typeof geometry !== 'object') continue;
    const paths = (geometry as { paths?: unknown }).paths;
    if (!Array.isArray(paths)) continue;

    for (const path of paths) {
      if (!Array.isArray(path)) continue;
      const coordinates = path.filter(validCoordinate).map(([lon, lat]) => [lon, lat] as LonLat);
      if (coordinates.length >= 2) segments.push({ sol, coordinates });
    }
  }
  return segments;
}

function nearestPointOnSegment(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  start: LonLat,
  end: LonLat,
): { lon: number; lat: number; distanceM: number } {
  // Local tangent plane about the query point; distances are then measured
  // geodesically on the Mars sphere (same method as the client adapter).
  const radians = Math.PI / 180;
  const cosLat = Math.cos(latitudePlanetocentricDeg * radians);
  const ax = (start[0] - longitudeEastDeg) * cosLat;
  const ay = start[1] - latitudePlanetocentricDeg;
  const bx = (end[0] - longitudeEastDeg) * cosLat;
  const by = end[1] - latitudePlanetocentricDeg;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0 ? clamp(-(ax * dx + ay * dy) / lengthSquared, 0, 1) : 0;
  const offsetX = ax + t * dx;
  const offsetY = ay + t * dy;

  const lon = longitudeEastDeg + offsetX / cosLat;
  const lat = latitudePlanetocentricDeg + offsetY;
  return {
    lon,
    lat,
    distanceM: groundDistanceMeters(
      longitudeEastDeg,
      latitudePlanetocentricDeg,
      lon,
      lat,
    ),
  };
}

function nearestOnTrack(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  segments: readonly TrackSegment[],
): NearestTrackPoint | null {
  let nearest: NearestTrackPoint | null = null;
  for (const segment of segments) {
    for (let index = 1; index < segment.coordinates.length; index += 1) {
      const start = segment.coordinates[index - 1];
      const end = segment.coordinates[index];
      if (!start || !end) continue;
      const candidate = nearestPointOnSegment(longitudeEastDeg, latitudePlanetocentricDeg, start, end);
      if (!nearest || candidate.distanceM < nearest.distanceM) {
        nearest = {
          longitudeEastDeg: candidate.lon,
          latitudePlanetocentricDeg: candidate.lat,
          sol: segment.sol,
          distanceM: candidate.distanceM,
        };
      }
    }
  }
  return nearest;
}

/**
 * `get_nearby_historical_rover_track` (optional service).
 * The search radius is honoured as a hard filter; the returned sol is the
 * simplest honest association available (Trek tags each path segment by sol).
 */
export async function getNearbyHistoricalRoverTrack(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  options: Omit<
    HistoricalRoverTrackInput,
    'longitudeEastDeg' | 'latitudePlanetocentricDeg'
  > & { signal?: AbortSignal } = {},
): Promise<HistoricalRoverTrackResult> {
  const requestedRadius = Number.isFinite(options.radiusM)
    ? (options.radiusM as number)
    : DEFAULT_SEARCH_RADIUS_M;
  const radiusM = clamp(requestedRadius, MIN_SEARCH_RADIUS_M, MAX_SEARCH_RADIUS_M);
  const fetchedAt = new Date().toISOString();
  const provenance = {
    provider: PERSEVERANCE_TRAVERSE_DATASET.provider,
    datasetId: PERSEVERANCE_TRAVERSE_DATASET.id,
    sourceUrl: TRAVERSE_QUERY_URL,
    method: 'ArcGIS MapServer query (envelope, Esri JSON, outSR=104905) + point-to-segment distance',
    retrievedAt: fetchedAt,
    fromCache: false,
  };

  const baseWarnings = [
    'HISTORICAL Perseverance traverse derived from rover localization products; this is not a live rover position and not a validated astronaut route.',
    'Positional accuracy follows the Mars 2020 localization product chain; individual track points are approximate.',
  ];

  if (!Number.isFinite(longitudeEastDeg) || !Number.isFinite(latitudePlanetocentricDeg)) {
    return {
      tool: 'get_nearby_historical_rover_track',
      status: 'unavailable',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      rover: 'Perseverance',
      positionType: 'historical-traverse',
      nearestTrackPoint: null,
      searchRadiusM: radiusM,
      provenance,
      warnings: [...baseWarnings, 'The coordinate must contain finite longitude and latitude values.'],
    };
  }
  if (
    latitudePlanetocentricDeg < -90 ||
    latitudePlanetocentricDeg > 90 ||
    longitudeEastDeg < -180 ||
    longitudeEastDeg > 180
  ) {
    return {
      tool: 'get_nearby_historical_rover_track',
      status: 'outside_coverage',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      rover: 'Perseverance',
      positionType: 'historical-traverse',
      nearestTrackPoint: null,
      searchRadiusM: radiusM,
      provenance,
      warnings: [...baseWarnings, 'The coordinate is outside the Mars planetocentric domain.'],
    };
  }

  const envelope = queryEnvelope(longitudeEastDeg, latitudePlanetocentricDeg, radiusM);
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    inSR: '104905',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'sol',
    returnGeometry: 'true',
    outSR: '104905',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(`${TRAVERSE_QUERY_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        tool: 'get_nearby_historical_rover_track',
        status: 'unavailable',
        location: point(longitudeEastDeg, latitudePlanetocentricDeg),
        rover: 'Perseverance',
        positionType: 'historical-traverse',
        nearestTrackPoint: null,
        searchRadiusM: radiusM,
        provenance,
        warnings: [
          ...baseWarnings,
          `Traverse query returned HTTP ${response.status} ${response.statusText}.`,
        ],
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        tool: 'get_nearby_historical_rover_track',
        status: 'unavailable',
        location: point(longitudeEastDeg, latitudePlanetocentricDeg),
        rover: 'Perseverance',
        positionType: 'historical-traverse',
        nearestTrackPoint: null,
        searchRadiusM: radiusM,
        provenance,
        warnings: [...baseWarnings, 'Traverse query returned a non-JSON response.'],
      };
    }

    const error = (payload as { error?: { message?: unknown } } | null)?.error;
    if (error) {
      return {
        tool: 'get_nearby_historical_rover_track',
        status: 'unavailable',
        location: point(longitudeEastDeg, latitudePlanetocentricDeg),
        rover: 'Perseverance',
        positionType: 'historical-traverse',
        nearestTrackPoint: null,
        searchRadiusM: radiusM,
        provenance,
        warnings: [
          ...baseWarnings,
          `Traverse query failed: ${typeof error.message === 'string' ? error.message : 'unknown ArcGIS error'}.`,
        ],
      };
    }

    const segments = parseTraverseFeatures(payload);
    const nearest = nearestOnTrack(longitudeEastDeg, latitudePlanetocentricDeg, segments);
    if (!nearest || nearest.distanceM > radiusM) {
      return {
        tool: 'get_nearby_historical_rover_track',
        status: 'outside_coverage',
        location: point(longitudeEastDeg, latitudePlanetocentricDeg),
        rover: 'Perseverance',
        positionType: 'historical-traverse',
        nearestTrackPoint: null,
        searchRadiusM: radiusM,
        provenance,
        warnings: [
          ...baseWarnings,
          `No historical traverse segment was found within ${Math.round(radiusM)} m of this point.`,
        ],
      };
    }

    return {
      tool: 'get_nearby_historical_rover_track',
      status: 'available',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      rover: 'Perseverance',
      positionType: 'historical-traverse',
      nearestTrackPoint: nearest,
      searchRadiusM: radiusM,
      provenance: { ...provenance, sol: nearest.sol },
      warnings: baseWarnings,
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      tool: 'get_nearby_historical_rover_track',
      status: 'unavailable',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      rover: 'Perseverance',
      positionType: 'historical-traverse',
      nearestTrackPoint: null,
      searchRadiusM: radiusM,
      provenance,
      warnings: [
        ...baseWarnings,
        aborted
          ? 'Traverse query timed out or was aborted.'
          : `Traverse query failed: ${error instanceof Error ? error.message : String(error)}.`,
      ],
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

const IMAGE_LOCATION_NOTE =
  'NASA raw-image metadata is associated with a sol, not a map coordinate. `xyz`/camera tuples are not treated as surface positions and no capture location is assigned.';

function imageMetadata(image: PerseveranceImage) {
  return {
    imageId: image.imageId,
    sol: image.sol ?? null,
    instrument: image.instrument ?? null,
    title: image.title ?? null,
    dateTakenUtc: image.dateTakenUtc ?? null,
    dateTakenMars: image.dateTakenMars ?? null,
    credit: image.credit ?? null,
    sourceLink: image.sourceLink ?? null,
    imageFiles: image.imageFiles as Record<string, string | undefined>,
  };
}

/**
 * `get_rover_imagery_metadata` (optional service): metadata for Perseverance
 * raw images from a given sol. Never claims a capture coordinate.
 */
export async function listPerseveranceRoverImages(
  options: RoverImageryMetadataInput,
): Promise<RoverImageryMetadataResult> {
  const fetchedAt = new Date().toISOString();
  const provenance = {
    provider: 'NASA Mars raw images feed',
    datasetId: 'nasa-mars2020-raw-images-feed',
    sourceUrl: 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020',
    method: 'Existing SOLARA NASA raw-image proxy (sol-filtered feed, validated/cached)',
    retrievedAt: fetchedAt,
    fromCache: false,
  };
  const baseWarnings = [
    IMAGE_LOCATION_NOTE,
    'These are mission images (historical), not a scientific overlay validated for terrain or trafficability analysis.',
  ];

  if (!Number.isSafeInteger(options.sol) || options.sol < 0) {
    return {
      tool: 'get_rover_imagery_metadata',
      status: 'unavailable',
      sol: options.sol,
      count: 0,
      images: [],
      coverage: {
        observationLocation: null,
        observationLocationNote: IMAGE_LOCATION_NOTE,
      },
      provenance,
      warnings: [...baseWarnings, 'The sol must be a non-negative integer.'],
    };
  }

  const limit = clamp(
    Number.isFinite(options.limit) ? Math.trunc(options.limit as number) : 24,
    1,
    MAX_IMAGES_LIMIT,
  );
  const url = new URL('https://solara.local/api/rovers/perseverance/images');
  url.searchParams.set('sol', String(options.sol));
  url.searchParams.set('limit', String(limit));
  if (options.refresh) url.searchParams.set('refresh', 'true');

  let response: Response;
  try {
    response = await handlePerseveranceImages(new Request(url.toString()));
  } catch (error) {
    return {
      tool: 'get_rover_imagery_metadata',
      status: 'unavailable',
      sol: options.sol,
      count: 0,
      images: [],
      coverage: {
        observationLocation: null,
        observationLocationNote: IMAGE_LOCATION_NOTE,
      },
      provenance,
      warnings: [
        ...baseWarnings,
        `NASA raw-image request failed: ${error instanceof Error ? error.message : String(error)}.`,
      ],
    };
  }

  if (!response.ok) {
    return {
      tool: 'get_rover_imagery_metadata',
      status: 'unavailable',
      sol: options.sol,
      count: 0,
      images: [],
      coverage: {
        observationLocation: null,
        observationLocationNote: IMAGE_LOCATION_NOTE,
      },
      provenance,
      warnings: [
        ...baseWarnings,
        `NASA raw-image handler returned HTTP ${response.status} ${response.statusText}.`,
      ],
    };
  }

  let page: PerseveranceImagePage;
  try {
    page = (await response.json()) as PerseveranceImagePage;
  } catch {
    return {
      tool: 'get_rover_imagery_metadata',
      status: 'unavailable',
      sol: options.sol,
      count: 0,
      images: [],
      coverage: {
        observationLocation: null,
        observationLocationNote: IMAGE_LOCATION_NOTE,
      },
      provenance,
      warnings: [...baseWarnings, 'NASA raw-image handler returned a non-JSON response.'],
    };
  }

  if (!page || !Array.isArray(page.images)) {
    return {
      tool: 'get_rover_imagery_metadata',
      status: 'unavailable',
      sol: options.sol,
      count: 0,
      images: [],
      coverage: {
        observationLocation: null,
        observationLocationNote: IMAGE_LOCATION_NOTE,
      },
      provenance,
      warnings: [...baseWarnings, 'NASA raw-image handler returned an unexpected response shape.'],
    };
  }

  const warnings = [...baseWarnings];
  if (page.cacheStatus === 'stale') {
    warnings.push(
      `The NASA feed was unavailable; this response is a stale cache (${page.staleReason ?? 'unknown reason'}).`,
    );
  }

  return {
    tool: 'get_rover_imagery_metadata',
    status: 'available',
    sol: options.sol,
    count: page.images.length,
    images: page.images.map(imageMetadata),
    coverage: {
      observationLocation: null,
      observationLocationNote: IMAGE_LOCATION_NOTE,
    },
    provenance: {
      ...provenance,
      sourceUrl: page.source.endpoint,
      retrievedAt: page.source.fetchedAt,
      sol: options.sol,
      fromCache: page.cacheStatus !== 'fresh',
    },
    warnings,
  };
}
