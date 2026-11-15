/**
 * Typed service contracts for SOLARA's isolated scientific data services.
 *
 * These types describe deterministic tool results that Agent A may expose to
 * the scientific assistant from `worker/src/tools.ts`. The services live in
 * this directory and are owned by Agent C; the router/tool dispatch is owned
 * by Agent A.
 *
 * Scientific rules encoded in these shapes (Context.md §7 / AGENT_ROLES.md):
 *  - Coordinates are always east-positive planetocentric degrees on the Mars
 *    2000 sphere, never EPSG:4326.
 *  - Every result carries provenance (dataset, service, method, fetch time).
 *  - Missing data is `null` with an explicit non-available status; it is
 *    never interpolated, generalized, or replaced by a model guess.
 *  - MEDA observations are in-situ measurements at the rover; they are never
 *    presented as conditions at the requested map coordinate.
 *
 * Latency budget for the dispatcher: DEM identify allows 15 s and retries one
 * failed read (≤30 s per point); slope therefore allows ~30 s worst case; the
 * traverse query allows 30 s. All async services accept a caller AbortSignal.
 */

/** Semantic class of a value, following the project's honesty labels. */
export type MarsDataClass =
  | 'measured'
  | 'derived'
  | 'modelled'
  | 'historical'
  | 'unavailable';

/**
 * A Mars surface coordinate in the convention verified for SOLARA's sources:
 * east-positive longitude, planetocentric latitude, degrees.
 */
export interface MarsPlanetocentricPoint {
  longitudeEastDeg: number;
  latitudePlanetocentricDeg: number;
  latitudeType: 'planetocentric';
  longitudeDirection: 'east';
  crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT';
}

/** Status vocabulary agreed in AGENT_COORDINATION.md D-006 (C refinement). */
export type CoordinateServiceStatus =
  | 'available'
  | 'outside_coverage'
  | 'no_data'
  | 'unavailable';

/** Inputs shared by the coordinate tools (east-positive planetocentric). */
export interface CoordinateInput {
  longitudeEastDeg: number;
  latitudePlanetocentricDeg: number;
}

export type TerrainElevationInput = CoordinateInput;

export type SlopeInput = CoordinateInput;

export type DatasetCoverageInput = CoordinateInput;

export interface MedaObservationsInput {
  /** Bypass the handler's 5-minute cache (default false). */
  refresh?: boolean;
}

export interface HistoricalRoverTrackInput extends CoordinateInput {
  /** Hard search radius around the point; clamped 100–10,000 m. */
  radiusM?: number;
}

export interface RoverImageryMetadataInput {
  /** Mars sol to query (historical images only). */
  sol: number;
  /** Maximum images to return (1–100, default 24). */
  limit?: number;
  refresh?: boolean;
}

/**
 * Slope adds one status: the centre sample exists but at least one neighbour
 * needed for a deterministic gradient is missing. A slope is never guessed.
 */
export type SlopeServiceStatus = CoordinateServiceStatus | 'insufficient_neighbours';

/** Where a scientific value came from and when it was retrieved. */
export interface ServiceProvenance {
  provider: string;
  datasetId: string;
  /** Exact upstream service endpoint used (not a generic home page). */
  sourceUrl: string;
  /** ISO timestamp of the retrieval that produced this result. */
  retrievedAt: string;
  /** ISO timestamp of the observation, when the product publishes one. */
  observedAt?: string;
  /** Mars sol, for sol-tagged products (rover track/images). */
  sol?: number;
  /** Nominal source resolution, when meaningful for the value. */
  spatialResolutionM?: number;
  method: string;
  fromCache: boolean;
}

/** DEM metadata reused by elevation and slope results. */
export interface ElevationDatasetMetadata {
  datasetId: string;
  title: string;
  provider: string;
  dataClass: Extract<MarsDataClass, 'derived'>;
  /** Vertical datum. SOLARA elevations are relative to the Mars areoid. */
  verticalReference: string;
  /** Nominal product resolution, not a guarantee at every location. */
  nominalResolutionMPerPixel: number;
  /** Native ImageServer pixel size in degrees (verified from service metadata). */
  pixelSizeDeg: number;
  uncertaintyNote: string;
  observationPeriod: string;
  limitations: string[];
}

/** `get_terrain_elevation` result (one point, one DEM pixel). */
export interface TerrainElevationResult {
  tool: 'get_terrain_elevation';
  status: CoordinateServiceStatus;
  location: MarsPlanetocentricPoint;
  elevationM: number | null;
  unit: 'm';
  /** True only when the service explicitly answered NoData for the point. */
  noData: boolean;
  dataset: ElevationDatasetMetadata;
  provenance: ServiceProvenance;
  warnings: string[];
}

/** One DEM sample used by the slope calculation. */
export interface ElevationSample {
  position: MarsPlanetocentricPoint;
  elevationM: number | null;
  status: CoordinateServiceStatus;
}

/** Horizontal spacing of the central-difference stencil, metres. */
export interface SlopeSampleSpacing {
  offsetDeg: number;
  northSouthM: number;
  eastWestM: number;
  note: string;
}

