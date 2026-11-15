import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNearbyHistoricalRoverTrack,
  listPerseveranceRoverImages,
} from '../../worker/src/science/rover.ts';

const POINT = { lon: 77.42982, lat: 18.46611 };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(String(input), init);
  return () => {
    globalThis.fetch = previous;
  };
}

test('get_nearby_historical_rover_track finds the nearest sol-tagged segment via Esri JSON', async () => {
  let seenUrl = null;
  const restore = stubFetch((input) => {
    seenUrl = new URL(input);
    return jsonResponse({
      features: [
        {
          attributes: { sol: 100 },
          geometry: { paths: [[[77.42882, 18.46611], [77.43082, 18.46611]]] },
        },
        {
          attributes: { sol: 200 },
          geometry: { paths: [[[77.45, 18.48], [77.451, 18.4801]]] },
        },
      ],
    });
  });

  try {
    const result = await getNearbyHistoricalRoverTrack(POINT.lon, POINT.lat, { radiusM: 2000 });
    assert.equal(result.status, 'available');
    assert.equal(result.rover, 'Perseverance');
    assert.equal(result.positionType, 'historical-traverse');
    assert.ok(result.nearestTrackPoint);
    assert.equal(result.nearestTrackPoint.sol, 100);
    assert.ok(result.nearestTrackPoint.distanceM < 100);
    assert.ok(result.warnings.some((warning) => warning.includes('not a live rover position')));
    assert.equal(seenUrl.searchParams.get('f'), 'json');
    assert.equal(seenUrl.searchParams.get('outSR'), '104905');
    assert.equal(seenUrl.searchParams.get('geometryType'), 'esriGeometryEnvelope');
    const envelope = JSON.parse(seenUrl.searchParams.get('geometry'));
    assert.ok(envelope.xmin < POINT.lon && envelope.xmax > POINT.lon);
  } finally {
    restore();
  }
});

test('get_nearby_historical_rover_track reports outside_coverage beyond the radius', async () => {
  const restore = stubFetch(() =>
    jsonResponse({
      features: [
        {
          attributes: { sol: 500 },
          geometry: { paths: [[[77.5, 18.5], [77.501, 18.501]]] },
        },
      ],
    }),
  );

  try {
    const result = await getNearbyHistoricalRoverTrack(POINT.lon, POINT.lat, { radiusM: 500 });
    assert.equal(result.status, 'outside_coverage');
    assert.equal(result.nearestTrackPoint, null);
    assert.ok(result.warnings.some((warning) => warning.includes('No historical traverse segment')));
  } finally {
    restore();
  }
});

test('get_nearby_historical_rover_track surfaces ArcGIS errors honestly', async () => {
  const restore = stubFetch(() =>
    jsonResponse({ error: { message: 'Invalid geometry' } }),
  );
  try {
    const result = await getNearbyHistoricalRoverTrack(POINT.lon, POINT.lat);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.nearestTrackPoint, null);
    assert.ok(result.warnings.some((warning) => warning.includes('Invalid geometry')));
  } finally {
    restore();
  }
});

test('list_perseverance_rover_images returns metadata without assigning capture coordinates', async () => {
  const restore = stubFetch(() =>
    jsonResponse({
      total_results: 1,
      total_images: 1,
      images: [
        {
          imageid: 'J0001',
          sol: 313,
          camera: { instrument: 'NAVCAM_LEFT', filter_name: 'L' },
          title: 'Test frame',
          date_taken_utc: '2022-01-06T08:25:06Z',
          date_taken_mars: '00313M13:08:19.717',
          credit: 'NASA/JPL-Caltech',
          link: 'https://mars.nasa.gov/resources/1/',
          image_files: {
            small: 'https://mars.nasa.gov/files/1_small.jpg',
            full_res: 'https://mars.nasa.gov/files/1_full.jpg',
          },
        },
      ],
    }),
  );

  try {
    const result = await listPerseveranceRoverImages({ sol: 313, refresh: true });
    assert.equal(result.status, 'available');
    assert.equal(result.count, 1);
    assert.equal(result.coverage.observationLocation, null);
    assert.ok(result.coverage.observationLocationNote.includes('not a map coordinate'));
    assert.equal(result.images[0].imageId, 'J0001');
    assert.equal(result.images[0].instrument, 'NAVCAM_LEFT');
    assert.equal(result.images[0].imageFiles.small, 'https://mars.nasa.gov/files/1_small.jpg');
    assert.ok(result.warnings.some((warning) => warning.includes('no capture location is assigned')));
  } finally {
    restore();
  }
});

test('list_perseverance_rover_images rejects an invalid sol without a request', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls += 1;
    return jsonResponse({ images: [] });
  });
  try {
    const result = await listPerseveranceRoverImages({ sol: -1 });
    assert.equal(calls, 0);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.count, 0);
  } finally {
    restore();
  }
});
