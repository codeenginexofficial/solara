/**
 * Tile grid construction for the NASA Trek EQ (equirectangular) WMTS layers.
 *
 * The Trek EQ tile matrix is a global, degree-based plate carrée pyramid:
 * TopLeftCorner (-180°, 90°), 256×256 tiles, matrix sizes 2^(L+1) × 2^L.
 * The declared ScaleDenominator values are NOT used: they are inconsistent
 * with the Mars sphere (see trekCapabilities.ts). Instead, the degree-per-
 * pixel resolution of each level is derived from the verified matrix geometry
 * (each level spans the full 360° of longitude) and converted to the exact
 * metre scale of EPSG:104905 (x = R·λ on the Mars 2000 sphere):
 *
 *   resolutionDeg(L) = 360° / (matrixWidth(L) × tileWidth)
 *   resolutionMetres(L) = resolutionDeg(L) × (2πR / 360)
 *
 * For this layer: level 13 serves 8.583e-5 °/px ≈ 5.087 m/px, consistent with
 * a ~5 m/px controlled mosaic (the product identifier's "6m" refers to the
 * nominal CTX imaging scale). This derivation was empirically validated:
 * with it, the mosaic footprint in real tiles matches the advertised
 * bounding box on all four sides.
 */

import WMTSTileGrid from 'ol/tilegrid/WMTS.js';
import type { TrekWmtsConfig } from './trekCapabilities';
import {
  MARS_2000_SPHERE_RADIUS_M,
  MARS_METRES_PER_DEGREE,
  lonLatToMarsMetres,
} from '../projections/ProjectionRegistry';

export interface MetreTileGridResult {
  tileGrid: WMTSTileGrid;
  /** Tile resolutions in metres per pixel (EPSG:104905). */
  resolutions: number[];
  /** Grid origin in EPSG:104905 metres (top-left of the global grid). */
  origin: [number, number];
  /** Full global extent in EPSG:104905 metres. */
  worldExtent: [number, number, number, number];
}

export function buildMetreTileGrid(config: TrekWmtsConfig): MetreTileGridResult {
  const first = config.matrices[0]!;
  // Grid origin: TopLeftCorner of level 0, converted from degrees to
  // EPSG:104905 metres. Validated to be (-180°, 90°) by the parser.
  //
  // Known proj4 quirk (verified empirically on proj4 2.22.0, 2026-11-12):
  // the eqc forward transform flips the sign of y at exactly ±90° latitude
  // (y(90°) = -πR/2, y(-90°) = +πR/2), while every interior latitude maps
  // correctly (y = R·φ). Pole coordinates are therefore computed
  // analytically: on the Mars 2000 sphere the top of the equirectangular
  // projection is y = +πR/2. This also keeps the origin at the TOP-left of
  // the grid, as the WMTS TopLeftCorner requires.
  const origin: [number, number] = [
    lonLatToMarsMetres(first.topLeftCorner[0], 0)[0],
    (Math.PI * MARS_2000_SPHERE_RADIUS_M) / 2,
  ];

  const resolutions = config.matrices.map((m) => {
    // Full longitudinal span is 360°: matrixWidth(L) × tileWidth pixels cover it.
    const resolutionDeg = 360 / (m.matrixWidth * m.tileWidth);
    return resolutionDeg * MARS_METRES_PER_DEGREE;
  });

  // World extent of the degree-based grid expressed in metres:
  // x ∈ [-πR, +πR], y ∈ [-πR/2, +πR/2]. Computed analytically for the same
  // proj4 ±90° reason as the origin above.
  const worldExtent: [number, number, number, number] = [
    -Math.PI * MARS_2000_SPHERE_RADIUS_M,
    (-Math.PI * MARS_2000_SPHERE_RADIUS_M) / 2,
    Math.PI * MARS_2000_SPHERE_RADIUS_M,
    (Math.PI * MARS_2000_SPHERE_RADIUS_M) / 2,
  ];

  const tileGrid = new WMTSTileGrid({
    origin: [origin[0], origin[1]],
    resolutions,
    matrixIds: config.matrices.map((m) => m.id),
    sizes: config.matrices.map((m) => [m.matrixWidth, m.matrixHeight]),
    tileSize: [first.tileWidth, first.tileHeight],
  });

  return { tileGrid, resolutions, origin, worldExtent };
}

/** Highest (finest) tile level available. */
export function maxTileLevel(config: TrekWmtsConfig): number {
  return config.matrices.length - 1;
}

/** Stable identity for comparing a live grid against the verified snapshot. */
export function gridFingerprint(config: TrekWmtsConfig): string {
  return JSON.stringify({
    layer: config.layer.identifier,
    tms: config.layer.tileMatrixSetIdentifier,
    style: config.layer.styleIdentifier,
    format: config.layer.format,
    template: config.layer.resourceUrlTemplate,
    crs: config.supportedCrs,
    bbox: config.layer.boundingBox,
    matrices: config.matrices.map((m) => [
      m.id,
      m.topLeftCorner,
      m.tileWidth,
      m.tileHeight,
      m.matrixWidth,
      m.matrixHeight,
    ]),
  });
}
