import assert from 'node:assert/strict';
import test from 'node:test';

import { getDatasetCoverage } from '../../worker/src/science/coverage.ts';

const JEZERO_POINT = { lon: 77.42982, lat: 18.46611 };

test('get_dataset_coverage: inside Jezero reports membership with honest caveats', () => {
  const result = getDatasetCoverage(JEZERO_POINT.lon, JEZERO_POINT.lat);

  assert.equal(result.tool, 'get_dataset_coverage');
  assert.equal(result.location.latitudeType, 'planetocentric');
  assert.equal(result.location.longitudeDirection, 'east');
  assert.ok(result.region);
  assert.equal(result.region.id, 'jezero-crater-west');
  assert.ok(result.datasets.length >= 10);

  const byId = new Map(result.datasets.map((entry) => [entry.datasetId, entry]));
  const ctx = byId.get('jezero-ctx-mosaic-soc-008');
  assert.equal(ctx.extentStatus, 'within_declared_extent');
  assert.ok(ctx.extentNote.includes('does not prove'));

  const dem = byId.get('mola-hrsc-blend-200m-dem');
  assert.equal(dem.extentStatus, 'within_declared_extent');
  assert.equal(dem.availability, 'live_query_service');

  const traverse = byId.get('mars2020-perseverance-traverse');
  assert.equal(traverse.extentStatus, 'within_declared_extent');
  assert.ok(traverse.extentNote.includes('path'));

  const ellipse = byId.get('mars2020-landing-ellipse');
  assert.equal(ellipse.extentStatus, 'extent_unknown');
  assert.equal(ellipse.boundingBox, null);
  assert.ok(ellipse.extentNote.includes('no bounding box'));

  const meda = byId.get('mars2020-meda-environmental');
  assert.equal(meda.extentStatus, 'within_declared_extent');
  assert.ok(meda.extentNote.includes('In-situ'));

  const globalMosaic = byId.get('mars-viking-mdim21-colorized-global');
  assert.equal(globalMosaic.extentStatus, 'within_declared_extent');
  assert.ok(globalMosaic.extentNote.includes('global extent'));
});

test('get_dataset_coverage: a point outside Jezero is outside regional extents but inside global ones', () => {
  const result = getDatasetCoverage(0, 0);
  assert.equal(result.region, null);

  const byId = new Map(result.datasets.map((entry) => [entry.datasetId, entry]));
  assert.equal(byId.get('jezero-ctx-mosaic-soc-008').extentStatus, 'outside_declared_extent');
  assert.equal(byId.get('mars2020-perseverance-traverse').extentStatus, 'outside_declared_extent');
  assert.equal(byId.get('mars-viking-mdim21-colorized-global').extentStatus, 'within_declared_extent');
  assert.equal(byId.get('mola-hrsc-blend-200m-dem').extentStatus, 'within_declared_extent');
  assert.equal(byId.get('mars2020-landing-ellipse').extentStatus, 'extent_unknown');
});

test('get_dataset_coverage: output is deterministic and never promises data availability', () => {
  const first = getDatasetCoverage(JEZERO_POINT.lon, JEZERO_POINT.lat);
  const second = getDatasetCoverage(JEZERO_POINT.lon, JEZERO_POINT.lat);
  assert.deepEqual(second, first);
  assert.ok(resultHasCaveat(first));
});

function resultHasCaveat(result) {
  return result.datasets.every((entry) => typeof entry.extentNote === 'string' && entry.extentNote.length > 0)
    && result.notes.some((note) => note.includes('not a promise of valid data'));
}
