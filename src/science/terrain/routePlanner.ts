import type { ElevationGrid } from '../../data/adapters/elevationGrid';
import { MARS_METRES_PER_DEGREE } from '../../lib/marsCrs';
import { normalizeMarsLongitudeEast } from '../../lib/marsLocation';
import {
  DEFAULT_ROUTE_COST_PARAMS,
  edgeCostBetween,
  heuristicMeters,
  NEIGHBOUR_OFFSETS,
  type RouteCostParams,
} from './cost';
import { groundDistanceMeters } from './geometry';
import {
  classifyRouteDataQuality,
  isLogicalLongitudeInside,
  logicalLongitudeForExtent,
  normalizeRoutePoint,
} from './routeGrid';
import type {
  GeoPoint,
  RouteCoverage,
  RouteDataSource,
  RouteErrorCode,
  RoutePoint,
  RouteResult,
} from './routeTypes';

const MAX_SNAP_RADIUS_M = 2500;
const MAX_SNAP_RADIUS_CELLS = 6;

export interface RouteGridSource {
  mode: RouteDataSource;
  datelineSegments: number;
  acquiredAt: string;
  seamBridgedCells?: number;
}

export type RoutePlanOutcome =
  | { ok: true; result: RouteResult }
  | { ok: false; code: RouteErrorCode; message: string };

interface Cell {
  col: number;
  row: number;
}

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const n = this.keys.length;
    if (n === 0) return undefined;
    const top = this.values[0]!;
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    if (n > 1) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < this.keys.length && this.keys[left]! < this.keys[smallest]!) smallest = left;
        if (right < this.keys.length && this.keys[right]! < this.keys[smallest]!) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const key = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = key;
    const value = this.values[a]!;
    this.values[a] = this.values[b]!;
    this.values[b] = value;
  }
}

function cellCentreLogical(g: ElevationGrid, col: number, row: number): GeoPoint {
  const { meta } = g;
  const lon = meta.extent.westLon + (col + 0.5) * meta.cellSizeDegX;
  const lat = meta.extent.northLat - (row + 0.5) * meta.cellSizeDegY;
  return { lon, lat };
}

function cellCentreGeographic(g: ElevationGrid, col: number, row: number): GeoPoint {
  const logical = cellCentreLogical(g, col, row);
  return { lon: normalizeMarsLongitudeEast(logical.lon), lat: logical.lat };
}

function logicalLonForGrid(g: ElevationGrid, lon: number): number {
  // Keep the grid's raw (possibly unwrapped) west edge: windows crossing the
  // dateline westward have westLon < -180, and their logical frame must match
  // the same frame used by cellCentreLogical and the segment mapper.
  return logicalLongitudeForExtent(lon, g.meta.extent);
}

function nearestCell(g: ElevationGrid, logicalLon: number, lat: number): Cell {
  const { meta, cols, rows } = g;
  const col = Math.round((logicalLon - meta.extent.westLon) / meta.cellSizeDegX - 0.5);
  const row = Math.round((meta.extent.northLat - lat) / meta.cellSizeDegY - 0.5);
  return {
    col: Math.max(0, Math.min(cols - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

function nearestValidCell(g: ElevationGrid, start: Cell, maxRadius: number): Cell | null {
  const { cols, rows, valid } = g;
  const index = (col: number, row: number) => row * cols + col;
  for (let radius = 0; radius <= maxRadius; radius++) {
    if (radius === 0) {
      if (valid[index(start.col, start.row)]) return start;
      continue;
    }
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const col = start.col + dc;
        const row = start.row + dr;
        if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
        if (valid[index(col, row)]) return { col, row };
      }
    }
  }
  return null;
}

function hasUnknownNeighbour(g: ElevationGrid, col: number, row: number): boolean {
  const { cols, rows, valid } = g;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      if (!valid[r * cols + c]) return true;
    }
  }
  return false;
}

