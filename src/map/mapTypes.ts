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
  /** Projected easting, metres (EPSG:104905). */
  x: number;
  /** Projected northing, metres (EPSG:104905). */
  y: number;
}

export interface ViewInfo {
  /** Current view resolution in metres per pixel (EPSG:104905). */
  resolutionMpp: number;
  /** Current tile level (0 = coarsest) or null when between levels. */
  tileLevel: number | null;
  center: MapLocation;
}

export type CapabilitiesStatus =
  | 'checking'
  | 'live'
  | 'cached'
  | 'schema-changed'
  | 'unavailable';

export interface SourceStatus {
  capabilities: CapabilitiesStatus;
  /** ISO timestamp of the last completed check, or null. */
  lastCheckedAt: string | null;
  /** Human-readable detail for the status display. */
  message: string;
}

export interface TileStats {
  loading: number;
  failed: number;
}
