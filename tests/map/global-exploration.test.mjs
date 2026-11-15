import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eqcToMarsLonLat,
  marsLonLatToEqc,
  marsLonLatToPolar,
  normalizeMarsLongitudeEast,
  parseMarsCoordinateQuery,
  polarToMarsLonLat,
} from '../../src/lib/marsLocation.ts';
import { searchIauFeatures } from '../../src/data/adapters/iauFeatureService.ts';
import { MARS_MISSION_SITES } from '../../src/features/global-exploration/missionSites.ts';
import { marsSphereCartesianToMapLocation } from '../../src/features/mars-globe/coordinates.ts';

test('Mars east longitude wraps while preserving the signed dateline edge', () => {
  assert.equal(normalizeMarsLongitudeEast(181), -179);
  assert.equal(normalizeMarsLongitudeEast(-181), 179);
  assert.equal(normalizeMarsLongitudeEast(180), 180);
  assert.equal(normalizeMarsLongitudeEast(-180), -180);
  assert.equal(normalizeMarsLongitudeEast(540), 180);
});

test('analytic EQC transform handles exact poles and wraps the dateline', () => {
  const [x, y] = marsLonLatToEqc(180, 90);
  const result = eqcToMarsLonLat(x, y);
  assert.equal(result.lon, 180);
  assert.equal(result.lat, 90);
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test('polar transforms round-trip named global Mars regions in both hemispheres', () => {
  const points = [
    { lon: 77.42982, lat: 18.46611, hemisphere: 'north' }, // Jezero
    { lon: 137.4, lat: -4.6, hemisphere: 'south' }, // Gale
    { lon: -133.8, lat: 18.65, hemisphere: 'north' }, // Olympus Mons
    { lon: -45, lat: -42, hemisphere: 'south' }, // Valles Marineris region
    { lon: 65, lat: -42, hemisphere: 'south' }, // Hellas Planitia region
    { lon: 179.999, lat: 75, hemisphere: 'north' },
    { lon: -179.999, lat: -75, hemisphere: 'south' },
  ];
  for (const point of points) {
    const xy = marsLonLatToPolar(point.lon, point.lat, point.hemisphere);
    const restored = polarToMarsLonLat(xy[0], xy[1], point.hemisphere);
    const dlon = Math.abs(((restored.lon - point.lon + 540) % 360) - 180);
    assert.ok(dlon < 1e-8, `${point.hemisphere} longitude round trip for ${point.lon}`);
    assert.ok(Math.abs(restored.lat - point.lat) < 1e-8);
  }
});

test('coordinate parser accepts signed lat-lon and explicit hemispheres', () => {
  assert.deepEqual(parseMarsCoordinateQuery('18.46611, 77.42982'), {
    lon: 77.42982,
    lat: 18.46611,
    sourceText: '18.46611, 77.42982',
  });
  assert.equal(parseMarsCoordinateQuery('4.6S 137.4E')?.lat, -4.6);
  assert.equal(parseMarsCoordinateQuery('179.9W, 75N')?.lon, -179.9);
  assert.equal(parseMarsCoordinateQuery('91, 0'), null);
  assert.equal(parseMarsCoordinateQuery('Mars'), null);
});

test('IAU search validates returned geometry and normalizes longitude east-positive', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.match(url.searchParams.get('where'), /Olympus/);
    return Response.json({
      features: [{
        attributes: { FID: 10, clean_name: 'Olympus Mons', type: 'mons', diameter: 600, link: 'https://planetarynames.wr.usgs.gov/Feature/123' },
        geometry: { x: -133.802, y: 18.65 },
      }],
    });
  };
  try {
    const results = await searchIauFeatures('Olympus', new AbortController().signal);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Olympus Mons');
    assert.equal(results[0].lon, -133.802);
    assert.equal(results[0].lat, 18.65);
    assert.equal(results[0].detailUrl, 'https://planetarynames.wr.usgs.gov/Feature/123');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('mission site markers use finite, verified global coordinates', () => {
  assert.ok(MARS_MISSION_SITES.length >= 7);
  for (const site of MARS_MISSION_SITES) {
    assert.ok(site.lon >= -180 && site.lon <= 180, `${site.id} longitude`);
    assert.ok(site.lat >= -90 && site.lat <= 90, `${site.id} latitude`);
    assert.match(site.sourceUrl, /^https:\/\//);
    assert.ok(site.coordinateNote.length > 10);
  }
  assert.equal(MARS_MISSION_SITES.find((site) => site.id === 'opportunity-meridiani').lon, -5.52583);
});

test('Mars globe sphere pick returns planetocentric coordinates in the shared EQC contract', () => {
  const radius = 3_396_190;
  const lon = -179.9 * Math.PI / 180;
  const lat = 89.5 * Math.PI / 180;
  const point = marsSphereCartesianToMapLocation(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
  );
  assert.ok(point);
  assert.ok(Math.abs(point.lon - (-179.9)) < 1e-8);
  assert.ok(Math.abs(point.lat - 89.5) < 1e-8);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});
