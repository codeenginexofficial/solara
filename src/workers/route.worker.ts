/**
 * Route computation worker — A* over the prepared elevation grid.
 *
 * Runs entirely off the main thread. The worker loads the prepared,
 * centre-validated elevation grid asset itself (see
 * data/adapters/elevationGrid.ts), then answers compute-route requests.
 *
 * Search: A* over the 8-connected grid (no corner cutting through unknown
 * corners). Edge costs follow science/terrain/cost.ts:
 *   cost = ground × (1 + slopeCostPerDeg × slopeDeg), blocked above
 *   maxSlopeDeg. Edges into unknown (NoData) terrain are impassable.
 * Heuristic: straight-line ground distance (admissible).
 *
 * The result is a PROPOSED TERRAIN-COST CANDIDATE, never a "safe" or
 * validated route — the cost model accounts for slope only.
 *
 * Ol-free: nothing from src/map may be imported here (Architecture §7).
 */

import {
  fetchElevationGrid,
  type ElevationGrid,
  type ElevationGridMeta,
} from '../data/adapters/elevationGrid';
import {
  edgeCostBetween,
  heuristicMeters,
  NEIGHBOUR_OFFSETS,
  DEFAULT_ROUTE_COST_PARAMS,
  type RouteCostParams,
} from '../science/terrain/cost';
import { groundDistanceMeters, MARS_SPHERE_RADIUS_M } from '../science/terrain/geometry';

const MARS_METRES_PER_DEGREE = (2 * Math.PI * MARS_SPHERE_RADIUS_M) / 360;

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface RoutePoint {
  lon: number;
  lat: number;
  elevM: number;
  /** Ground distance walked from the start, metres. */
  cumulativeGroundM: number;
  /** Terrain-cost-equivalent distance from the start, metres. */
  cumulativeCostM: number;
  /** Slope of the step from the previous point (null at the start). */
  slopeInDeg: number | null;
}

export interface RouteProvenance {
  gridDatasetId: string;
  gridSourceService: string;
  gridSourceMethod: string;
  gridPreparedAt: string;
  gridCentreValidation: ElevationGridMeta['centreValidation'];
  gridResolutionNote: string;
  verticalReference: string;
}

export interface RouteResult {
  start: GeoPoint;
  target: GeoPoint;
  /** Actual path start/end after snapping to known-elevation cells. */
  snappedStart: GeoPoint;
  snappedTarget: GeoPoint;
  params: RouteCostParams;
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
  computedAt: string;
}

export type RouteErrorCode =
  | 'grid-not-loaded'
  | 'start-outside'
  | 'target-outside'
  | 'start-unknown'
  | 'target-unknown'
  | 'no-path'
  | 'invalid-params';

export type WorkerOutbound =
  | { type: 'grid-loaded'; requestId: number; meta: ElevationGridMeta }
  | { type: 'grid-error'; requestId: number; error: string }
  | { type: 'route-result'; requestId: number; result: RouteResult }
  | { type: 'route-error'; requestId: number; code: RouteErrorCode; error: string };

export interface ComputeRouteRequest {
  type: 'compute-route';
  requestId: number;
  start: GeoPoint;
  target: GeoPoint;
  params?: Partial<RouteCostParams>;
  /** Grid asset URL; required for the first request. */
  assetUrl: string;
}

/* ------------------------------------------------------------------ */
/* Binary min-heap keyed by f-score (plain arrays for speed).          */
/* ------------------------------------------------------------------ */

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
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[smallest]!) smallest = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.values[a]!;
    this.values[a] = this.values[b]!;
    this.values[b] = v;
  }
}

/* ------------------------------------------------------------------ */
/* Grid helpers                                                        */
/* ------------------------------------------------------------------ */

let grid: ElevationGrid | null = null;

function cellCentreLonLat(g: ElevationGrid, col: number, row: number): GeoPoint {
  const { meta } = g;
  return {
    lon: meta.extent.westLon + (col + 0.5) * meta.cellSizeDegX,
    lat: meta.extent.northLat - (row + 0.5) * meta.cellSizeDegY,
  };
}

