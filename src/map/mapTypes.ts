/**
 * Serializable map/UI state types shared between the map component and the
 * mode layouts. OpenLayers objects must never be stored in React state
 * (Architecture.md §7) — only these plain values cross that boundary.
 */

/** A point inspected on the map, expressed in both projections. */
export interface MapLocation {
  /** Geographic longitude, degrees east-positive. */
  lon: number;
  /** Geographic latitude, degrees north-positive. */
  lat: number;
  /** Projected easting, metres (SOLARA:MARS_EQC_IAU2015). */
  x: number;
  /** Projected northing, metres (SOLARA:MARS_EQC_IAU2015). */
  y: number;
}

export interface ViewInfo {
  /** Current view resolution in metres per pixel (SOLARA:MARS_EQC_IAU2015). */
  resolutionMpp: number;
  /** Current tile level (0 = coarsest) or null when between levels. */
  tileLevel: number | null;
  center: MapLocation;
}

/**
 * A named overlay feature selected by clicking the map (science waypoints).
 * Plain values only — the map never leaks ol feature objects to the shell.
 */
export interface MapFeatureSelection {
  datasetId: string;
  name: string;
  /** Coordinates of the source feature geometry, not the map click point. */
  lon: number;
  lat: number;
  /** Link to the source bookmark page, when the service publishes one. */
  detailUrl?: string;
  /** Primitive source attributes only; OpenLayers geometry objects never leave MarsMap. */
  sourceProperties: Record<string, string | number | boolean | null>;
}

/**
 * Why a single tile request failed. Recorded by the Trek tile loader and
 * combined with the advertised footprint to separate expected no-data tiles
 * from genuine failures:
 *  - 'http-404'            tile missing from the source (verified to be the
 *                          normal response for tiles outside the mosaic)
 *  - 'http-server'         HTTP 5xx — server-side failure
 *  - 'http-other'          any other non-OK HTTP status
 *  - 'network-error'       request never completed (network/CORS failure)
 *  - 'invalid-response'    HTTP 200 but the body is not tile imagery
 *  - 'unknown'             failure observed without a recorded cause
 */
export type TileFailureKind =
  | 'http-404'
  | 'http-server'
  | 'http-other'
  | 'network-error'
  | 'invalid-response'
  | 'unknown';

export interface TileStats {
  /** Tiles currently loading. */
  loading: number;
  /** Tiles successfully displayed in this session (per view state). */
  loaded: number;
  /** Tiles that failed while intersecting the advertised footprint. */
  failed: number;
  /** Tiles fully outside the advertised footprint (expected no imagery). */
  noData: number;
  /** Why the most recent genuine failure happened. */
  lastFailure: TileFailureKind | null;
}

/**
 * Load state of one prepared GeoJSON overlay asset. Reported by MarsMap
 * once the async asset fetch settles; serializable, no ol objects.
 */
export type OverlayLoadState = 'loading' | 'active' | 'failed';

/** Overlay asset load states keyed by dataset id. */
export type OverlayStatusMap = Record<string, OverlayLoadState>;

/**
 * State of the live capabilities verification. The map always renders from
 * the verified embedded configuration; this status only describes whether
 * the live document was successfully re-verified against it.
 */
export type CapabilitiesStatus =
  | 'checking'
  | 'live'
  | 'schema-changed'
  | 'unavailable';

export interface SourceStatus {
  capabilities: CapabilitiesStatus;
  /** ISO timestamp of the last completed check, or null. */
  lastCheckedAt: string | null;
  /** Human-readable detail for the status display. */
  message: string;
}
