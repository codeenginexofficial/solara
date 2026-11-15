import assert from 'node:assert/strict';
import test from 'node:test';

import { getMedaObservations } from '../../worker/src/science/meda.ts';

const PDS_TAILS = {
  ats: '1,01859M23:59:59.797,1859 23:34:29,198.54,0,0,0,0\n',
  ps: '1,01859M23:59:59.797,1859 23:34:29,741.58,0,1,0\n',
  rhs: '1,01859M23:59:59.797,1859 23:34:29,13.55,0\n',
  wind: '1,00313M13:08:19.717,2022-01-06T08:25:06Z,16.53,0,0,0,102.20\n',
};

function stubPdsFetch({ failAts = false } = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('CAL_ATS')) {
      if (failAts) throw new Error('simulated ATS upstream failure');
      return new Response(PDS_TAILS.ats, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    if (url.includes('DER_PS')) {
      return new Response(PDS_TAILS.ps, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    if (url.includes('DER_RHS')) {
      return new Response(PDS_TAILS.rhs, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    if (url.includes('DER_WS')) {
      return new Response(PDS_TAILS.wind, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    throw new Error(`unexpected MEDA fetch ${url}`);
  };
  return () => {
    globalThis.fetch = previous;
  };
}

test('get_meda_observations preserves per-sensor sol/time and reports the wind-sensor gap', async () => {
  const restore = stubPdsFetch();
  try {
    const result = await getMedaObservations({ refresh: true });

    assert.equal(result.tool, 'get_meda_observations');
    assert.equal(result.status, 'available');
    assert.equal(result.source.isLastKnownGood, false);
    assert.equal(result.coverage.observationLocation, null);
    assert.ok(result.coverage.observationLocationNote.includes('no rover coordinates'));

    const bySensor = new Map(result.observations.map((entry) => [entry.sensor, entry]));
    const temperature = bySensor.get('airTemperature');
    assert.equal(temperature.value, -74.6);
    assert.equal(temperature.rawValue, 198.54);
    assert.equal(temperature.rawUnit, 'K');
    assert.equal(temperature.sol, 1859);
    assert.equal(temperature.lmst, '01859M23:59:59.797');
    assert.equal(temperature.dataClass, 'measured');
    assert.equal(temperature.solsOlderThanLatest, 0);

    const pressure = bySensor.get('pressure');
    assert.equal(pressure.value, 741.58);
    assert.equal(pressure.unit, 'Pa');
    assert.equal(pressure.dataClass, 'derived');

    const humidity = bySensor.get('relativeHumidity');
    assert.equal(humidity.value, 13.55);

    const windSpeed = bySensor.get('windSpeed');
    assert.equal(windSpeed.value, 16.53);
    assert.equal(windSpeed.sol, 313);
    assert.equal(windSpeed.solsOlderThanLatest, 1546);

    const windDirection = bySensor.get('windDirection');
    assert.equal(windDirection.value, 102.2);

    assert.ok(
      result.warnings.some(
        (warning) => warning.includes('Sol 313') && warning.includes('Sol 1859'),
      ),
    );
    assert.ok(result.warnings.some((warning) => warning.includes('in-situ')));
  } finally {
    restore();
  }
});

test('get_meda_observations flags last-known-good fallback instead of hiding a failed read', async () => {
  const restore = stubPdsFetch({ failAts: true });
  try {
    const result = await getMedaObservations({ refresh: true });
    assert.equal(result.status, 'available');
    assert.equal(result.source.isLastKnownGood, true);
    assert.ok(result.errors && result.errors.some((entry) => entry.startsWith('ATS:')));
    assert.ok(
      result.warnings.some((warning) => warning.includes('last-known-good')),
    );
    const temperature = result.observations.find((entry) => entry.sensor === 'airTemperature');
    assert.equal(temperature.value, -74.6);
    assert.equal(temperature.rawValue, 198.54);
  } finally {
    restore();
  }
});
