/**
 * Mission planning store — start/target, cost parameters, route state.
 *
 * A plain external store (useSyncExternalStore pattern). Holds NO ol
 * objects and NO React elements: only serializable values. The map layer
 * reacts to route/markers through props; science results arrive from the
 * route worker via workers/routeClient.
 *
 * Honesty (Context.md §7): the route is a PROPOSED TERRAIN-COST CANDIDATE.
 * It is never labelled safe/validated. Imported plans are marked imported
 * and are not silently re-verified.
 */

import { useSyncExternalStore } from 'react';
import { getDatasetById } from '../../data/catalog/datasets';
import type { ElevationGridMeta } from '../../data/adapters/elevationGrid';
import type { GeoPoint, RouteClientError, RouteErrorCode, RouteResult } from '../../workers/routeClient';
import { routeClient } from '../../workers/routeClient';
import { DEFAULT_ROUTE_COST_PARAMS, type RouteCostParams } from '../../science/terrain/cost';

export type RouteStatus = 'idle' | 'computing' | 'ready' | 'error';

export interface MissionState {
  start: GeoPoint | null;
  target: GeoPoint | null;
  params: RouteCostParams;
  routeStatus: RouteStatus;
  route: RouteResult | null;
  routeError: { code: RouteErrorCode; message: string } | null;
  /** Provenance of the loaded elevation grid (from the worker). */
  gridMeta: ElevationGridMeta | null;
  gridError: string | null;
  /** Set when the displayed route came from an imported plan file. */
  importedAt: string | null;
  /**
   * The astronaut position used by Field Tablet Mode. There is no Mars
   * positioning system in SOLARA — this is a manually selected or simulated
   * position and is always labelled as such.
   */
  position: GeoPoint | null;
}

