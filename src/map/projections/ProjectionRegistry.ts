/**
 * Mars projection registry.
 *
 * CRS policy (Architecture.md §6):
 *  1. Mars coordinates are never assigned EPSG:4326.
 *  2. The projection used for rendering is defined from verified parameters.
 *  3. The source's original CRS declaration is preserved alongside the
 *     working projection, and authority claims are never overstated.
 *
 * Authority investigation (2026-11-12, Milestone 0.1):
 *
 *  The NASA Trek WMTS document declares SupportedCRS
 *  `urn:ogc:def:crs:EPSG::104905`. That URN could NOT be resolved to a
 *  projected CRS:
 *   - The official EPSG registry (apps.epsg.org API) has no CRS 104905
 *     (HTTP 404), and EPSG has not adopted planetary CRS definitions
 *     (LPSC 2025 abstract #1659, "Planetary Coordinate Reference Systems
 *     for...").
 *   - Code 104905 DOES exist under the ESRI authority (ESRI:104905
 *     "Mars 2000" / GCS_Mars_2000) — but that is a GEOGRAPHIC CRS on the
 *     Mars 2000 ellipsoid (a = 3,396,190 m, 1/f = 169.894…), not a
 *     projected equirectangular CRS.
 *  The declared URN is therefore recorded verbatim as source metadata, but
 *  SOLARA does not claim its working projection is "EPSG:104905".
 *
 *  What the service actually serves was verified numerically in
 *  Milestone 0: an equirectangular (plate carrée) projection on the Mars
 *  sphere with R = 3,396,190 m, standard parallel 0°, central meridian 0°,
 *  false easting/northing 0, metre units — i.e. the parameters of
 *  IAU:2015:49910 "Mars (2015) - Sphere / Equirectangular, clon = 0"
 *  (official WKT2 from the IAU 2015 CRS registry, voparis-vespa-crs,
 *  method Equidistant Cylindrical EPSG:1028; base geographic CRS
 *  IAU:2015:49900 "Mars (2015) - Sphere", anchor: Viking 1 lander,
 *  47.95137°W). PROJ's own export of IAU:2015:49910 is exactly the proj4
 *  string used below (verified against the PROJ pipeline fixture). The
 *  mosaic footprint matched this sphere math at all four advertised
 *  bounding-box edges.
 *
 *  Internal identifiers (`SOLARA:…`) are SOLARA's own working ids. They are
 *  NOT claims of registration with any authority. The closest authoritative
 *  definition, and its numerical equivalence, is documented here and in
 *  Architecture.md §6.
 *
 *  On a sphere, planetocentric and planetographic latitudes are numerically
 *  identical, so the geographic helper can serve both readings; the IAU
 *  2015 sphere base CRS (49900) is ocentric with east-positive longitudes.
 *
 *  Known proj4 quirk (verified empirically on proj4 2.22.0): the eqc
 *  forward transform flips the sign of y at exactly ±90° latitude while
 *  every interior latitude maps correctly (y = R·φ). Pole coordinates are
 *  therefore computed analytically in map/trek/tileGrid.ts.
 */

import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection } from 'ol/proj.js';
import type { Projection } from 'ol/proj.js';

/* CRS ids, sphere constants and display metadata live in the ol-free
 * module src/lib/marsCrs.ts so shell components never pull proj4/ol here.
 * Re-exported to keep this registry's public API stable. */
export {
  MARS_EQUIRECTANGULAR,
  MARS_GEOGRAPHIC,
  TREK_DECLARED_CRS_URN,
  MARS_2000_SPHERE_RADIUS_M,
  MARS_METRES_PER_DEGREE,
  MARS_EQC_PROJ4,
  MARS_GEOGRAPHIC_PROJ4,
  PROJECTION_INFO,
} from '../../lib/marsCrs';

import {
  MARS_EQUIRECTANGULAR,
  MARS_GEOGRAPHIC,
  MARS_2000_SPHERE_RADIUS_M,
  MARS_EQC_PROJ4,
  MARS_GEOGRAPHIC_PROJ4,
} from '../../lib/marsCrs';

let registered = false;

/** Register Mars projections with proj4 and OpenLayers. Idempotent. */
export function ensureMarsProjectionsRegistered(): void {
  if (registered) return;
  proj4.defs(MARS_EQUIRECTANGULAR, MARS_EQC_PROJ4);
  proj4.defs(MARS_GEOGRAPHIC, MARS_GEOGRAPHIC_PROJ4);
  register(proj4);

  // ol's default getPointResolution estimates scale by transforming a pixel
  // window to EPSG:4326 and measuring it on the EARTH sphere (ol/proj.js,
  // getPointResolution estimation path; transform made available by
  // register(proj4)). For a Mars-sphere projection that inflates the estimate
  // by ≈ (R_earth/R_mars)·(1+cosφ)/2 — e.g. ×1.83 at φ = 18.5°N — which made
  // the ol ScaleLine control report ~1.83× too-small bars (verified
  // empirically 2026-11-13: view resolution 55.44 m/px rendered as if
  // ~202 m/px). The equirectangular projection is equidistant in x and y on
  // the sphere at lat_ts = 0, so the exact point resolution IS the view
  // resolution; supply it explicitly. (The geographic projection is never
  // used as a view projection, so it keeps ol's default behaviour.)
  getProjection(MARS_EQUIRECTANGULAR)?.setGetPointResolution(
    (resolution: number) => resolution,
  );
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

/** Convert geographic degrees (lon, lat) to working-projection metres. */
export function lonLatToMarsMetres(lonDeg: number, latDeg: number): [number, number] {
  ensureMarsProjectionsRegistered();
  const out = proj4(MARS_GEOGRAPHIC, MARS_EQUIRECTANGULAR, [lonDeg, latDeg]);
  return [out[0] as number, out[1] as number];
}

/** Convert working-projection metres to geographic degrees (lon, lat). */
export function marsMetresToLonLat(x: number, y: number): [number, number] {
  ensureMarsProjectionsRegistered();
  const out = proj4(MARS_EQUIRECTANGULAR, MARS_GEOGRAPHIC, [x, y]);
  return [out[0] as number, out[1] as number];
}

/**
 * Convert a geographic bounding box to a working-projection metres extent.
 *
 * Computed ANALYTICALLY (x = R·λ, y = R·φ on the sphere), never through
 * proj4: the verified proj4 quirk flips the sign of y at exactly ±90°
 * latitude, which silently collapses any pole-touching bounding box (e.g.
 * a global layer's north edge) to a degenerate extent — see the quirk note
 * in the header and map/trek/tileGrid.ts.
 */
export function marsBboxToMetresExtent(bbox: {
  westLon: number;
  eastLon: number;
  southLat: number;
  northLat: number;
}): [number, number, number, number] {
  const toRad = Math.PI / 180;
  const x0 = bbox.westLon * toRad * MARS_2000_SPHERE_RADIUS_M;
  const x1 = bbox.eastLon * toRad * MARS_2000_SPHERE_RADIUS_M;
  const y0 = bbox.southLat * toRad * MARS_2000_SPHERE_RADIUS_M;
  const y1 = bbox.northLat * toRad * MARS_2000_SPHERE_RADIUS_M;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}
