import test from 'node:test';
import assert from 'node:assert/strict';
import { planRouteOnGrid } from '../../src/science/terrain/routePlanner.ts';
import { DEFAULT_ROUTE_COST_PARAMS } from '../../src/science/terrain/cost.ts';

const ACQUIRED_AT = '2026-11-15T00:00:00.000Z';

function makeGrid({ westLon = 77.4, eastLon = 77.6, southLat = 18.4, northLat = 18.6, cols = 21, rows = 21 } = {}) {
  const cellSizeDegX = (eastLon - westLon) / cols;
  const cellSizeDegY = (northLat - southLat) / rows;
  const values = new Int16Array(cols * rows);
  const valid = new Uint8Array(cols * rows).fill(1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      values[row * cols + col] = -2000 - row * 10 - col;
    }
  }
  return {
    meta: {
      format: 'solara-elevation-grid/1',
      datasetId: 'mola-hrsc-blend-200m-colorshade',
      crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT',
      elevationUnit: 'metre',
      verticalReference: 'Mars areoid (test fixture)',
      note: 'Synthetic test grid — not a scientific observation.',
      extent: { westLon, eastLon, southLat, northLat },
      cols,
      rows,
      cellSizeDegX,
      cellSizeDegY,
      noDataValue: null,
      preparedAt: ACQUIRED_AT,
      sourceService: 'synthetic-test',
      sourceMethod: 'deterministic fixture',
      centreValidation: null,
    },
    cols,
    rows,
    values,
    valid,
  };
}

function source(mode = 'prepared-local', datelineSegments = 1) {
  return { mode, datelineSegments, acquiredAt: ACQUIRED_AT };
}

test('plans a route on a valid synthetic grid and reports coverage honestly', () => {
  const grid = makeGrid();
  const outcome = planRouteOnGrid(
    grid,
    { lon: 77.45, lat: 18.45 },
    { lon: 77.55, lat: 18.55 },
    DEFAULT_ROUTE_COST_PARAMS,
    source(),
  );
  assert.equal(outcome.ok, true);
  assert.ok(outcome.result.points.length >= 2);
  assert.ok(outcome.result.totalGroundDistanceM > 0);
  assert.ok(outcome.result.totalCostM > 0);
  assert.equal(outcome.result.coverage.mode, 'prepared-local');
  assert.equal(outcome.result.coverage.quality, 'local-prepared');
  assert.equal(outcome.result.coverage.validFraction, 1);
  assert.equal(outcome.result.coverage.missingFraction, 0);
  assert.ok(outcome.result.coverage.nominalResolutionMPerPixel > 0);
  assert.ok(outcome.result.warnings.some((warning) => warning.includes('not a validated or safe route')));
});

test('refuses identical start and target', () => {
  const outcome = planRouteOnGrid(
    makeGrid(),
    { lon: 77.5, lat: 18.5 },
    { lon: 77.5, lat: 18.5 },
    DEFAULT_ROUTE_COST_PARAMS,
    source(),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'identical-points');
});

test('reports insufficient coverage when the DEM window has no valid cells', () => {
  const grid = makeGrid();
  grid.valid.fill(0);
  const outcome = planRouteOnGrid(
    grid,
    { lon: 77.45, lat: 18.45 },
    { lon: 77.55, lat: 18.55 },
    DEFAULT_ROUTE_COST_PARAMS,
    source(),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'insufficient-coverage');
});

test('reports no-path across a continuous NoData barrier', () => {
  const grid = makeGrid();
  const wallCol = 10;
  for (let row = 0; row < grid.rows; row++) {
    grid.valid[row * grid.cols + wallCol] = 0;
  }
  const outcome = planRouteOnGrid(
    grid,
    { lon: 77.45, lat: 18.5 },
    { lon: 77.55, lat: 18.5 },
    DEFAULT_ROUTE_COST_PARAMS,
    source(),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'no-path');
});

test('snaps a start point off a tiny NoData hole and warns about it', () => {
  const grid = makeGrid();
  grid.valid[10 * grid.cols + 5] = 0;
  const outcome = planRouteOnGrid(
    grid,
    { lon: 77.451, lat: 18.501 },
    { lon: 77.55, lat: 18.55 },
    DEFAULT_ROUTE_COST_PARAMS,
    source(),
  );
  assert.equal(outcome.ok, true);
  assert.ok(outcome.result.warnings.some((warning) => warning.startsWith('Start snapped')));
  assert.ok(outcome.result.coverage.pathUnknownNeighbourCells > 0);
  assert.ok(outcome.result.warnings.some((warning) => warning.includes('within one grid cell of terrain with unknown elevation')));
});

test('routes across a dateline-wrapped logical window', () => {
  const grid = makeGrid({
    westLon: 179,
    eastLon: 181,
    southLat: -1,
    northLat: 1,
    cols: 41,
    rows: 41,
  });
  const outcome = planRouteOnGrid(
    grid,
    { lon: 179.2, lat: -0.2 },
    { lon: -179.8, lat: 0.2 },
    DEFAULT_ROUTE_COST_PARAMS,
    source('regional-live', 2),
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.coverage.datelineSegments, 2);
  assert.ok(outcome.result.points.every((point) => point.lon >= -180 && point.lon <= 180));
  assert.ok(outcome.result.warnings.some((warning) => warning.includes('±180°')));
});
