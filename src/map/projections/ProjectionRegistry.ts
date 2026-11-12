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

/** Working projection id: metre-based Mars equirectangular (IAU 2015 sphere).
 *  Internal identifier — not an authority-registered code. */
export const MARS_EQUIRECTANGULAR = 'SOLARA:MARS_EQC_IAU2015';

/** Geographic lon/lat (degrees) on the Mars 2000 sphere.
 *  Internal identifier used for display and reference transforms. */
export const MARS_GEOGRAPHIC = 'SOLARA:MARS_2000_SPHERE_LONLAT';

/** The CRS URN exactly as declared by the NASA Trek WMTS document.
 *  Preserved as source metadata; see the authority investigation above —
 *  it does not resolve to the projected CRS the service actually serves. */
export const TREK_DECLARED_CRS_URN = 'urn:ogc:def:crs:EPSG::104905';

export const MARS_2000_SPHERE_RADIUS_M = 3_396_190;

/** Metres along the equator per degree of longitude on the Mars 2000 sphere:
 *  2πR / 360. */
export const MARS_METRES_PER_DEGREE = (2 * Math.PI * MARS_2000_SPHERE_RADIUS_M) / 360;

/** Verified parameters of the served projection (see header): the PROJ
 *  export of IAU:2015:49910. */
const MARS_EQC_PROJ4 =
  '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';

const MARS_GEOGRAPHIC_PROJ4 = '+proj=longlat +R=3396190 +no_defs';

/** CRS descriptions shown in the UI. Honest about internal vs authoritative. */
export const PROJECTION_INFO = {
  [MARS_EQUIRECTANGULAR]: {
    id: MARS_EQUIRECTANGULAR,
    label:
      'SOLARA:MARS_EQC_IAU2015 — internal id; numerically equivalent to IAU:2015:49910 (Mars sphere equirectangular, clon 0)',
    datum: 'Mars sphere, R = 3,396,190 m (IAU 2015; anchor: Viking 1 lander, 47.95137°W)',
    units: 'metres',
    proj4: MARS_EQC_PROJ4,
    sourceDefinition: TREK_DECLARED_CRS_URN,
  },
  [MARS_GEOGRAPHIC]: {
    id: MARS_GEOGRAPHIC,
    label: 'SOLARA:MARS_2000_SPHERE_LONLAT — internal id; geographic lon/lat on the Mars 2000 sphere',
    datum: 'Mars sphere, R = 3,396,190 m (IAU 2015)',
    units: 'degrees',
    proj4: MARS_GEOGRAPHIC_PROJ4,
    sourceDefinition: 'Derived from the same sphere as IAU:2015:49900 (Mars (2015) - Sphere)',
  },
} as const;

let registered = false;

/** Register Mars projections with proj4 and OpenLayers. Idempotent. */
export function ensureMarsProjectionsRegistered(): void {
  if (registered) return;
  proj4.defs(MARS_EQUIRECTANGULAR, MARS_EQC_PROJ4);
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
