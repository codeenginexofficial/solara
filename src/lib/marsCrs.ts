/**
 * Mars CRS metadata — plain, ol-free constants shared by shell components
 * and the map layer. Keeping this module free of `ol`/`proj4` imports is
 * what keeps those libraries out of the statically-imported shell bundle.
 *
 * The projection definitions themselves live in
 * src/map/projections/ProjectionRegistry.ts (which re-exports these ids).
 */

/** Working projected CRS: equirectangular on the Mars 2000 sphere.
 *  Internal identifier — not an authority-registered code. */
export const MARS_EQUIRECTANGULAR = 'SOLARA:MARS_EQC_IAU2015';

/** Geographic lon/lat (degrees) on the Mars 2000 sphere.
 *  Internal identifier used for display and reference transforms. */
export const MARS_GEOGRAPHIC = 'SOLARA:MARS_2000_SPHERE_LONLAT';

/** Source CRS used by the Esri-hosted global Viking mosaic tiles. */
export const MARS_VIKING_MARSECO0 = 'SOLARA:MARS_VIKING_MARSECO0';

/** The CRS URN exactly as declared by the NASA Trek WMTS document.
 *  Preserved as source metadata — it does not resolve to the projected
 *  CRS the service actually serves (verified equivalent to IAU:2015:49910;
 *  see Architecture.md §6.1). */
export const TREK_DECLARED_CRS_URN = 'urn:ogc:def:crs:EPSG::104905';

export const MARS_2000_SPHERE_RADIUS_M = 3_396_190;

/** Metres along the equator per degree of longitude on the Mars 2000 sphere:
 *  2πR / 360. */
export const MARS_METRES_PER_DEGREE = (2 * Math.PI * MARS_2000_SPHERE_RADIUS_M) / 360;

/** Verified PROJ export of the served projection (IAU:2015:49910). */
export const MARS_EQC_PROJ4 =
  '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';

export const MARS_GEOGRAPHIC_PROJ4 = '+proj=longlat +R=3396190 +no_defs';

/**
 * Analytic lon/lat to SOLARA's Mars-sphere equirectangular coordinates.
 * Longitude is east-positive and latitude is planetocentric. This stays
 * ol/proj4-free so a shell feature can pass coordinates into MarsMap without
 * pulling OpenLayers into the app shell. The analytic formula also avoids
 * proj4's pole-sign quirk documented in Architecture.md §6.1.
 */
export function marsPlanetocentricToEqc(
  longitudeEastDeg: number,
  latitudeNorthDeg: number,
): [number, number] {
  const radiansPerDegree = Math.PI / 180;
  return [
    longitudeEastDeg * radiansPerDegree * MARS_2000_SPHERE_RADIUS_M,
    latitudeNorthDeg * radiansPerDegree * MARS_2000_SPHERE_RADIUS_M,
  ];
}

/**
 * Esri MapServer's published MarsEC0 equirectangular CRS. Its Mars 2000
 * ellipsoid is retained as source metadata; OpenLayers reprojects these
 * cached image tiles into SOLARA's Mars-sphere working projection.
 */
export const MARS_VIKING_MARSECO0_PROJ4 =
  '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +a=3396190 +b=3376200 +units=m +no_defs';

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
