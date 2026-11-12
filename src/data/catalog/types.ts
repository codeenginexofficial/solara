/**
 * Dataset catalog types.
 *
 * Schema adapted from Architecture.md §4. Every dataset record must carry
 * verifiable metadata: provider, projection definition, coverage, resolution,
 * attribution, limitations, and an explicit verification status.
 *
 * Verification statuses (Architecture.md §4):
 *  - unverified: recorded as a candidate only; nothing has been inspected.
 *  - inspected:  source metadata has been read and recorded, but the source
 *                has not been exercised end-to-end.
 *  - tested:     real requests against the source succeeded and were checked
 *                (capabilities + tile requests, alignment reviewed).
 *  - integrated: the dataset renders in SOLARA and its alignment, CRS
 *                handling, and metadata have been verified in the running app.
 *
 * Rules (Context.md §7): never upgrade a status without doing the work.
 * Unknown information must be recorded as unknown, never filled in.
 */

export type DatasetKind =
  | 'optical'
  | 'topography'
  | 'geology'
  | 'rover'
  | 'thermal'
  | 'spectral'
  | 'atmospheric'
  | 'radiation'
  | 'other';

export type VerificationStatus =
  | 'unverified'
  | 'inspected'
  | 'tested'
  | 'integrated';

export type AccessMethod =
  | 'wmts'
  | 'wms'
  | 'xyz'
  | 'geotiff'
  | 'geojson'
  | 'csv'
  | 'api'
  | 'download'
  | 'other';

/** Spatial reference metadata. Preserve the source's original CRS definition. */
export interface SpatialReference {
  body: 'Mars';
  /** Authority / registry that publishes the CRS definition. */
  authority?: string;
  /** Proj4 parameters for the projection, from verified sources. */
  proj4?: string;
  /** Datum / reference surface description. */
  datum?: string;
  /** Projection type and parameters in human-readable form. */
  coordinateSystem?: string;
  latitudeType?: 'planetocentric' | 'planetographic' | 'not-applicable';
  longitudeDirection?: 'east' | 'west' | 'not-applicable';
  /** Units of the geographic coordinates. */
  units?: string;
  /** The authoritative definition as stated by the source. */
  sourceDefinition: string;
}

/** Geographic bounding box in degrees (lon/lat), east-positive. */
export interface GeographicBoundingBox {
  westLon: number;
  eastLon: number;
  southLat: number;
  northLat: number;
}

export interface DatasetRecord {
  id: string;
  title: string;
  provider: string;
  mission?: string;
  instrument?: string;
  productId?: string;
  kind: DatasetKind;
  description: string;
  /** Where the dataset metadata / service is documented. */
  sourceUrl: string;
  accessMethod: AccessMethod;
  /** Service entry point used by the app (tile endpoint template, file, ...). */
  assetUrl?: string;
  spatialReference: SpatialReference;
  coverageDescription: string;
  /** Coverage as a bounding box, when the source declares one. */
  boundingBox?: GeographicBoundingBox;
  spatialResolution?: number;
  resolutionUnit?: string;
  observationStart?: string;
  observationEnd?: string;
  units?: string;
  attribution: string;
  limitations: string[];
  verification: VerificationStatus;
  /** ISO date of the last verification pass against the live source. */
  lastVerifiedAt?: string;
}

/** Regions SOLARA knows about. Detailed planning is only offered inside
 *  regions whose datasets have verified coverage (Context.md §5). */
export interface RegionRecord {
  id: string;
  name: string;
  body: 'Mars';
  description: string;
  /** Region of interest bounding box in degrees (may be smaller than dataset coverage). */
  boundingBox: GeographicBoundingBox;
  datasetIds: string[];
}
