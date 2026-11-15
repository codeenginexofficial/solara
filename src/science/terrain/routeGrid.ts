import { MARS_METRES_PER_DEGREE } from '../../lib/marsCrs';
import { normalizeMarsLongitudeEast } from '../../lib/marsLocation';
import type { GeoPoint, RouteDataQuality, RouteWindowExtent } from './routeTypes';

export const DEM_NATIVE_CELL_SIZE_DEG = 0.00337412083064107;

export const DEM_DECLARED_EXTENT: RouteWindowExtent = {
  westLon: -180,
  eastLon: 179.9984479044183,
  southLat: -89.99922395220915,
  northLat: 90,
};

export const DEFAULT_ROUTE_GRID_MAX_CELLS = 640;

export interface RouteWindowOptions {
  maxCells?: number;
  nativeCellSizeDeg?: number;
  paddingFraction?: number;
  minPaddingCells?: number;
}

export interface DemWindowSegment {
  westLon: number;
  southLat: number;
  eastLon: number;
  northLat: number;
  cols: number;
  rows: number;
  columnStart: number;
  logicalWestLon: number;
  logicalEastLon: number;
}

export interface RouteWindow {
  extent: RouteWindowExtent;
  cols: number;
  rows: number;
  cellSizeDegX: number;
  cellSizeDegY: number;
  maxCells: number;
  segments: DemWindowSegment[];
  datelineSegments: number;
}

export type RoutePointValidation =
  | { ok: true; point: GeoPoint }
  | { ok: false; message: string };

export class RouteWindowError extends Error {}