/** Result of the deterministic central-difference slope calculation. */
export interface SlopeResult {
  tool: 'calculate_slope';
  status: SlopeServiceStatus;
  location: MarsPlanetocentricPoint;
  /** Terrain slope in degrees, or null when it cannot be computed. */
  slopeDeg: number | null;
  /**
   * Downhill aspect in degrees clockwise from north (0–360), or null for a
   * flat surface / unavailable samples.
   */
  aspectDeg: number | null;
  aspectConvention: string;
  method: 'central-difference-4-neighbour';
  samples: {
    center: ElevationSample;
    north: ElevationSample;
    south: ElevationSample;
    east: ElevationSample;
    west: ElevationSample;
  };
  spacing: SlopeSampleSpacing;
  dataset: ElevationDatasetMetadata;
  provenance: ServiceProvenance;
  warnings: string[];
}

/** Declared-extent membership only: it does not prove pixels exist there. */
export type CoverageExtentStatus =
  | 'within_declared_extent'
  | 'outside_declared_extent'
  | 'extent_unknown';

export type DatasetAvailability =
  | 'prepared_asset'
  | 'live_query_service'
  | 'live_tile_service'
  | 'catalog_only';

/** One catalog dataset evaluated for a coordinate. */
export interface DatasetCoverageEntry {
  datasetId: string;
  title: string;
  kind: string;
  verification: string;
  lastVerifiedAt: string | null;
  availability: DatasetAvailability;
  extentStatus: CoverageExtentStatus;
  /** Declared extent (degrees); null when the source publishes none. */
  boundingBox: {
    westLon: number;
    eastLon: number;
    southLat: number;
    northLat: number;
  } | null;
  /**
   * Human-readable meaning of the extent test. Prepared crops, path bounding
   * boxes, and sparse/point products are not area coverage.
   */
  extentNote: string;
  spatialResolution: string | null;
  units: string | null;
  observationPeriod: string | null;
  sourceUrl: string;
  limitations: string[];
}

/** `get_dataset_coverage` result. */
export interface DatasetCoverageResult {
  tool: 'get_dataset_coverage';
  location: MarsPlanetocentricPoint;
  region: {
    id: string;
    name: string;
    boundingBox: {
      westLon: number;
      eastLon: number;
      southLat: number;
      northLat: number;
    };
  } | null;
  datasets: DatasetCoverageEntry[];
  notes: string[];
}

export type MedaSensorKey =
  | 'airTemperature'
  | 'relativeHumidity'
  | 'pressure'
  | 'windSpeed'
  | 'windDirection';

/** One MEDA sensor observation with its own sol/time and provenance. */
export interface MedaObservationEntry {
  sensor: MedaSensorKey;
  label: string;
  value: number | null;
  unit: string;
  /** Unconverted source value when the adapter converted units (e.g. K). */
  rawValue: number | null;
  rawUnit: string | null;
  sol: number;
  lmst: string;
  ltst: string;
  utcTime: string;
  sensorId: string;
  instrument: string;
  productType: 'calibrated' | 'derived';
  productFile: string;
  status: 'valid' | 'missing' | 'sensor_unavailable';
  qualityNote: string | null;
  /** Sols between this observation and the newest observation returned. */
  solsOlderThanLatest: number;
  dataClass: Extract<MarsDataClass, 'measured' | 'derived'>;
}

export interface MedaObservationsResult {
  tool: 'get_meda_observations';
  status: 'available' | 'unavailable';
  source: {
    provider: string;
    mission: string;
    instrument: string;
    archiveUrl: string;
    fetchedAt: string;
    fromCache: boolean;
    isLastKnownGood: boolean;
  };
  observations: MedaObservationEntry[];
  coverage: {
    measurementType: 'in-situ';
    locationDescription: string;
    /** The PDS product rows do not publish the rover's position. */
    observationLocation: null;
    observationLocationNote: string;
    temporalCoverage: string;
    spatialScope: string;
  };
  warnings: string[];
  errors?: string[];
}

/**
 * Optional rover services (historical products only — SOLARA has no live
 * rover-position feed). A decides whether to expose these tools.
 */
export interface HistoricalRoverTrackResult {
  tool: 'get_nearby_historical_rover_track';
  status: 'available' | 'outside_coverage' | 'unavailable';
  location: MarsPlanetocentricPoint;
  rover: 'Perseverance';
  positionType: 'historical-traverse';
  nearestTrackPoint: {
    longitudeEastDeg: number;
    latitudePlanetocentricDeg: number;
    sol: number;
    distanceM: number;
  } | null;
  searchRadiusM: number;
  provenance: ServiceProvenance;
  warnings: string[];
}

export interface RoverImageryMetadataResult {
  tool: 'get_rover_imagery_metadata';
  status: 'available' | 'unavailable';
  sol: number;
  count: number;
  images: Array<{
    imageId: string;
    sol: number | null;
    instrument: string | null;
    title: string | null;
    dateTakenUtc: string | null;
    dateTakenMars: string | null;
    credit: string | null;
    sourceLink: string | null;
    imageFiles: Record<string, string | undefined>;
  }>;
  coverage: {
    observationLocation: null;
    observationLocationNote: string;
  };
  provenance: ServiceProvenance;
  warnings: string[];
}
