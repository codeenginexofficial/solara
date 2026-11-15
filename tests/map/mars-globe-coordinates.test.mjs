import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARS_MAP_SPHERE_RADIUS_M,
  marsCartesianToMapLocation,
  marsPlanetographicToPlanetocentric,
  marsPlanetocentricToPlanetographic,
  marsPlanetographicToCartesian,
} from '../../src/features/mars-globe/coordinates.ts';

test('Jezero globe coordinate round-trip preserves east-positive planetocentric lon/lat', () => {
  const longitudeEast = 77.42982;
  const latitudePlanetocentric = 18.46611;
  const latitudePlanetographic = marsPlanetocentricToPlanetographic(latitudePlanetocentric);
  const [x, y, z] = marsPlanetographicToCartesian(longitudeEast, latitudePlanetographic);
  const location = marsCartesianToMapLocation(x, y, z);

  assert.ok(location);
  assert.ok(Math.abs(location.lon - longitudeEast) < 1e-10);
  assert.ok(Math.abs(location.lat - latitudePlanetocentric) < 1e-10);
  assert.ok(Math.abs(location.x - 4_589_629) < 1);
  assert.ok(Math.abs(location.y - 1_094_573) < 1);
});

test('planetographic conversion uses Mars ellipsoid radii and keeps poles stable', () => {
  assert.ok(marsPlanetocentricToPlanetographic(45) > 45);
  assert.ok(Math.abs(marsPlanetographicToPlanetocentric(marsPlanetocentricToPlanetographic(45)) - 45) < 1e-12);
  assert.equal(marsPlanetocentricToPlanetographic(0), 0);
  assert.equal(marsPlanetocentricToPlanetographic(-90), -90);
  assert.equal(marsPlanetocentricToPlanetographic(90), 90);
  assert.equal(MARS_MAP_SPHERE_RADIUS_M, 3_396_190);
});

test('surface coordinate conversion is stable at nonzero terrain height', () => {
  const longitudeEast = -123.456;
  const latitudePlanetocentric = -52.25;
  const latitudePlanetographic = marsPlanetocentricToPlanetographic(latitudePlanetocentric);
  const [x, y, z] = marsPlanetographicToCartesian(longitudeEast, latitudePlanetographic, 18_000);
  const location = marsCartesianToMapLocation(x, y, z);

  assert.ok(location);
  assert.ok(Math.abs(location.lon - longitudeEast) < 1e-10);
  assert.ok(Math.abs(location.lat - latitudePlanetocentric) < 1e-8);
});

test('Cartesian conversion rejects invalid inputs and returns a finite polar location', () => {
  assert.equal(marsCartesianToMapLocation(0, 0, 0), null);
  assert.equal(marsCartesianToMapLocation(Number.NaN, 0, 1), null);
  const pole = marsCartesianToMapLocation(0, 0, 3_376_200);
  assert.ok(pole);
  assert.equal(pole.lon, 0);
  assert.equal(pole.lat, 90);
  assert.ok(Number.isFinite(pole.x) && Number.isFinite(pole.y));
});

test('Mars latitude validation rejects out-of-range values', () => {
  assert.throws(() => marsPlanetocentricToPlanetographic(90.1), RangeError);
  assert.throws(() => marsPlanetographicToCartesian(20, -90.1), RangeError);
});