export function normalizeRoutePoint(lon: number, lat: number): RoutePointValidation {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { ok: false, message: 'Coordinates must be finite numbers.' };
  }
  if (lat < -90 || lat > 90) {
    return {
      ok: false,
      message: 'Latitude must be between -90 and +90 degrees planetocentric.',
    };
  }
  try {
    return { ok: true, point: { lon: normalizeMarsLongitudeEast(lon), lat } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function shortestLongitudeDelta(fromLon: number, toLon: number): number {
  const from = normalizeMarsLongitudeEast(fromLon);
  const to = normalizeMarsLongitudeEast(toLon);
  const delta = ((to - from + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}

export function logicalLongitudeForExtent(
  lon: number,
  extent: RouteWindowExtent,
): number {
  const normalized = normalizeMarsLongitudeEast(lon);
  return extent.westLon + shortestLongitudeDelta(extent.westLon, normalized);
}

export function isLogicalLongitudeInside(
  logicalLon: number,
  extent: RouteWindowExtent,
): boolean {
  return logicalLon >= extent.westLon - 1e-12 && logicalLon <= extent.eastLon + 1e-12;
}

export function windowFitsExtent(
  windowExtent: RouteWindowExtent,
  gridExtent: RouteWindowExtent,
): boolean {
  const epsilon = 1e-10;
  return (
    windowExtent.westLon >= gridExtent.westLon - epsilon &&
    windowExtent.eastLon <= gridExtent.eastLon + epsilon &&
    windowExtent.southLat >= gridExtent.southLat - epsilon &&
    windowExtent.northLat <= gridExtent.northLat + epsilon &&
    windowExtent.eastLon - windowExtent.westLon <= 180 + epsilon
  );
}

export function buildRouteWindow(
  start: GeoPoint,
  target: GeoPoint,
  options: RouteWindowOptions = {},
): RouteWindow {
  const startValidation = normalizeRoutePoint(start.lon, start.lat);
  const targetValidation = normalizeRoutePoint(target.lon, target.lat);
  if (!startValidation.ok) throw new RouteWindowError(`Start: ${startValidation.message}`);
  if (!targetValidation.ok) throw new RouteWindowError(`Target: ${targetValidation.message}`);

  const startPoint = startValidation.point;
  const targetPoint = targetValidation.point;
  const nativeCellSizeDeg = options.nativeCellSizeDeg ?? DEM_NATIVE_CELL_SIZE_DEG;
  if (!Number.isFinite(nativeCellSizeDeg) || nativeCellSizeDeg <= 0) {
    throw new RouteWindowError('Native DEM cell size must be a positive finite number.');
  }

  const maxCells = Math.max(
    8,
    Math.min(2048, Math.floor(options.maxCells ?? DEFAULT_ROUTE_GRID_MAX_CELLS)),
  );
  const paddingFraction = Math.max(0, options.paddingFraction ?? 0.18);
  const minPaddingCells = Math.max(0, options.minPaddingCells ?? 8);
  const paddingDeg = nativeCellSizeDeg * minPaddingCells;

  const targetLogicalLon = startPoint.lon + shortestLongitudeDelta(startPoint.lon, targetPoint.lon);
  const minLon = Math.min(startPoint.lon, targetLogicalLon);
  const maxLon = Math.max(startPoint.lon, targetLogicalLon);
  const minLat = Math.min(startPoint.lat, targetPoint.lat);
  const maxLat = Math.max(startPoint.lat, targetPoint.lat);

  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  let westLon = minLon - Math.max(paddingDeg, lonSpan * paddingFraction);
  let eastLon = maxLon + Math.max(paddingDeg, lonSpan * paddingFraction);
  let southLat = minLat - Math.max(paddingDeg, latSpan * paddingFraction);
  let northLat = maxLat + Math.max(paddingDeg, latSpan * paddingFraction);

  southLat = Math.max(DEM_DECLARED_EXTENT.southLat, southLat);
  northLat = Math.min(DEM_DECLARED_EXTENT.northLat, northLat);
  if (northLat <= southLat) {
    throw new RouteWindowError('The route latitude window is degenerate.');
  }
  if (eastLon <= westLon) {
    throw new RouteWindowError('The route longitude window is degenerate.');
  }

  const paddedLonSpan = eastLon - westLon;
  const paddedLatSpan = northLat - southLat;
  const cellSizeDeg = Math.max(
    nativeCellSizeDeg,
    paddedLonSpan / maxCells,
    paddedLatSpan / maxCells,
  );
  const cols = Math.max(1, Math.ceil(paddedLonSpan / cellSizeDeg));
  const rows = Math.max(1, Math.ceil(paddedLatSpan / cellSizeDeg));
  const cellSizeDegX = paddedLonSpan / cols;
  const cellSizeDegY = paddedLatSpan / rows;
  const extent: RouteWindowExtent = { westLon, southLat, eastLon, northLat };

  const groups: Array<{ key: number; startCol: number; endCol: number }> = [];
  for (let col = 0; col < cols; col++) {
    const centerLogicalLon = westLon + (col + 0.5) * cellSizeDegX;
    const key = centerLogicalLon > 180 ? 1 : centerLogicalLon < -180 ? -1 : 0;
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.endCol === col) {
      last.endCol = col + 1;
    } else {
      groups.push({ key, startCol: col, endCol: col + 1 });
    }
  }

  const segments: DemWindowSegment[] = [];
  for (const group of groups) {
    const logicalWestLon = westLon + group.startCol * cellSizeDegX;
    const logicalEastLon = westLon + group.endCol * cellSizeDegX;
    const desiredWidth = (group.endCol - group.startCol) * cellSizeDegX;
    let segmentWest: number;
    let segmentEast: number;
    if (group.key === 1) {
      segmentWest = -180;
      segmentEast = segmentWest + desiredWidth;
    } else if (group.key === -1) {
      segmentEast = 180;
      segmentWest = segmentEast - desiredWidth;
    } else {
      segmentWest = logicalWestLon;
      segmentEast = segmentWest + desiredWidth;
      if (segmentEast > 180) {
        segmentEast = 180;
        segmentWest = segmentEast - desiredWidth;
      }
    }
    if (!(segmentEast > segmentWest)) continue;
    segments.push({
      westLon: segmentWest,
      southLat,
      eastLon: segmentEast,
      northLat,
      cols: group.endCol - group.startCol,
      rows,
      columnStart: group.startCol,
      logicalWestLon,
      logicalEastLon,
    });
  }
  if (segments.length === 0) {
    throw new RouteWindowError('The route window has no DEM-requestable longitude segment.');
  }

  return {
    extent,
    cols,
    rows,
    cellSizeDegX,
    cellSizeDegY,
    maxCells,
    segments,
    datelineSegments: segments.length,
  };
}

export function classifyRouteDataQuality(
  mode: 'prepared-local' | 'live-export',
  cellSizeDegX: number,
  cellSizeDegY: number,
): RouteDataQuality {
  if (mode === 'prepared-local') return 'local-prepared';
  const nominalM = Math.max(cellSizeDegX, cellSizeDegY) * MARS_METRES_PER_DEGREE;
  if (nominalM <= 1500) return 'regional-live';
  if (nominalM <= 5000) return 'coarse-live';
  return 'reconnaissance';
}

export function splitRouteAtDateline<T extends { lon: number; lat: number }>(
  points: readonly T[],
): T[][] {
  if (points.length === 0) return [];
  const segments: T[][] = [];
  let current: T[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && Math.abs(point.lon - previous.lon) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}