function astar(
  g: ElevationGrid,
  start: Cell,
  target: Cell,
  params: RouteCostParams,
): number[] | null {
  const { cols, values, valid } = g;
  const n = cols * g.rows;
  const startIndex = start.row * cols + start.col;
  const targetIndex = target.row * cols + target.col;
  const gCost = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  const logicalAt = (index: number): GeoPoint => {
    const row = Math.floor(index / cols);
    return cellCentreLogical(g, index - row * cols, row);
  };
  const targetCentre = logicalAt(targetIndex);
  const heuristic = (index: number): number => {
    const point = logicalAt(index);
    return heuristicMeters(point.lon, point.lat, targetCentre.lon, targetCentre.lat);
  };

  gCost[startIndex] = 0;
  heap.push(heuristic(startIndex), startIndex);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current === targetIndex) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const currentRow = Math.floor(current / cols);
    const currentCol = current - currentRow * cols;
    const currentCentre = logicalAt(current);
    const currentElev = values[current]!;

    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nextCol = currentCol + dx;
      const nextRow = currentRow + dy;
      if (nextCol < 0 || nextCol >= cols || nextRow < 0 || nextRow >= g.rows) continue;
      const nextIndex = nextRow * cols + nextCol;
      if (!valid[nextIndex] || closed[nextIndex]) continue;

      if (dx !== 0 && dy !== 0) {
        const sideA = currentRow * cols + (currentCol + dx);
        const sideB = (currentRow + dy) * cols + currentCol;
        if (!valid[sideA] || !valid[sideB]) continue;
      }

      const nextCentre = cellCentreLogical(g, nextCol, nextRow);
      const edge = edgeCostBetween(
        currentCentre.lon,
        currentCentre.lat,
        currentElev,
        nextCentre.lon,
        nextCentre.lat,
        values[nextIndex]!,
        params,
      );
      if (!Number.isFinite(edge.cost)) continue;

      const tentative = gCost[current]! + edge.cost;
      if (tentative < gCost[nextIndex]!) {
        gCost[nextIndex] = tentative;
        cameFrom[nextIndex] = current;
        heap.push(tentative + heuristic(nextIndex), nextIndex);
      }
    }
  }

  if (!Number.isFinite(gCost[targetIndex]!)) return null;
  const path: number[] = [];
  for (let index = targetIndex; index !== -1; index = cameFrom[index]!) {
    path.push(index);
    if (index === startIndex) break;
  }
  path.reverse();
  return path;
}

function snapRadiusCells(g: ElevationGrid): number {
  const cellM = Math.min(g.meta.cellSizeDegX, g.meta.cellSizeDegY) * MARS_METRES_PER_DEGREE;
  return Math.max(1, Math.min(MAX_SNAP_RADIUS_CELLS, Math.ceil(MAX_SNAP_RADIUS_M / Math.max(1, cellM))));
}

function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
}

function buildCoverage(
  g: ElevationGrid,
  source: RouteGridSource,
  pathCells: number,
  pathUnknownNeighbourCells: number,
): RouteCoverage {
  const { meta, cols, rows, valid } = g;
  let validCount = 0;
  for (let index = 0; index < valid.length; index++) {
    if (valid[index]) validCount++;
  }
  const total = Math.max(1, cols * rows);
  const validFraction = validCount / total;
  const quality = classifyRouteDataQuality(source.mode, meta.cellSizeDegX, meta.cellSizeDegY);
  const qualityNote =
    quality === 'local-prepared'
      ? 'Prepared local DEM centred on the Jezero exploration area; validated against live NASA Trek identify values.'
      : quality === 'regional-live'
        ? 'Live NASA Trek exportImage window at near-native DEM resolution.'
        : quality === 'coarse-live'
          ? 'Live NASA Trek exportImage window coarsened to keep the route search bounded.'
          : 'Live NASA Trek exportImage window heavily coarsened for a long route; reconnaissance geometry only.';

  return {
    mode: source.mode,
    quality,
    qualityNote,
    datasetId: meta.datasetId,
    sourceService: meta.sourceService,
    sourceMethod: meta.sourceMethod,
    acquiredAt: source.acquiredAt,
    window: { ...meta.extent },
    cols,
    rows,
    cellSizeDegX: meta.cellSizeDegX,
    cellSizeDegY: meta.cellSizeDegY,
    nominalResolutionMPerPixel: Math.max(meta.cellSizeDegX, meta.cellSizeDegY) * MARS_METRES_PER_DEGREE,
    datelineSegments: source.datelineSegments,
    validFraction,
    missingFraction: 1 - validFraction,
    seamBridgedCells: source.seamBridgedCells,
    pathCells,
    pathUnknownNeighbourCells,
  };
}