/** Nearest cell column/row for a geographic point (clamped to the grid). */
function nearestCell(g: ElevationGrid, lon: number, lat: number): { col: number; row: number } {
  const { meta, cols, rows } = g;
  const col = Math.round((lon - meta.extent.westLon) / meta.cellSizeDegX - 0.5);
  const row = Math.round((meta.extent.northLat - lat) / meta.cellSizeDegY - 0.5);
  return {
    col: Math.max(0, Math.min(cols - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

/**
 * Find the nearest valid cell (elevation known) to a target cell, searching
 * rings outward up to maxRadius cells. Returns null when none is found.
 */
function nearestValidCell(
  g: ElevationGrid,
  col: number,
  row: number,
  maxRadius: number,
): { col: number; row: number } | null {
  const { cols, rows, valid } = g;
  const idx = (c: number, r: number) => r * cols + c;
  for (let radius = 0; radius <= maxRadius; radius++) {
    if (radius === 0) {
      if (valid[idx(col, row)]) return { col, row };
      continue;
    }
    // Ring cells with Chebyshev distance == radius.
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        if (valid[idx(c, r)]) return { col: c, row: r };
      }
    }
  }
  return null;
}

/** True when any cell within Chebyshev distance 1 of (col,row) is unknown. */
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

/* ------------------------------------------------------------------ */
/* A* search                                                           */
/* ------------------------------------------------------------------ */

interface AstarOutput {
  /** Cell indices from start (inclusive) to target (inclusive). */
  path: number[];
}

function astar(
  g: ElevationGrid,
  startCol: number,
  startRow: number,
  targetCol: number,
  targetRow: number,
  params: RouteCostParams,
): AstarOutput | null {
  const { cols, values, valid } = g;
  const n = cols * g.rows;
  const startIdx = startRow * cols + startCol;
  const targetIdx = targetRow * cols + targetCol;

  const gCost = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const heap = new MinHeap();
  const cellLonLat = (i: number): GeoPoint => {
    const row = Math.floor(i / cols);
    const col = i - row * cols;
    return cellCentreLonLat(g, col, row);
  };

  const targetCentre = cellLonLat(targetIdx);
  const h = (i: number): number => {
    const p = cellLonLat(i);
    return heuristicMeters(p.lon, p.lat, targetCentre.lon, targetCentre.lat);
  };

  gCost[startIdx] = 0;
  heap.push(h(startIdx), startIdx);

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current === targetIdx) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const crow = Math.floor(current / cols);
    const ccol = current - crow * cols;
    const curCentre = cellLonLat(current);
    const curElev = values[current]!;

    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const ncol = ccol + dx;
      const nrow = crow + dy;
      if (ncol < 0 || ncol >= cols || nrow < 0 || nrow >= g.rows) continue;      const nIdx = nrow * cols + ncol;
      if (!valid[nIdx] || closed[nIdx]) continue;

      // No corner cutting: a diagonal step requires BOTH orthogonal
      // neighbours to be known terrain (never squeeze past an unknown).
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        const sideA = crow * cols + (ccol + dx);
        const sideB = (crow + dy) * cols + ccol;
        if (!valid[sideA] || !valid[sideB]) continue;
      }

      const nCentre = cellCentreLonLat(g, ncol, nrow);
      const nElev = values[nIdx]!;
      const edge = edgeCostBetween(
        curCentre.lon,
        curCentre.lat,
        curElev,
        nCentre.lon,
        nCentre.lat,
        nElev,
        params,
      );
      if (!Number.isFinite(edge.cost)) continue;

      const tentative = gCost[current]! + edge.cost;
      if (tentative < gCost[nIdx]!) {
        gCost[nIdx] = tentative;
        cameFrom[nIdx] = current;
        heap.push(tentative + h(nIdx), nIdx);
      }
    }
  }

  if (!Number.isFinite(gCost[targetIdx]!)) return null;

  // Reconstruct path (start -> target).
  const path: number[] = [];
  for (let i = targetIdx; i !== -1; i = cameFrom[i]!) {
    path.push(i);
    if (i === startIdx) break;
  }
  path.reverse();
  return { path };
}

/* ------------------------------------------------------------------ */
/* Route building from an A* path                                      */
/* ------------------------------------------------------------------ */

