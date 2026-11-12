/**
 * Mars projection registry.
 *
 * CRS policy (Architecture.md §6):
 *  1. Mars coordinates are never assigned EPSG:4326.
 *  2. The projection used for rendering is defined from verified parameters.
 *  3. The source's original CRS definition is preserved alongside the
 *     working projection.
 *
 * Verified basis (NASA Trek WMTSCapabilities.xml, JEZ_ctx_B_soc_008 layer,
 * checked 2026-11-12):
 *  - TileMatrixSet `default028mm` declares SupportedCRS
 *    `urn:ogc:def:crs:EPSG::104905`.
 *  - EPSG:104905 is "IAU 2015 Mars / Equirectangular": an equidistant
 *    cylindrical projection on the Mars 2000 sphere (mean radius
 *    3,396,190 m), standard parallel 0°, central meridian 0°, projected
 *    units metres, east-positive longitudes. On a sphere, planetocentric
 *    and planetographic latitudes are numerically identical.
 *  - The WMTS tile matrix itself is a plate carrée (degree-based) grid:
 *    TopLeftCorner (-180°, 90°), 256×256 tiles, matrix size 2^(L+1) × 2^L.
 *    SOLARA therefore renders the map view in metre-based EPSG:104905 and
 *    converts the degree-based tile grid into metres with the exact sphere
 *    equations (see map/trek/tileGrid.ts).
 */

import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection } from 'ol/proj.js';
import type { Projection } from 'ol/proj.js';

/** Working projection id: metre-based Mars equirectangular (IAU 2015). */
export const MARS_EQUIRECTANGULAR = 'EPSG:104905';

/** Geographic lon/lat (degrees) on the Mars 2000 sphere.
 *  Not an EPSG code: this is SOLARA's own id for display/reference transforms,
 *  derived from the EPSG:104905 base sphere. */
export const MARS_GEOGRAPHIC = 'MARS-2000-SPHERE-LONGLAT';

export const MARS_2000_SPHERE_RADIUS_M = 3_396_190;

/** Metres along the equator per degree of longitude on the Mars 2000 sphere:
 *  2πR / 360. */
export const MARS_METRES_PER_DEGREE = (2 * Math.PI * MARS_2000_SPHERE_RADIUS_M) / 360;

const EPSG_104905_PROJ4 =
  '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';

const MARS_GEOGRAPHIC_PROJ4 = '+proj=longlat +R=3396190 +no_defs';

/** Authoritative CRS descriptions shown in the UI. */
export const PROJECTION_INFO = {
  [MARS_EQUIRECTANGULAR]: {
    id: MARS_EQUIRECTANGULAR,
    label: 'EPSG:104905 — Mars / Equirectangular (IAU 2015)',
    datum: 'Mars 2000 sphere, R = 3,396,190 m',
    units: 'metres',
    proj4: EPSG_104905_PROJ4,
    sourceDefinition: 'urn:ogc:def:crs:EPSG::104905',
  },
  [MARS_GEOGRAPHIC]: {
    id: MARS_GEOGRAPHIC,
    label: 'Mars geographic lon/lat (Mars 2000 sphere)',
    datum: 'Mars 2000 sphere, R = 3,396,190 m',
    units: 'degrees',
    proj4: MARS_GEOGRAPHIC_PROJ4,
    sourceDefinition: 'Derived from the EPSG:104905 base sphere',
  },
} as const;

let registered = false;

/** Register Mars projections with proj4 and OpenLayers. Idempotent. */
export function ensureMarsProjectionsRegistered(): void {
  if (registered) return;
  proj4.defs(MARS_EQUIRECTANGULAR, EPSG_104905_PROJ4);
  proj4.defs(MARS_GEOGRAPHIC, MARS_GEOGRAPHIC_PROJ4);
  register(proj4);
  registered = true;
}

export function getMarsEquirectangular(): Projection {
  ensureMarsProjectionsRegistered();
  const p = getProjection(MARS_EQUIRECTANGULAR);
  if (!p) throw new Error(`Projection ${MARS_EQUIRECTANGULAR} failed to register`);
  return p;
}

export function getMarsGeographic(): Projection {
  ensureMarsProjectionsRegistered();
  const p = getProjection(MARS_GEOGRAPHIC);
  if (!p) throw new Error(`Projection ${MARS_GEOGRAPHIC} failed to register`);
  return p;
}

/** Convert geographic degrees (lon, lat) to EPSG:104905 metres. */
export function lonLatToMarsMetres(lonDeg: number, latDeg: number): [number, number] {
  ensureMarsProjectionsRegistered();
  const out = proj4(MARS_GEOGRAPHIC, MARS_EQUIRECTANGULAR, [lonDeg, latDeg]);
  return [out[0] as number, out[1] as number];
}

/** Convert EPSG:104905 metres to geographic degrees (lon, lat). */
export function marsMetresToLonLat(x: number, y: number): [number, number] {
  ensureMarsProjectionsRegistered();
  const out = proj4(MARS_EQUIRECTANGULAR, MARS_GEOGRAPHIC, [x, y]);
  return [out[0] as number, out[1] as number];
}
