/**
 * Terrain-cost model for route candidates (prototype).
 *
 * COST MODEL — PROTOTYPE, not a validated human traverse model:
 *   edgeCost = groundDistance × (1 + slopeCostPerDeg × slopeDeg)
 *   edgeBlocked when slopeDeg > maxSlopeDeg (default 35°, a prototype
 *   threshold, not an operational safety limit).
 *
 * The model is deliberately simple and explicitly labelled in the UI:
 *  - It accounts for slope only. It knows nothing about rock abundance,
 *    regolith properties, crater rim hazards, dust, thermal constraints,
 *    communications, or any other real mission-planning factor.
 *  - "Cost" is a dimensionless terrain-difficulty-equivalent metres value
 *    (equivalent horizontal distance). It is not time, energy, or risk.
 *  - Elevation data is the ~200 m/px MOLA+HRSC blend — regional terrain,
 *    not hazard-grade detail (see the DEM dataset limitations).
 *
 * Ol-free; used by the route worker and the mission UI.
 */

import { groundDistanceMeters, slopeDegreesBetween } from './geometry';

export interface RouteCostParams {
  /** Extra cost per degree of slope along an edge (dimensionless per deg). */
  slopeCostPerDeg: number;
  /** Slopes steeper than this are impassable (prototype threshold, degrees). */
  maxSlopeDeg: number;
}

export const DEFAULT_ROUTE_COST_PARAMS: RouteCostParams = {
  slopeCostPerDeg: 0.08,
  maxSlopeDeg: 35,
};

/** Direction offsets of the 8-connected grid neighbourhood (no corner cutting
 *  is enforced separately by the search). */
export const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export interface EdgeCost {
  /** Passable edge cost in terrain-cost-equivalent metres, or Infinity. */
  cost: number;
  /** True when the edge was blocked by the slope threshold. */
  blockedBySlope: boolean;
  /** Slope along the edge in degrees (null when elevation unknown). */
  slopeDeg: number | null;
  /** Horizontal ground distance of the edge in metres. */
  groundM: number;
}

/**
 * Cost of stepping between two geographic points with known/unknown
 * elevations. Unknown elevations make the edge impassable: SOLARA never
 * routes across terrain whose height it does not know.
 */
export function edgeCostBetween(
  lonA: number,
  latA: number,
  elevA: number | null,
  lonB: number,
  latB: number,
  elevB: number | null,
  params: RouteCostParams,
): EdgeCost {
  const groundM = groundDistanceMeters(lonA, latA, lonB, latB);
  const slopeDeg = slopeDegreesBetween(elevA, elevB, groundM);
  if (slopeDeg === null || groundM <= 0) {
    return { cost: Infinity, blockedBySlope: false, slopeDeg, groundM };
  }
  if (slopeDeg > params.maxSlopeDeg) {
    return { cost: Infinity, blockedBySlope: true, slopeDeg, groundM };
  }
  const cost = groundM * (1 + params.slopeCostPerDeg * slopeDeg);
  return { cost, blockedBySlope: false, slopeDeg, groundM };
}

/**
 * Straight-line (as the crow flies) ground distance — used as the A*
 * heuristic. Admissible: every real edge costs at least its ground distance.
 */
export function heuristicMeters(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  return groundDistanceMeters(lonA, latA, lonB, latB);
}
