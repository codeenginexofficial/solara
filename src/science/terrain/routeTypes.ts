export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface RouteWindowExtent {
  westLon: number;
  southLat: number;
  eastLon: number;
  northLat: number;
}

export type RouteDataSource = 'prepared-local' | 'live-export';

export type RouteDataQuality =
  | 'local-prepared'
  | 'regional-live'
  | 'coarse-live'
  | 'reconnaissance';

export const ROUTE_DATA_QUALITY_LABELS: Record<RouteDataQuality, string> = {
  'local-prepared': 'Prepared local DEM',
  'regional-live': 'Live regional DEM',
  'coarse-live': 'Coarse live DEM',
  reconnaissance: 'Reconnaissance live DEM',
};

export const ROUTE_DATA_SOURCE_LABELS: Record<RouteDataSource, string> = {
  'prepared-local': 'Prepared Jezero grid',
  'live-export': 'Live NASA Trek DEM window',
};

export interface RoutePoint {
  lon: number;
  lat: number;
  elevM: number;
  cumulativeGroundM: number;
  cumulativeCostM: number;
  slopeInDeg: number | null;
}

export interface RouteCoverage {
  mode: RouteDataSource;
  quality: RouteDataQuality;
  qualityNote: string;
  datasetId: string;
  sourceService: string;
  sourceMethod: string;
  acquiredAt: string;
  window: RouteWindowExtent;
  cols: number;
  rows: number;
  cellSizeDegX: number;
  cellSizeDegY: number;
  nominalResolutionMPerPixel: number;
  datelineSegments: number;
  validFraction: number;
  missingFraction: number;
  pathCells: number;
  pathUnknownNeighbourCells: number;
}

export interface RouteProvenance {
  gridDatasetId: string;
  gridSourceService: string;
  gridSourceMethod: string;
  gridPreparedAt: string;
  gridCentreValidation: {
    identifyValueM: number;
    gridBilinearM: number;
    diffM: number;
  } | null;
  gridResolutionNote: string;
  verticalReference: string;
  gridSourceKind?: RouteDataSource;
}

export interface RouteResult {
  start: GeoPoint;
  target: GeoPoint;
  snappedStart: GeoPoint;
  snappedTarget: GeoPoint;
  params: {
    slopeCostPerDeg: number;
    maxSlopeDeg: number;
  };
  points: RoutePoint[];
  totalGroundDistanceM: number;
  totalCostM: number;
  directDistanceM: number;
  maxSlopeDeg: number | null;
  meanSlopeDeg: number | null;
  elevationMinM: number;
  elevationMaxM: number;
  warnings: string[];
  provenance: RouteProvenance;
  coverage?: RouteCoverage;
  computedAt: string;
}

export type RouteErrorCode =
  | 'grid-not-loaded'
  | 'start-outside'
  | 'target-outside'
  | 'start-unknown'
  | 'target-unknown'
  | 'start-no-coverage'
  | 'target-no-coverage'
  | 'insufficient-coverage'
  | 'dem-unavailable'
  | 'dem-response-invalid'
  | 'invalid-coordinate'
  | 'identical-points'
  | 'no-path'
  | 'invalid-params';
