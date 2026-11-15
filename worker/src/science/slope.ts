/**
 * Deterministic terrain slope from real DEM samples (5-point stencil).
 *
 * Method: central differences over ±1 native DEM pixel of the verified
 * MOLA+HRSC blend ImageServer (see dem.ts):
 *
 *   dz/dx = (zE − zW) / (2 · Δx)      dz/dy = (zN − zS) / (2 · Δy)
 *   slope = atan( hypot(dz/dx, dz/dy) ) in degrees
 *   aspect = downhill azimuth clockwise from north, atan2(−dz/dx, −dz/dy)
 *
 * Δy = one pixel of latitude (~200.0 m on the Mars sphere); Δx = one pixel of
 * longitude (~189.7 m at 18.466°N). The stencil is deliberately simple and
 * fully specified: same inputs → same output. It is NOT Horn's 3×3 operator
 * and not a hazard-grade slope survey.
 *
 * Honesty rules:
 *  - Centre NoData/outside/unavailable is reported as such, never guessed.
 *  - If any required neighbour is missing, status is `insufficient_neighbours`
 *    and slopeDeg is null. Partial stencils are never silently averaged.
 */

import {
  DEM_DATASET_METADATA,
  DEM_IDENTIFY_URL,
  DEM_PIXEL_SIZE_DEG,
  demGroundSpacingMeters,
  identifyDemElevation,
  wrapLongitude,
} from './dem';
import type { RawDemSample } from './dem';
import type {
  CoordinateServiceStatus,
  ElevationSample,
  MarsPlanetocentricPoint,
  ServiceProvenance,
  SlopeResult,
  SlopeServiceStatus,
} from './contracts';

export interface CentralDifferenceInput {
  northM: number | null;
  southM: number | null;
  eastM: number | null;
  westM: number | null;
  northSouthSpacingM: number;
  eastWestSpacingM: number;
}

export interface CentralDifferenceSlope {
  slopeDeg: number;
  /** Downhill azimuth in degrees clockwise from north (0–360). */
  aspectDeg: number;
  gradient: { east: number; north: number };
}

/**
 * Pure central-difference slope. Returns null when any sample is missing or
 * the stencil spacing is not positive — callers must report that as unknown.
 */
