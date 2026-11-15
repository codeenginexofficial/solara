/**
 * Route computation worker.
 *
 * Prepared Jezero grids and live global DEM windows are both supported.
 * The worker chooses the prepared grid when its extent covers the route
 * window; otherwise it fetches a bounded NASA Trek exportImage window.
 *
 * Search: A* over the 8-connected grid (no corner cutting through unknown
 * corners). Edge costs follow science/terrain/cost.ts. Unknown elevations
 * are impassable. The result is a PROPOSED TERRAIN-COST CANDIDATE, never a
 * "safe" or validated route.
 *
 * Ol-free: nothing from src/map may be imported here (Architecture §7).
 */

import {
  fetchElevationGrid,
  type ElevationGrid,
  type ElevationGridMeta,
} from '../data/adapters/elevationGrid';
import { DemExportError, fetchDemWindowGrid } from '../data/adapters/demExport';
import {
  DEFAULT_ROUTE_COST_PARAMS,
  type RouteCostParams,
} from '../science/terrain/cost';
import {
  buildRouteWindow,
  normalizeRoutePoint,
  RouteWindowError,
  windowFitsExtent,
} from '../science/terrain/routeGrid';
import { planRouteOnGrid, type RouteGridSource } from '../science/terrain/routePlanner';
import type {
  GeoPoint,
  RouteCoverage,
  RouteErrorCode,
  RoutePoint,
  RouteProvenance,
  RouteResult,
} from '../science/terrain/routeTypes';

export type {
  GeoPoint,
  RouteCoverage,
  RouteErrorCode,
  RoutePoint,
  RouteProvenance,
  RouteResult,
};

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
  /** Prepared local grid asset; used when it covers the route window. */
  assetUrl?: string;
  /** Live Trek ImageServer exportImage endpoint for global windows. */
  demExportUrl?: string;
}

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

let preparedGrid: ElevationGrid | null = null;
let preparedGridUrl: string | null = null;
let preparedGridPromise: Promise<ElevationGrid | null> | null = null;

async function ensurePreparedGrid(requestId: number, assetUrl: string): Promise<ElevationGrid | null> {
  if (preparedGrid && preparedGridUrl === assetUrl) return preparedGrid;
  if (preparedGridPromise && preparedGridUrl === assetUrl) return preparedGridPromise;
  preparedGridUrl = assetUrl;
  preparedGridPromise = (async () => {
    try {
      const grid = await fetchElevationGrid(assetUrl);
      preparedGrid = grid;
      post({ type: 'grid-loaded', requestId, meta: grid.meta });
      return grid;
    } catch {
      return null;
    }
  })();
  return preparedGridPromise;
}

function validParams(input: Partial<RouteCostParams> | undefined): RouteCostParams {
  return {
    slopeCostPerDeg:
      typeof input?.slopeCostPerDeg === 'number' &&
      Number.isFinite(input.slopeCostPerDeg) &&
      input.slopeCostPerDeg >= 0
        ? input.slopeCostPerDeg
        : DEFAULT_ROUTE_COST_PARAMS.slopeCostPerDeg,
    maxSlopeDeg:
      typeof input?.maxSlopeDeg === 'number' &&
      Number.isFinite(input.maxSlopeDeg) &&
      input.maxSlopeDeg > 0 &&
      input.maxSlopeDeg < 90
        ? input.maxSlopeDeg
        : DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg,
  };
}

let requestSerial = Promise.resolve();

self.onmessage = (event: MessageEvent<ComputeRouteRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'compute-route') return;
  const requestId = request.requestId;

  requestSerial = requestSerial.then(async () => {
    try {
      const startValidation = normalizeRoutePoint(request.start.lon, request.start.lat);
      if (!startValidation.ok) {
        post({
          type: 'route-error',
          requestId,
          code: 'invalid-coordinate',
          error: `Start: ${startValidation.message}`,
        });
        return;
      }
      const targetValidation = normalizeRoutePoint(request.target.lon, request.target.lat);
      if (!targetValidation.ok) {
        post({
          type: 'route-error',
          requestId,
          code: 'invalid-coordinate',
          error: `Target: ${targetValidation.message}`,
        });
        return;
      }
      const start = startValidation.point;
      const target = targetValidation.point;
      const params = validParams(request.params);

      let window;
      try {
        window = buildRouteWindow(start, target);
      } catch (error) {
        post({
          type: 'route-error',
          requestId,
          code: error instanceof RouteWindowError ? 'invalid-coordinate' : 'invalid-params',
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      let grid: ElevationGrid;
      let source: RouteGridSource;
      const localGrid = request.assetUrl ? await ensurePreparedGrid(requestId, request.assetUrl) : null;
      if (localGrid && windowFitsExtent(window.extent, localGrid.meta.extent)) {
        grid = localGrid;
        source = {
          mode: 'prepared-local',
          datelineSegments: 1,
          acquiredAt: localGrid.meta.preparedAt,
        };
      } else {
        if (!request.demExportUrl) {
          post({
            type: 'route-error',
            requestId,
            code: 'grid-not-loaded',
            error:
              'This route extends beyond the prepared local elevation grid and no live global DEM endpoint is configured.',
          });
          return;
        }
        const live = await fetchDemWindowGrid(window, request.demExportUrl);
        grid = live.grid;
        source = {
          mode: 'live-export',
          datelineSegments: live.datelineSegments,
          acquiredAt: live.acquiredAt,
          seamBridgedCells: live.seamBridgedCells,
        };
      }

      const outcome = planRouteOnGrid(grid, start, target, params, source);
      if (!outcome.ok) {
        post({
          type: 'route-error',
          requestId,
          code: outcome.code,
          error: outcome.message,
        });
        return;
      }
      post({ type: 'route-result', requestId, result: outcome.result });
    } catch (error) {
      const code =
        error instanceof DemExportError
          ? error.code
          : (error as { code?: RouteErrorCode }).code ?? 'dem-unavailable';
      post({
        type: 'route-error',
        requestId,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