export function planRouteOnGrid(
  g: ElevationGrid,
  requestedStart: GeoPoint,
  requestedTarget: GeoPoint,
  params: RouteCostParams,
  source: RouteGridSource,
): RoutePlanOutcome {
  const startValidation = normalizeRoutePoint(requestedStart.lon, requestedStart.lat);
  if (!startValidation.ok) return { ok: false, code: 'invalid-coordinate', message: `Start: ${startValidation.message}` };
  const targetValidation = normalizeRoutePoint(requestedTarget.lon, requestedTarget.lat);
  if (!targetValidation.ok) return { ok: false, code: 'invalid-coordinate', message: `Target: ${targetValidation.message}` };

  const startPoint = startValidation.point;
  const targetPoint = targetValidation.point;
  const directDistanceM = groundDistanceMeters(startPoint.lon, startPoint.lat, targetPoint.lon, targetPoint.lat);
  if (directDistanceM < 1) {
    return { ok: false, code: 'identical-points', message: 'Start and target are the same location on the Mars sphere.' };
  }

  const { meta, cols, valid } = g;
  const startLogicalLon = logicalLonForGrid(g, startPoint.lon);
  const targetLogicalLon = logicalLonForGrid(g, targetPoint.lon);
  const inBounds = (logicalLon: number, lat: number): boolean =>
    isLogicalLongitudeInside(logicalLon, meta.extent) &&
    lat >= meta.extent.southLat - 1e-10 &&
    lat <= meta.extent.northLat + 1e-10;
  if (!inBounds(startLogicalLon, startPoint.lat)) {
    return { ok: false, code: 'start-outside', message: 'Start is outside this DEM window.' };
  }
  if (!inBounds(targetLogicalLon, targetPoint.lat)) {
    return { ok: false, code: 'target-outside', message: 'Target is outside this DEM window.' };
  }

  let validCount = 0;
  for (let index = 0; index < valid.length; index++) if (valid[index]) validCount++;
  if (validCount === 0) {
    return { ok: false, code: 'insufficient-coverage', message: 'The DEM window contains no usable elevation cells.' };
  }

  const radius = snapRadiusCells(g);
  const startCell = nearestValidCell(g, nearestCell(g, startLogicalLon, startPoint.lat), radius);
  if (!startCell) {
    return { ok: false, code: 'start-no-coverage', message: 'No known-elevation DEM cell near the start point.' };
  }
  const targetCell = nearestValidCell(g, nearestCell(g, targetLogicalLon, targetPoint.lat), radius);
  if (!targetCell) {
    return { ok: false, code: 'target-no-coverage', message: 'No known-elevation DEM cell near the target point.' };
  }

  const path = astar(g, startCell, targetCell, params);
  if (!path) {
    return {
      ok: false,
      code: 'no-path',
      message: 'No terrain-cost candidate found: unknown or too-steep terrain separates start and target under the current cost model.',
    };
  }

  const points: RoutePoint[] = [];
  let cumulativeGround = 0;
  let cumulativeCost = 0;
  let previousGround = 0;
  let previousCost = 0;
  let previousSlope: number | null = null;
  for (let k = 0; k < path.length; k++) {
    const index = path[k]!;
    const row = Math.floor(index / cols);
    const col = index - row * cols;
    const centre = cellCentreGeographic(g, col, row);
    const elevation = g.values[index]!;
    if (k > 0) {
      cumulativeGround += previousGround;
      cumulativeCost += previousCost;
    }
    points.push({
      lon: centre.lon,
      lat: centre.lat,
      elevM: elevation,
      cumulativeGroundM: cumulativeGround,
      cumulativeCostM: cumulativeCost,
      slopeInDeg: k === 0 ? null : previousSlope,
    });
    const next = path[k + 1];
    if (next !== undefined) {
      const nextRow = Math.floor(next / cols);
      const nextCol = next - nextRow * cols;
      const logicalCurrent = cellCentreLogical(g, col, row);
      const logicalNext = cellCentreLogical(g, nextCol, nextRow);
      const edge = edgeCostBetween(
        logicalCurrent.lon,
        logicalCurrent.lat,
        elevation,
        logicalNext.lon,
        logicalNext.lat,
        g.values[next]!,
        params,
      );
      previousGround = edge.groundM;
      previousCost = edge.cost;
      previousSlope = edge.slopeDeg;
    }
  }

  let elevationMin = Infinity;
  let elevationMax = -Infinity;
  let slopeSum = 0;
  let slopeCount = 0;
  let maxSlopeDeg: number | null = null;
  for (const point of points) {
    if (point.elevM < elevationMin) elevationMin = point.elevM;
    if (point.elevM > elevationMax) elevationMax = point.elevM;
    if (point.slopeInDeg !== null) {
      slopeSum += point.slopeInDeg;
      slopeCount++;
      if (maxSlopeDeg === null || point.slopeInDeg > maxSlopeDeg) maxSlopeDeg = point.slopeInDeg;
    }
  }

  const snappedStart = cellCentreGeographic(g, startCell.col, startCell.row);
  const snappedTarget = cellCentreGeographic(g, targetCell.col, targetCell.row);
  const coverage = buildCoverage(g, source, path.length, (() => {
    let count = 0;
    for (const index of path) {
      const row = Math.floor(index / cols);
      const col = index - row * cols;
      if (hasUnknownNeighbour(g, col, row)) count++;
    }
    return count;
  })());

  const warnings: string[] = [];
  const startSnapM = groundDistanceMeters(startPoint.lon, startPoint.lat, snappedStart.lon, snappedStart.lat);
  if (startSnapM > 1) {
    warnings.push(`Start snapped to the nearest cell with known elevation (${Math.round(startSnapM)} m away).`);
  }
  const targetSnapM = groundDistanceMeters(targetPoint.lon, targetPoint.lat, snappedTarget.lon, snappedTarget.lat);
  if (targetSnapM > 1) {
    warnings.push(`Target snapped to the nearest cell with known elevation (${Math.round(targetSnapM)} m away).`);
  }
  if (coverage.pathUnknownNeighbourCells > 0) {
    warnings.push(
      'The path passes within one grid cell of terrain with unknown elevation. Segment-level uncertainty is not quantified here.',
    );
  }
  if (coverage.missingFraction > 0.0001) {
    warnings.push(
      `${(coverage.missingFraction * 100).toFixed(1)}% of the DEM window has unknown elevation. Unknown cells were treated as impassable; the candidate avoids them.`,
    );
  }
  if (coverage.datelineSegments > 1) {
    warnings.push(
      `The DEM window crosses ±180° and was fetched as ${coverage.datelineSegments} tiles, then stitched on the Mars sphere. Seam alignment is limited by the effective cell size. In the global EQC view the map fits the full planet because both sides of the seam cannot be shown at once; zoom/pan to inspect the route.`,
    );
  }
  if ((source.seamBridgedCells ?? 0) > 0) {
    warnings.push(
      `${source.seamBridgedCells} cell(s) in the narrow source-product gap at ±180° were bridged from the nearest known equivalent-meridian samples. This is derived seam handling, not additional measured coverage.`,
    );
  }
  warnings.push(
    `Terrain data: ${coverage.datasetId} sampled at ~${Math.round(coverage.nominalResolutionMPerPixel)} m/px nominal at the equator; at ${formatLatitude((meta.extent.northLat + meta.extent.southLat) / 2)} the east-west cell spacing is ~${Math.round(coverage.nominalResolutionMPerPixel * Math.cos((((meta.extent.northLat + meta.extent.southLat) / 2) * Math.PI) / 180))} m. Regional terrain only; rock-scale hazards are not represented.`,
  );
  if (coverage.quality === 'coarse-live' || coverage.quality === 'reconnaissance') {
    warnings.push(
      `The route window was coarsened to ${coverage.cols}×${coverage.rows} cells to keep the search bounded. Geometry is preliminary and can miss hazards smaller than one cell.`,
    );
  }
  if (Math.abs((meta.extent.northLat + meta.extent.southLat) / 2) > 80) {
    warnings.push(
      'Near-polar DEM window: east-west ground spacing shrinks sharply with latitude; route geometry is approximate and polar projection display may be needed.',
    );
  }
  if (params.maxSlopeDeg !== DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg) {
    warnings.push(
      `Slope threshold overridden to ${params.maxSlopeDeg}° (prototype default 35°). Not an operational safety limit.`,
    );
  }
  warnings.push(
    `PROTOTYPE COST MODEL: accounts for slope only (cost = distance × (1 + ${params.slopeCostPerDeg}·slope°)); no rock abundance, regolith, thermal, communications, or other mission factors. "Cost" is terrain-difficulty-equivalent metres, not time, energy, or risk.`,
  );
  warnings.push(
    'PROPOSED TERRAIN-COST CANDIDATE — not a validated or safe route. It is not suitable for landing-site certification, surface operations, or life-safety decisions.',
  );

  const centreLat = (meta.extent.northLat + meta.extent.southLat) / 2;
  const equatorMpp = meta.cellSizeDegX * MARS_METRES_PER_DEGREE;
  const centreMpp = equatorMpp * Math.cos((centreLat * Math.PI) / 180);

  return {
    ok: true,
    result: {
      start: startPoint,
      target: targetPoint,
      snappedStart,
      snappedTarget,
      params,
      points,
      totalGroundDistanceM: points[points.length - 1]?.cumulativeGroundM ?? 0,
      totalCostM: points[points.length - 1]?.cumulativeCostM ?? 0,
      directDistanceM,
      maxSlopeDeg,
      meanSlopeDeg: slopeCount > 0 ? slopeSum / slopeCount : null,
      elevationMinM: Number.isFinite(elevationMin) ? elevationMin : Number.NaN,
      elevationMaxM: Number.isFinite(elevationMax) ? elevationMax : Number.NaN,
      warnings,
      provenance: {
        gridDatasetId: meta.datasetId,
        gridSourceService: meta.sourceService,
        gridSourceMethod: meta.sourceMethod,
        gridPreparedAt: source.acquiredAt,
        gridCentreValidation: meta.centreValidation,
        gridResolutionNote: `${equatorMpp.toFixed(0)} m/px nominal at the equator (~${centreMpp.toFixed(0)} m east-west at the grid centre, ${formatLatitude(centreLat)})`,
        verticalReference: meta.verticalReference,
        gridSourceKind: source.mode,
      },
      coverage,
      computedAt: new Date().toISOString(),
    },
  };
}