export function computeCentralDifferenceSlope(
  input: CentralDifferenceInput,
): CentralDifferenceSlope | null {
  if (
    input.northM === null ||
    input.southM === null ||
    input.eastM === null ||
    input.westM === null
  ) {
    return null;
  }
  if (!(input.northSouthSpacingM > 0) || !(input.eastWestSpacingM > 0)) return null;

  const dzdx = (input.eastM - input.westM) / (2 * input.eastWestSpacingM);
  const dzdy = (input.northM - input.southM) / (2 * input.northSouthSpacingM);
  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  const downhillEast = -dzdx;
  const downhillNorth = -dzdy;
  const aspectDeg =
    ((Math.atan2(downhillEast, downhillNorth) * 180) / Math.PI + 360) % 360;

  return { slopeDeg, aspectDeg, gradient: { east: dzdx, north: dzdy } };
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

function sampleFrom(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  raw: RawDemSample,
): ElevationSample {
  return {
    position: point(longitudeEastDeg, latitudePlanetocentricDeg),
    elevationM: raw.elevationM,
    status: raw.status,
  };
}

function unqueried(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
): ElevationSample {
  return {
    position: point(longitudeEastDeg, latitudePlanetocentricDeg),
    elevationM: null,
    status: 'unavailable',
  };
}

function centreStatus(status: CoordinateServiceStatus): SlopeServiceStatus {
  return status;
}

/**
 * `calculate_slope` service. Queries the centre and four neighbours of the
 * verified DEM and computes a central-difference slope. Never interpolates a
 * missing neighbour and never returns a numeric slope without all five values.
 */
export async function calculateSlope(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
  options: { signal?: AbortSignal; bypassCache?: boolean } = {},
): Promise<SlopeResult> {
  const offset = DEM_PIXEL_SIZE_DEG;
  const northLat = latitudePlanetocentricDeg + offset;
  const southLat = latitudePlanetocentricDeg - offset;
  const eastLon = wrapLongitude(longitudeEastDeg + offset);
  const westLon = wrapLongitude(longitudeEastDeg - offset);

  const centerRaw = await identifyDemElevation(longitudeEastDeg, latitudePlanetocentricDeg, options);
  const center = sampleFrom(longitudeEastDeg, latitudePlanetocentricDeg, centerRaw);

  const spacing = demGroundSpacingMeters(latitudePlanetocentricDeg);
  const spacingInfo = {
    offsetDeg: offset,
    northSouthM: spacing.northSouthM,
    eastWestM: spacing.eastWestM,
    note:
      '±1 native DEM pixel. North–south spacing is constant on the sphere; east–west spacing uses cos(latitude).',
  };

  const warnings: string[] = [
    'Slope is derived from a 5-point central-difference stencil on the ~200 m/px MOLA+HRSC blend. It describes regional terrain, not rock-scale hazards or a validated traverse-safety assessment.',
  ];

  if (spacing.eastWestM < 1 && centerRaw.status === 'available') {
    warnings.push(
      'Slope not computed: within ~0.3° of a pole the east–west DEM stencil is degenerate (ground spacing under 1 m), so a central-difference gradient would be meaningless.',
    );
    return {
      tool: 'calculate_slope',
      status: 'unavailable',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      slopeDeg: null,
      aspectDeg: null,
      aspectConvention: 'Downhill aspect, degrees clockwise from north.',
      method: 'central-difference-4-neighbour',
      samples: {
        center,
        north: unqueried(longitudeEastDeg, northLat),
        south: unqueried(longitudeEastDeg, southLat),
        east: unqueried(eastLon, latitudePlanetocentricDeg),
        west: unqueried(westLon, latitudePlanetocentricDeg),
      },
      spacing: spacingInfo,
      dataset: DEM_DATASET_METADATA,
      provenance: {
        provider: DEM_DATASET_METADATA.provider,
        datasetId: DEM_DATASET_METADATA.datasetId,
        sourceUrl: DEM_IDENTIFY_URL,
        retrievedAt: centerRaw.fetchedAt,
        spatialResolutionM: 200,
        method: 'ArcGIS ImageServer identify (single point; stencil not run)',
        fromCache: centerRaw.fromCache,
      },
      warnings,
    };
  }

  let rawProvenance: RawDemSample[] = [centerRaw];

  if (centerRaw.status !== 'available') {
    warnings.push(
      'Neighbours were not queried because the centre elevation is not available; no slope can be computed.',
    );
    return {
      tool: 'calculate_slope',
      status: centreStatus(centerRaw.status),
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      slopeDeg: null,
      aspectDeg: null,
      aspectConvention: 'Downhill aspect, degrees clockwise from north.',
      method: 'central-difference-4-neighbour',
      samples: {
        center,
        north: unqueried(longitudeEastDeg, northLat),
        south: unqueried(longitudeEastDeg, southLat),
        east: unqueried(eastLon, latitudePlanetocentricDeg),
        west: unqueried(westLon, latitudePlanetocentricDeg),
      },
      spacing: spacingInfo,
      dataset: DEM_DATASET_METADATA,
      provenance: {
        provider: DEM_DATASET_METADATA.provider,
        datasetId: DEM_DATASET_METADATA.datasetId,
        sourceUrl: DEM_IDENTIFY_URL,
        retrievedAt: centerRaw.fetchedAt,
        spatialResolutionM: 200,
        method: 'ArcGIS ImageServer identify (single point; stencil not run)',
        fromCache: centerRaw.fromCache,
      },
      warnings,
    };
  }

  const [northRaw, southRaw, eastRaw, westRaw] = await Promise.all([
    identifyDemElevation(longitudeEastDeg, northLat, options),
    identifyDemElevation(longitudeEastDeg, southLat, options),
    identifyDemElevation(eastLon, latitudePlanetocentricDeg, options),
    identifyDemElevation(westLon, latitudePlanetocentricDeg, options),
  ]);
  rawProvenance = [centerRaw, northRaw, southRaw, eastRaw, westRaw];

  const north = sampleFrom(longitudeEastDeg, northLat, northRaw);
  const south = sampleFrom(longitudeEastDeg, southLat, southRaw);
  const east = sampleFrom(eastLon, latitudePlanetocentricDeg, eastRaw);
  const west = sampleFrom(westLon, latitudePlanetocentricDeg, westRaw);

  const allNeighboursAvailable =
    northRaw.status === 'available' &&
    southRaw.status === 'available' &&
    eastRaw.status === 'available' &&
    westRaw.status === 'available';

  const latestFetchedAt = rawProvenance
    .map((sample) => sample.fetchedAt)
    .sort()
    .at(-1) ?? centerRaw.fetchedAt;
  const provenance: ServiceProvenance = {
    provider: DEM_DATASET_METADATA.provider,
    datasetId: DEM_DATASET_METADATA.datasetId,
    sourceUrl: DEM_IDENTIFY_URL,
    retrievedAt: latestFetchedAt,
    spatialResolutionM: 200,
    method: 'ArcGIS ImageServer identify (5-point central-difference stencil)',
    fromCache: rawProvenance.every((sample) => sample.fromCache),
  };

  if (!allNeighboursAvailable) {
    const missing = [
      northRaw.status !== 'available' ? `north (${northRaw.status})` : null,
      southRaw.status !== 'available' ? `south (${southRaw.status})` : null,
      eastRaw.status !== 'available' ? `east (${eastRaw.status})` : null,
      westRaw.status !== 'available' ? `west (${westRaw.status})` : null,
    ].filter((entry): entry is string => entry !== null);
    warnings.push(
      `Slope not computed: missing or unusable neighbour samples: ${missing.join(', ')}. No value is guessed from a partial stencil.`,
    );
    return {
      tool: 'calculate_slope',
      status: 'insufficient_neighbours',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      slopeDeg: null,
      aspectDeg: null,
      aspectConvention: 'Downhill aspect, degrees clockwise from north.',
      method: 'central-difference-4-neighbour',
      samples: { center, north, south, east, west },
      spacing: spacingInfo,
      dataset: DEM_DATASET_METADATA,
      provenance,
      warnings,
    };
  }

  const computed = computeCentralDifferenceSlope({
    northM: northRaw.elevationM,
    southM: southRaw.elevationM,
    eastM: eastRaw.elevationM,
    westM: westRaw.elevationM,
    northSouthSpacingM: spacing.northSouthM,
    eastWestSpacingM: spacing.eastWestM,
  });

  if (!computed) {
    warnings.push('Slope could not be computed from the returned samples; no value is reported.');
    return {
      tool: 'calculate_slope',
      status: 'unavailable',
      location: point(longitudeEastDeg, latitudePlanetocentricDeg),
      slopeDeg: null,
      aspectDeg: null,
      aspectConvention: 'Downhill aspect, degrees clockwise from north.',
      method: 'central-difference-4-neighbour',
      samples: { center, north, south, east, west },
      spacing: spacingInfo,
      dataset: DEM_DATASET_METADATA,
      provenance,
      warnings,
    };
  }

  return {
    tool: 'calculate_slope',
    status: 'available',
    location: point(longitudeEastDeg, latitudePlanetocentricDeg),
    slopeDeg: computed.slopeDeg,
    aspectDeg: computed.slopeDeg < 1e-9 ? null : computed.aspectDeg,
    aspectConvention:
      'Downhill aspect, degrees clockwise from north (0° = downhill toward north, 90° = toward east); null on a flat surface.',
    method: 'central-difference-4-neighbour',
    samples: { center, north, south, east, west },
    spacing: spacingInfo,
    dataset: DEM_DATASET_METADATA,
    provenance,
    warnings,
  };
}