let state: MissionState = {
  start: null,
  target: null,
  params: { ...DEFAULT_ROUTE_COST_PARAMS },
  routeStatus: 'idle',
  route: null,
  routeError: null,
  gridMeta: null,
  gridError: null,
  importedAt: null,
  position: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<MissionState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getMissionState(): MissionState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook for mission state. */
export function useMissionState(): MissionState {
  return useSyncExternalStore(subscribe, getMissionState, getMissionState);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function setStart(point: GeoPoint | null): void {
  computingRequest = null;
  setState({ start: point, routeStatus: 'idle', route: null, routeError: null, importedAt: null });
}

export function setTarget(point: GeoPoint | null): void {
  computingRequest = null;
  setState({ target: point, routeStatus: 'idle', route: null, routeError: null, importedAt: null });
}

/** Set the (manually selected / simulated) astronaut position. */
export function setPosition(point: GeoPoint | null): void {
  setState({ position: point });
}

export function setRouteParams(patch: Partial<RouteCostParams>): void {
  const params: RouteCostParams = { ...state.params, ...patch };
  if (!Number.isFinite(params.slopeCostPerDeg) || params.slopeCostPerDeg < 0) {
    params.slopeCostPerDeg = DEFAULT_ROUTE_COST_PARAMS.slopeCostPerDeg;
  }
  if (!Number.isFinite(params.maxSlopeDeg) || params.maxSlopeDeg <= 0 || params.maxSlopeDeg >= 90) {
    params.maxSlopeDeg = DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg;
  }
  computingRequest = null;
  setState({ params, routeStatus: 'idle', route: null, routeError: null, importedAt: null });
}

export function clearRoute(): void {
  computingRequest = null;
  setState({ routeStatus: 'idle', route: null, routeError: null, importedAt: null });
}

let computingRequest: symbol | null = null;

/** Compute the terrain-cost candidate from the current start/target. */
export function computeRoute(): void {
  const { start, target } = state;
  if (!start || !target) {
    setState({
      routeStatus: 'error',
      route: null,
      routeError: { code: 'invalid-params', message: 'Set a start and a target point first.' },
    });
    return;
  }
  const dataset = getDatasetById('mola-hrsc-blend-200m-dem');
  const assetUrl = dataset?.preparedAssetUrl;
  const demExportUrl = dataset?.exportImageEndpoint;
  if (!assetUrl && !demExportUrl) {
    setState({
      routeStatus: 'error',
      route: null,
      routeError: { code: 'grid-not-loaded', message: 'The elevation dataset is not configured.' },
    });
    return;
  }

  const thisRequest = Symbol('compute-route');
  computingRequest = thisRequest;
  setState({ routeStatus: 'computing', routeError: null, importedAt: null });

  void routeClient
    .computeRoute(start, target, state.params, { assetUrl, demExportUrl })
    .then((route) => {
      if (computingRequest !== thisRequest) return; // superseded
      computingRequest = null;
      setState({ routeStatus: 'ready', route, routeError: null });
    })
    .catch((e: RouteClientError) => {
      if (computingRequest !== thisRequest) return;
      computingRequest = null;
      setState({
        routeStatus: 'error',
        route: null,
        routeError: { code: e.code, message: e.message },
      });
    });
}

/** Subscribe to grid provenance from the route worker. */
routeClient.onGridLoaded((meta) => {
  setState({ gridMeta: meta, gridError: null });
});

/* ------------------------------------------------------------------ */
/* Plan export / import (solara-plan/1)                                */
/* ------------------------------------------------------------------ */

export const PLAN_FORMAT = 'solara-plan/1';

export interface PlanFile {
  format: string;
  createdAt: string;
  start: GeoPoint | null;
  target: GeoPoint | null;
  params: RouteCostParams;
  route: RouteResult | null;
  note: string;
}

/** Serialize the current mission state to a plan file object. */
export function buildPlanFile(): PlanFile {
  return {
    format: PLAN_FORMAT,
    createdAt: new Date().toISOString(),
    start: state.start,
    target: state.target,
    params: state.params,
    route: state.route,
    note:
      'Route is a PROPOSED TERRAIN-COST CANDIDATE from the SOLARA prototype cost model (slope only). Not validated for crew safety.',
  };
}

/**
 * Restore start/target/params (and, marked as imported, the route) from a
 * plan file. Rejects with Error when the file is not a solara-plan/1 file
 * or is internally inconsistent with the re-derived route data.
 */
export function importPlanFile(file: unknown): void {
  if (typeof file !== 'object' || file === null) {
    throw new Error('Plan file is not a JSON object.');
  }
  const f = file as Partial<PlanFile>;
  if (f.format !== PLAN_FORMAT) {
    throw new Error(`Unsupported plan format "${String(f.format)}" — expected "${PLAN_FORMAT}".`);
  }
  const validPoint = (p: unknown): p is GeoPoint =>
    typeof p === 'object' &&
    p !== null &&
    typeof (p as GeoPoint).lon === 'number' &&
    Number.isFinite((p as GeoPoint).lon) &&
    typeof (p as GeoPoint).lat === 'number' &&
    Number.isFinite((p as GeoPoint).lat);

  const start = validPoint(f.start) ? f.start : null;
  const target = validPoint(f.target) ? f.target : null;
  const params: RouteCostParams = {
    slopeCostPerDeg:
      typeof f.params?.slopeCostPerDeg === 'number' && Number.isFinite(f.params.slopeCostPerDeg)
        ? f.params.slopeCostPerDeg
        : DEFAULT_ROUTE_COST_PARAMS.slopeCostPerDeg,
    maxSlopeDeg:
      typeof f.params?.maxSlopeDeg === 'number' && Number.isFinite(f.params.maxSlopeDeg)
        ? f.params.maxSlopeDeg
        : DEFAULT_ROUTE_COST_PARAMS.maxSlopeDeg,
  };
  setRouteParams(params);
  setState({
    start,
    target,
    route: f.route ?? null,
    routeStatus: f.route ? 'ready' : 'idle',
    routeError: null,
    importedAt: new Date().toISOString(),
  });
}
