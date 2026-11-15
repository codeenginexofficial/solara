import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouteWindow,
  DEM_DECLARED_EXTENT,
  logicalLongitudeForExtent,
  shortestLongitudeDelta,
  splitRouteAtDateline,
  windowFitsExtent,
} from '../../src/science/terrain/routeGrid.ts';

test('Jezero route window fits the prepared local grid', () => {
  const window = buildRouteWindow(
    { lon: 77.42, lat: 18.46 },
    { lon: 77.5, lat: 18.47 },
  );
  assert.equal(window.segments.length, 1);
  assert.equal(
    windowFitsExtent(window.extent, {
      westLon: 77.1604655,
      eastLon: 77.6991776,
      southLat: 18.2110274,
      northLat: 18.7211945,
    }),
    true,
  );
  assert.ok(window.cols >= 2);
  assert.ok(window.rows >= 2);
});

test('dateline route window is split into two requestable segments', () => {
  const window = buildRouteWindow(
    { lon: 178.5, lat: -1 },
    { lon: -179.5, lat: 1 },
  );
  assert.equal(window.segments.length, 2);
  assert.equal(window.segments[0].eastLon, 180);
  assert.equal(window.segments[1].westLon, -180);
  assert.equal(window.segments[0].columnStart, 0);
  assert.equal(window.segments[1].columnStart, window.segments[0].cols);
  assert.equal(window.extent.westLon, 178.14);
  assert.equal(window.extent.eastLon, 180.86);
  assert.ok(window.segments[0].cols > 0);
  assert.ok(window.segments[1].cols > 0);
  assert.ok(window.cols <= 640);
  assert.ok(window.rows <= 640);
});

test('shortest longitude delta uses the seam-aware path', () => {
  assert.equal(shortestLongitudeDelta(179, -179), 2);
  assert.equal(shortestLongitudeDelta(-179, 179), -2);
  assert.equal(shortestLongitudeDelta(0, 180), 180);
  assert.equal(shortestLongitudeDelta(180, -180), 0);
});

test('logical longitude resolves -179 on the east side of a dateline window', () => {
  assert.equal(
    logicalLongitudeForExtent(-179, { westLon: 178.14, eastLon: 180.86, southLat: -1, northLat: 1 }),
    181,
  );
  assert.equal(
    logicalLongitudeForExtent(179, { westLon: -181, eastLon: -178, southLat: -1, northLat: 1 }),
    -181,
  );
});

test('route split at the dateline keeps each drawable line on one side', () => {
  const segments = splitRouteAtDateline([
    { lon: 179, lat: 0 },
    { lon: 180, lat: 0.1 },
    { lon: -179.9, lat: 0.2 },
    { lon: -179, lat: 0.3 },
  ]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].map((point) => point.lon), [179, 180]);
  assert.deepEqual(segments[1].map((point) => point.lon), [-179.9, -179]);
});

test('polar route windows clamp to the DEM latitude extent without collapsing', () => {
  for (const startLat of [86, -88]) {
    const targetLat = startLat > 0 ? 88 : -86;
    const window = buildRouteWindow(
      { lon: 0, lat: startLat },
      { lon: 2, lat: targetLat },
    );
    assert.ok(window.extent.southLat >= DEM_DECLARED_EXTENT.southLat);
    assert.ok(window.extent.northLat <= DEM_DECLARED_EXTENT.northLat);
    assert.ok(window.rows > 0);
    assert.ok(window.cols > 0);
  }
});

test('very long routes stay inside the bounded grid budget', () => {
  const window = buildRouteWindow(
    { lon: -120, lat: 10 },
    { lon: 80, lat: 20 },
  );
  assert.ok(window.cols <= 640);
  assert.ok(window.rows <= 640);
  assert.ok(window.segments.length >= 1);
});
