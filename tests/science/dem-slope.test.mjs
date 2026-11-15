import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEM_PIXEL_SIZE_DEG,
  demGroundSpacingMeters,
  getTerrainElevation,
} from '../../worker/src/science/dem.ts';
import { calculateSlope, computeCentralDifferenceSlope } from '../../worker/src/science/slope.ts';

const REAL_POINT = { lon: 77.42982, lat: 18.46611 };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseGeometry(input) {
  const url = new URL(String(input));
  const geometry = JSON.parse(url.searchParams.get('geometry'));
  return { url, x: geometry.x, y: geometry.y };
}

function stubFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(input, init);
  return () => {
    globalThis.fetch = previous;
  };
}

test('get_terrain_elevation sends a verified identify query and returns metres', async () => {
  let calls = 0;
  let seenUrl = null;
  const restore = stubFetch((input) => {
    calls += 1;
    const { url, x, y } = parseGeometry(input);
    seenUrl = url;
    assert.equal(x, REAL_POINT.lon);
    assert.equal(y, REAL_POINT.lat);
    return jsonResponse({ value: '-2520' });
  });

  try {
    const result = await getTerrainElevation(REAL_POINT.lon, REAL_POINT.lat, { bypassCache: true });
    assert.equal(calls, 1);
    assert.equal(result.status, 'available');
    assert.equal(result.elevationM, -2520);
    assert.equal(result.unit, 'm');
    assert.equal(result.noData, false);
    assert.equal(result.dataset.datasetId, 'mola-hrsc-blend-200m-dem');
    assert.equal(result.location.latitudeType, 'planetocentric');
    assert.equal(result.location.longitudeDirection, 'east');
    assert.equal(seenUrl.searchParams.get('sr'), '104905');
    assert.equal(seenUrl.searchParams.get('f'), 'json');
    assert.ok(seenUrl.pathname.endsWith('/ImageServer/identify'));
    assert.ok(result.warnings.some((warning) => warning.includes('not a site survey')));
  } finally {
    restore();
  }
});

test('get_terrain_elevation reports NoData as unknown, never zero', async () => {
  const restore = stubFetch(() => jsonResponse({ value: 'NoData' }));
  try {
    const result = await getTerrainElevation(REAL_POINT.lon, REAL_POINT.lat, { bypassCache: true });
    assert.equal(result.status, 'no_data');
    assert.equal(result.noData, true);
    assert.equal(result.elevationM, null);
    assert.ok(result.warnings.some((warning) => warning.includes('unknown, not zero')));
  } finally {
    restore();
  }
});

test('get_terrain_elevation does not query outside the declared service extent', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls += 1;
    return jsonResponse({ value: '-1000' });
  });
  try {
    const result = await getTerrainElevation(0, -90, { bypassCache: true });
    assert.equal(calls, 0);
    assert.equal(result.status, 'outside_coverage');
    assert.equal(result.elevationM, null);
  } finally {
    restore();
  }
});

test('get_terrain_elevation rejects non-finite coordinates without a request', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls += 1;
    return jsonResponse({ value: '0' });
  });
  try {
    const result = await getTerrainElevation(Number.NaN, 18, { bypassCache: true });
    assert.equal(calls, 0);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.elevationM, null);
  } finally {
    restore();
  }
});

