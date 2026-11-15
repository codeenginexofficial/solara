import { MARS_2000_SPHERE_RADIUS_M, marsPlanetocentricToEqc } from '../../lib/marsCrs';
import type { MapLocation } from '../../map/mapTypes';

export const MARS_EQUATORIAL_RADIUS_M = 3_396_190;
export const MARS_POLAR_RADIUS_M = 3_376_200;

const radiansPerDegree = Math.PI / 180;
const degreesPerRadian = 180 / Math.PI;

/** Convert SOLARA's planetocentric latitude to the Mars ellipsoid latitude Cesium expects. */
export function marsPlanetocentricToPlanetographic(latitudeDeg: number): number {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError('Mars latitude must be finite and between -90 and 90 degrees.');
  }
  if (Math.abs(latitudeDeg) === 90 || latitudeDeg === 0) return latitudeDeg;

  const eccentricitySquared =
    1 - (MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M) /
      (MARS_EQUATORIAL_RADIUS_M * MARS_EQUATORIAL_RADIUS_M);
  const latitudeRad = latitudeDeg * radiansPerDegree;
  return Math.atan(Math.tan(latitudeRad) / (1 - eccentricitySquared)) * degreesPerRadian;
}

/** Convert Mars ellipsoid (planetographic) latitude back to planetocentric latitude. */
export function marsPlanetographicToPlanetocentric(latitudeDeg: number): number {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError('Mars latitude must be finite and between -90 and 90 degrees.');
  }
  if (Math.abs(latitudeDeg) === 90 || latitudeDeg === 0) return latitudeDeg;

  const eccentricitySquared =
    1 - (MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M) /
      (MARS_EQUATORIAL_RADIUS_M * MARS_EQUATORIAL_RADIUS_M);
  const latitudeRad = latitudeDeg * radiansPerDegree;
  return Math.atan((1 - eccentricitySquared) * Math.tan(latitudeRad)) * degreesPerRadian;
}

/** Convert a Mars Cartesian point to east-positive, planetocentric Mars lon/lat and map metres. */
export function marsCartesianToMapLocation(
  x: number,
  y: number,
  z: number,
): MapLocation | null {
  if (![x, y, z].every(Number.isFinite)) return null;

  const horizontal = Math.hypot(x, y);
  const magnitude = Math.hypot(horizontal, z);
  if (magnitude === 0) return null;

  const longitudeEastDeg = horizontal <= Number.EPSILON * magnitude
    ? 0
    : Math.atan2(y, x) * degreesPerRadian;
  const eccentricitySquared =
    1 - (MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M) /
      (MARS_EQUATORIAL_RADIUS_M * MARS_EQUATORIAL_RADIUS_M);
  const secondEccentricitySquared =
    (MARS_EQUATORIAL_RADIUS_M * MARS_EQUATORIAL_RADIUS_M -
      MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M) /
    (MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M);
  const theta = Math.atan2(
    z * MARS_EQUATORIAL_RADIUS_M,
    horizontal * MARS_POLAR_RADIUS_M,
  );
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const latitudePlanetographicRad = Math.atan2(
    z + secondEccentricitySquared * MARS_POLAR_RADIUS_M * sinTheta ** 3,
    horizontal - eccentricitySquared * MARS_EQUATORIAL_RADIUS_M * cosTheta ** 3,
  );
  const latitudePlanetocentricDeg = marsPlanetographicToPlanetocentric(
    latitudePlanetographicRad * degreesPerRadian,
  );
  const [mapX, mapY] = marsPlanetocentricToEqc(longitudeEastDeg, latitudePlanetocentricDeg);

  return {
    lon: longitudeEastDeg,
    lat: latitudePlanetocentricDeg,
    x: mapX,
    y: mapY,
  };
}

/** Convert a Cartesian point on SOLARA's 3,396,190 m Mars sphere to the shared
 * east-positive planetocentric MapLocation contract. */
export function marsSphereCartesianToMapLocation(
  x: number,
  y: number,
  z: number,
): MapLocation | null {
  if (![x, y, z].every(Number.isFinite)) return null;
  const horizontal = Math.hypot(x, y);
  if (horizontal === 0 && z === 0) return null;
  const longitudeEastDeg = horizontal === 0 ? 0 : Math.atan2(y, x) * degreesPerRadian;
  const latitudePlanetocentricDeg = Math.atan2(z, horizontal) * degreesPerRadian;
  const [mapX, mapY] = marsPlanetocentricToEqc(longitudeEastDeg, latitudePlanetocentricDeg);
  return { lon: longitudeEastDeg, lat: latitudePlanetocentricDeg, x: mapX, y: mapY };
}

/** Build an ellipsoid surface Cartesian for validating the coordinate conversion. */
export function marsPlanetographicToCartesian(
  longitudeEastDeg: number,
  latitudePlanetographicDeg: number,
  heightM = 0,
): [number, number, number] {
  if (
    !Number.isFinite(longitudeEastDeg) ||
    !Number.isFinite(latitudePlanetographicDeg) ||
    latitudePlanetographicDeg < -90 ||
    latitudePlanetographicDeg > 90 ||
    !Number.isFinite(heightM)
  ) {
    throw new RangeError('Mars longitude, latitude, and height must be finite and within valid latitude bounds.');
  }

  const longitudeRad = longitudeEastDeg * radiansPerDegree;
  const latitudeRad = latitudePlanetographicDeg * radiansPerDegree;
  const eccentricitySquared =
    1 - (MARS_POLAR_RADIUS_M * MARS_POLAR_RADIUS_M) /
      (MARS_EQUATORIAL_RADIUS_M * MARS_EQUATORIAL_RADIUS_M);
  const sinLatitude = Math.sin(latitudeRad);
  const cosLatitude = Math.cos(latitudeRad);
  const primeVerticalRadius =
    MARS_EQUATORIAL_RADIUS_M / Math.sqrt(1 - eccentricitySquared * sinLatitude * sinLatitude);

  return [
    (primeVerticalRadius + heightM) * cosLatitude * Math.cos(longitudeRad),
    (primeVerticalRadius + heightM) * cosLatitude * Math.sin(longitudeRad),
    (primeVerticalRadius * (1 - eccentricitySquared) + heightM) * sinLatitude,
  ];
}

/** Expose the sphere radius used by OpenLayers for tests and reference checks. */
export const MARS_MAP_SPHERE_RADIUS_M = MARS_2000_SPHERE_RADIUS_M;
