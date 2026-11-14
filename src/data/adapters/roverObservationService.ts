/**
 * Location-context lookup for historical Perseverance images.
 *
 * NASA's raw-image feed does not publish a Mars surface position for an
 * image. This adapter therefore finds the nearest point on the verified
 * historical traverse and queries images from that segment's published Sol.
 * The returned image is associated by Sol only; it is never assigned the
 * traverse point as its capture location.
 */

import { PERSEVERANCE_TRAVERSE_DATASET } from '../catalog/datasets';
import type { MapLocation } from '../../map/mapTypes';
import { groundDistanceMeters, MARS_SPHERE_RADIUS_M } from '../../science/terrain/geometry';
import {
  fetchPerseveranceImages,
  type PerseveranceImagePage,
} from './roverImageService';

const TRAVERSE_ASSET_URL = PERSEVERANCE_TRAVERSE_DATASET.preparedAssetUrl!;
const TRAVERSE_SOURCE_URL = PERSEVERANCE_TRAVERSE_DATASET.sourceUrl;

interface TraverseSegment {
  sol: number;
  coordinates: Array<[number, number]>;
}

interface TraverseAsset {
  type?: unknown;
  features?: unknown;
}

export interface NearestPerseveranceTraverse {
  sol: number;
  lon: number;
  lat: number;
  distanceM: number;
  datasetId: string;
  sourceUrl: string;
}

export type RoverObservationSearchResult =
  | { status: 'outside-traverse-coverage' }
  | {
      status: 'image-unavailable';
      nearestTraverse: NearestPerseveranceTraverse;
      imageLocation: null;
      message: string;
    }
  | {
      status: 'matched-sol';
      nearestTraverse: NearestPerseveranceTraverse;
      imagePage: PerseveranceImagePage;
      imageLocation: null;
    };

let traversePromise: Promise<TraverseSegment[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function parseTraverseAsset(value: unknown): TraverseSegment[] {
  if (!isRecord(value) || !Array.isArray((value as TraverseAsset).features)) {
    throw new Error('The prepared Perseverance traverse is not a GeoJSON feature collection.');
  }

  const features = (value as { features: unknown[] }).features;
  const segments: TraverseSegment[] = [];
  for (const feature of features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue;
    const sol = feature.properties.sol;
    const geometry = feature.geometry;
    if (
      typeof sol !== 'number' ||
      !Number.isSafeInteger(sol) ||
      sol < 0 ||
      geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates)
    ) continue;
    const coordinates = geometry.coordinates.filter(validCoordinate).map(([lon, lat]) => [lon, lat] as [number, number]);
    if (coordinates.length >= 2) segments.push({ sol, coordinates });
  }
  if (segments.length === 0) {
    throw new Error('The prepared Perseverance traverse has no Sol-tagged line segments.');
  }
  return segments;
}

function loadTraverse(): Promise<TraverseSegment[]> {
  if (!traversePromise) {
    traversePromise = fetch(TRAVERSE_ASSET_URL, { headers: { accept: 'application/geo+json, application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`Perseverance traverse request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then(parseTraverseAsset)
      .catch((error: unknown) => {
        traversePromise = null;
        throw error;
      });
  }
  return traversePromise;
}

function nearestPointOnSegment(
  location: MapLocation,
  start: [number, number],
  end: [number, number],
): { lon: number; lat: number; distanceM: number } {
  // Project the short Jezero segment into a local tangent plane about the
  // selected point, then measure the resulting point geodesically on Mars.
  const radians = Math.PI / 180;
  const cosLatitude = Math.cos((location.lat * Math.PI) / 180);
  const toLocal = (point: [number, number]) => ({
    x: ((point[0] - location.lon) * radians * MARS_SPHERE_RADIUS_M * cosLatitude),
    y: ((point[1] - location.lat) * radians * MARS_SPHERE_RADIUS_M),
  });
  const a = toLocal(start);
  const b = toLocal(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / denominator));
  const lon = start[0] + (end[0] - start[0]) * t;
  const lat = start[1] + (end[1] - start[1]) * t;
  return { lon, lat, distanceM: groundDistanceMeters(location.lon, location.lat, lon, lat) };
}

async function findNearestTraverse(location: MapLocation): Promise<NearestPerseveranceTraverse | null> {
  const bbox = PERSEVERANCE_TRAVERSE_DATASET.boundingBox;
  if (
    !bbox ||
    location.lon < bbox.westLon || location.lon > bbox.eastLon ||
    location.lat < bbox.southLat || location.lat > bbox.northLat
  ) return null;

  const segments = await loadTraverse();
  let nearest: NearestPerseveranceTraverse | null = null;
  for (const segment of segments) {
    for (let index = 1; index < segment.coordinates.length; index += 1) {
      const point = nearestPointOnSegment(
        location,
        segment.coordinates[index - 1]!,
        segment.coordinates[index]!,
      );
      if (!nearest || point.distanceM < nearest.distanceM) {
        nearest = {
          sol: segment.sol,
          ...point,
          datasetId: PERSEVERANCE_TRAVERSE_DATASET.id,
          sourceUrl: TRAVERSE_SOURCE_URL,
        };
      }
    }
  }
  return nearest;
}

/** Find raw images for the Sol of the nearest historical traverse segment. */
export async function findPerseveranceObservationsNear(
  location: MapLocation,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<RoverObservationSearchResult> {
  const nearestTraverse = await findNearestTraverse(location);
  if (!nearestTraverse) return { status: 'outside-traverse-coverage' };
  try {
    const imagePage = await fetchPerseveranceImages(
      { page: 0, limit: 100, sol: nearestTraverse.sol, refresh: options.refresh },
      options.signal,
    );
    return {
      status: 'matched-sol',
      nearestTraverse,
      imagePage,
      imageLocation: null,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      status: 'image-unavailable',
      nearestTraverse,
      imageLocation: null,
      message: error instanceof Error ? error.message : 'NASA image results could not be confirmed.',
    };
  }
}