test('calculate_slope derives a deterministic central-difference slope from live-verified neighbours', async () => {
  let calls = 0;
  const restore = stubFetch((input) => {
    calls += 1;
    const { x, y } = parseGeometry(input);
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    if (near(y, REAL_POINT.lat) && near(x, REAL_POINT.lon)) return jsonResponse({ value: '-2520' });
    if (near(y, REAL_POINT.lat + DEM_PIXEL_SIZE_DEG) && near(x, REAL_POINT.lon)) {
      return jsonResponse({ value: '-2508' });
    }
    if (near(y, REAL_POINT.lat - DEM_PIXEL_SIZE_DEG) && near(x, REAL_POINT.lon)) {
      return jsonResponse({ value: '-2534' });
    }
    if (near(x, REAL_POINT.lon + DEM_PIXEL_SIZE_DEG) && near(y, REAL_POINT.lat)) {
      return jsonResponse({ value: '-2536' });
    }
    if (near(x, REAL_POINT.lon - DEM_PIXEL_SIZE_DEG) && near(y, REAL_POINT.lat)) {
      return jsonResponse({ value: '-2499' });
    }
    throw new Error(`unexpected identify geometry ${x},${y}`);
  });

  try {
    const result = await calculateSlope(REAL_POINT.lon, REAL_POINT.lat, { bypassCache: true });
    assert.equal(calls, 5);
    assert.equal(result.status, 'available');
    assert.ok(result.slopeDeg !== null);
    assert.ok(Math.abs(result.slopeDeg - 6.68) < 0.02, `slope ${result.slopeDeg}`);
    assert.ok(result.aspectDeg !== null);
    assert.ok(Math.abs(result.aspectDeg - 123.7) < 0.5, `aspect ${result.aspectDeg}`);
    assert.equal(result.samples.center.elevationM, -2520);
    assert.equal(result.samples.north.elevationM, -2508);
    assert.equal(result.samples.south.elevationM, -2534);
    assert.equal(result.samples.east.elevationM, -2536);
    assert.equal(result.samples.west.elevationM, -2499);
    assert.ok(Math.abs(result.spacing.northSouthM - 200.0) < 0.5);
    assert.ok(Math.abs(result.spacing.eastWestM - 189.7) < 0.5);
    assert.equal(result.method, 'central-difference-4-neighbour');
  } finally {
    restore();
  }
});

test('calculate_slope refuses a partial stencil (no guessing)', async () => {
  const restore = stubFetch((input) => {
    const { x, y } = parseGeometry(input);
    if (Math.abs(x - (REAL_POINT.lon + DEM_PIXEL_SIZE_DEG)) < 1e-9 && Math.abs(y - REAL_POINT.lat) < 1e-9) {
      return jsonResponse({ value: 'NoData' });
    }
    return jsonResponse({ value: '-2520' });
  });

  try {
    const result = await calculateSlope(REAL_POINT.lon, REAL_POINT.lat, { bypassCache: true });
    assert.equal(result.status, 'insufficient_neighbours');
    assert.equal(result.slopeDeg, null);
    assert.equal(result.aspectDeg, null);
    assert.equal(result.samples.east.status, 'no_data');
    assert.ok(result.warnings.some((warning) => warning.includes('east (no_data)')));
  } finally {
    restore();
  }
});

test('calculate_slope does not query neighbours when the centre is NoData', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls += 1;
    return jsonResponse({ value: 'NoData' });
  });

  try {
    const result = await calculateSlope(REAL_POINT.lon, REAL_POINT.lat, { bypassCache: true });
    assert.equal(calls, 1);
    assert.equal(result.status, 'no_data');
    assert.equal(result.slopeDeg, null);
    assert.ok(result.warnings.some((warning) => warning.includes('Neighbours were not queried')));
  } finally {
    restore();
  }
});

test('calculate_slope refuses the degenerate east–west stencil near a pole', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls += 1;
    return jsonResponse({ value: '-1000' });
  });

  try {
    const result = await calculateSlope(0, 89.999, { bypassCache: true });
    assert.equal(calls, 1);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.slopeDeg, null);
    assert.ok(result.warnings.some((warning) => warning.includes('degenerate')));
  } finally {
    restore();
  }
});

test('computeCentralDifferenceSlope: flat terrain has zero slope; downhill aspect points south', () => {
  const flat = computeCentralDifferenceSlope({
    northM: 0,
    southM: 0,
    eastM: 0,
    westM: 0,
    northSouthSpacingM: 1,
    eastWestSpacingM: 1,
  });
  assert.ok(flat !== null);
  assert.ok(Math.abs(flat.slopeDeg) < 1e-12);

  const southDown = computeCentralDifferenceSlope({
    northM: 10,
    southM: 0,
    eastM: 5,
    westM: 5,
    northSouthSpacingM: 1,
    eastWestSpacingM: 1,
  });
  assert.ok(southDown !== null);
  assert.ok(Math.abs(southDown.slopeDeg - (Math.atan(5) * 180) / Math.PI) < 1e-9);
  assert.ok(Math.abs(southDown.aspectDeg - 180) < 1e-9);
});

test('demGroundSpacingMeters matches the verified ~200 m / ~189.7 m pixel spacing', () => {
  const spacing = demGroundSpacingMeters(REAL_POINT.lat);
  assert.ok(Math.abs(spacing.northSouthM - 200.0) < 0.5);
  assert.ok(Math.abs(spacing.eastWestM - 189.7) < 0.5);
});