function buildRouteResult(
  g: ElevationGrid,
  requestedStart: GeoPoint,
  requestedTarget: GeoPoint,
  snappedStartCell: { col: number; row: number },
  snappedTargetCell: { col: number; row: number },
  astarOut: AstarOutput,
  params: RouteCostParams,
): RouteResult {
  const { cols, values, meta } = g;

  // Walk the path accumulating ground distance and cost from stored edges.
  // gCost values already accumulate edge.cost (terrain-cost metres); ground
  // distances come from prevGround per node.
  const points: RoutePoint[] = [];
  let cumulativeGround = 0;
  let cumulativeCost = 0;
  let prevGround = 0;
  let prevCost = 0;
  let prevSlope = Number.NaN;
  for (let k = 0; k < astarOut.path.length; k++) {
    const i = astarOut.path[k]!;
    const row = Math.floor(i / cols);
    const col = i - row * cols;
    const centre = cellCentreLonLat(g, col, row);
    const elev = values[i]!;
    if (k > 0) {
      cumulativeGround += prevGround;
      cumulativeCost += prevCost;
    }
    points.push({
      lon: centre.lon,
      lat: centre.lat,
      elevM: elev,
      cumulativeGroundM: cumulativeGround,
      cumulativeCostM: cumulativeCost,
      slopeInDeg: k === 0 ? null : Number.isNaN(prevSlope) ? null : prevSlope,
    });
    // Edge metrics for the step INTO the next node are attached to that node
    // by the search; read them for the NEXT iteration.
    const next = astarOut.path[k + 1];
    if (next !== undefined) {
      const nextRow = Math.floor(next / cols);
      const nextCol = next - nextRow * cols;
      const nextCentre = cellCentreLonLat(g, nextCol, nextRow);
      const edge = edgeCostBetween(
        centre.lon,
        centre.lat,
        elev,
        nextCentre.lon,
        nextCentre.lat,
        values[next]!,
        params,
      );
      prevGround = edge.groundM;
      prevCost = edge.cost;
      prevSlope = edge.slopeDeg ?? Number.NaN;
    }
  }

  const totalGroundDistanceM =
    points.length > 0 ? points[points.length - 1]!.cumulativeGroundM : 0;
  const totalCostM = points.length > 0 ? points[points.length - 1]!.cumulativeCostM : 0;

  // Elevation statistics along the path.
  let elevMin = Infinity;
  let elevMax = -Infinity;
  let slopeSum = 0;
  let slopeCount = 0;
  let maxSlopeDeg: number | null = null;
  for (const p of points) {
    if (p.elevM < elevMin) elevMin = p.elevM;
    if (p.elevM > elevMax) elevMax = p.elevM;
    if (p.slopeInDeg !== null) {
      slopeSum += p.slopeInDeg;
      slopeCount++;
      if (maxSlopeDeg === null || p.slopeInDeg > maxSlopeDeg) maxSlopeDeg = p.slopeInDeg;
    }
  }

  // Warnings.
  const warnings: string[] = [];
  const directDistanceM = groundDistanceMeters(
    requestedStart.lon,
    requestedStart.lat,
    requestedTarget.lon,
    requestedTarget.lat,
  );

  const snappedStart = cellCentreLonLat(g, snappedStartCell.col, snappedStartCell.row);
  const snappedTarget = cellCentreLonLat(g, snappedTargetCell.col, snappedTargetCell.row);
  if (groundDistanceMeters(requestedStart.lon, requestedStart.lat, snappedStart.lon, snappedStart.lat) > 1) {
    const d = groundDistanceMeters(requestedStart.lon, requestedStart.lat, snappedStart.lon, snappedStart.lat);
    warnings.push(
      `Start snapped to the nearest cell with known elevation (${Math.round(d)} m away).`,
    );
  }
  if (groundDistanceMeters(requestedTarget.lon, requestedTarget.lat, snappedTarget.lon, snappedTarget.lat) > 1) {
    const d = groundDistanceMeters(requestedTarget.lon, requestedTarget.lat, snappedTarget.lon, snappedTarget.lat);
    warnings.push(
      `Target snapped to the nearest cell with known elevation (${Math.round(d)} m away).`,
    );
  }

  let nearUnknown = false;
  for (const i of astarOut.path) {
    const row = Math.floor(i / cols);
    const col = i - row * cols;
    if (hasUnknownNeighbour(g, col, row)) {
      nearUnknown = true;
      break;
    }
  }
  if (nearUnknown) {
    warnings.push(
      'The path passes within one grid cell of terrain with unknown elevation. Segment-level uncertainty is not quantified here.',
    );
  }

  warnings.push(
    `PROTOTYPE COST MODEL: accounts for slope only (cost = distance × (1 + ${params.slopeCostPerDeg}·slope°)); no rock abundance, regolith, thermal, communications, or other mission factors. "Cost" is terrain-difficulty-equivalent metres, not time, energy, or risk.`,
  );
  warnings.push(
    `Terrain data is the ~${Math.round(meta.cellSizeDegX * MARS_METRES_PER_DEGREE)} m/px MOLA+HRSC blend — regional detail only; rock-scale hazards are not represented.`,
  );
  if (params.maxSlopeDeg !== DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg) {
    warnings.push(
      `Slope threshold overridden to ${params.maxSlopeDeg}° (prototype default 35°). Not an operational safety limit.`,
    );
  }

  return {
    start: requestedStart,
    target: requestedTarget,
    snappedStart,
    snappedTarget,
    params,
    points,
    totalGroundDistanceM,
    totalCostM,
    directDistanceM,
    maxSlopeDeg,
    meanSlopeDeg: slopeCount > 0 ? slopeSum / slopeCount : null,
    elevationMinM: Number.isFinite(elevMin) ? elevMin : Number.NaN,
    elevationMaxM: Number.isFinite(elevMax) ? elevMax : Number.NaN,
    warnings,
    provenance: {
      gridDatasetId: meta.datasetId,
      gridSourceService: meta.sourceService,
      gridSourceMethod: meta.sourceMethod,
      gridPreparedAt: meta.preparedAt,
      gridCentreValidation: meta.centreValidation,
      gridResolutionNote: (() => {
        const centreLat = (meta.extent.northLat + meta.extent.southLat) / 2;
        const equatorMpp = meta.cellSizeDegX * MARS_METRES_PER_DEGREE;
        const centreMpp = equatorMpp * Math.cos((centreLat * Math.PI) / 180);
        return `${equatorMpp.toFixed(0)} m/px nominal at the equator (~${centreMpp.toFixed(0)} m east-west at the grid centre, ${centreLat.toFixed(2)}°N)`;
      })(),
      verticalReference: meta.verticalReference,
    },
    computedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Message handling                                                    */
/* ------------------------------------------------------------------ */

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

let gridLoadSerial = Promise.resolve();

async function ensureGrid(requestId: number, assetUrl: string): Promise<ElevationGrid> {
  if (grid) return grid;
  if (!assetUrl) {
    throw Object.assign(new Error('Grid asset URL was not provided.'), { code: 'grid-not-loaded' as const });
  }
  grid = await fetchElevationGrid(assetUrl);
  post({ type: 'grid-loaded', requestId, meta: grid.meta });
  return grid;
}

self.onmessage = (event: MessageEvent<ComputeRouteRequest>) => {
  const req = event.data;
  if (!req || req.type !== 'compute-route') return;
  const requestId = req.requestId;

  // Serialize grid load + computations; each compute uses the latest grid.
  gridLoadSerial = gridLoadSerial.then(async () => {
    try {
      if (!Number.isFinite(req.start.lon) || !Number.isFinite(req.start.lat) || !Number.isFinite(req.target.lon) || !Number.isFinite(req.target.lat)) {
        post({ type: 'route-error', requestId, code: 'invalid-params', error: 'Start/target coordinates are not finite numbers.' });
        return;
      }
      const params: RouteCostParams = {
        slopeCostPerDeg:
          typeof req.params?.slopeCostPerDeg === 'number' && Number.isFinite(req.params.slopeCostPerDeg) && req.params.slopeCostPerDeg >= 0
            ? req.params.slopeCostPerDeg
            : DEFAULT_ROUTE_COST_PARAMS.slopeCostPerDeg,
        maxSlopeDeg:
          typeof req.params?.maxSlopeDeg === 'number' && Number.isFinite(req.params.maxSlopeDeg) && req.params.maxSlopeDeg > 0 && req.params.maxSlopeDeg < 90
            ? req.params.maxSlopeDeg
            : DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg,
      };

      const g = await ensureGrid(requestId, req.assetUrl);

      // Snap requested points to known-elevation cells.
      const rawStart = nearestCell(g, req.start.lon, req.start.lat);
      const rawTarget = nearestCell(g, req.target.lon, req.target.lat);
      const inBounds = (p: GeoPoint) =>
        p.lon >= g.meta.extent.westLon && p.lon <= g.meta.extent.eastLon && p.lat >= g.meta.extent.southLat && p.lat <= g.meta.extent.northLat;
      if (!inBounds(req.start)) {
        post({ type: 'route-error', requestId, code: 'start-outside', error: 'Start is outside the prepared elevation grid extent.' });
        return;
      }
      if (!inBounds(req.target)) {
        post({ type: 'route-error', requestId, code: 'target-outside', error: 'Target is outside the prepared elevation grid extent.' });
        return;
      }
      const startCell = nearestValidCell(g, rawStart.col, rawStart.row, 5);
      if (!startCell) {
        post({ type: 'route-error', requestId, code: 'start-unknown', error: 'No known-elevation cell near the start point.' });
        return;
      }
      const targetCell = nearestValidCell(g, rawTarget.col, rawTarget.row, 5);
      if (!targetCell) {
        post({ type: 'route-error', requestId, code: 'target-unknown', error: 'No known-elevation cell near the target point.' });
        return;
      }

      const out = astar(g, startCell.col, startCell.row, targetCell.col, targetCell.row, params);
      if (!out) {
        post({
          type: 'route-error',
          requestId,
          code: 'no-path',
          error: 'No terrain-cost candidate found: unknown or too-steep terrain separates start and target under the current cost model.',
        });
        return;
      }

      const result = buildRouteResult(g, req.start, req.target, startCell, targetCell, out, params);
      post({ type: 'route-result', requestId, result });
    } catch (e) {
      const code = (e as { code?: string }).code === 'grid-not-loaded' ? 'grid-not-loaded' : undefined;
      if (code === 'grid-not-loaded') {
        post({ type: 'grid-error', requestId, error: e instanceof Error ? e.message : String(e) });
      } else {
        post({
          type: 'route-error',
          requestId,
          code: code ?? 'grid-not-loaded',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });
};
