/**
 * MEDA observation service for the scientific assistant.
 *
 * Reuses the existing, verified PDS handler in `worker/src/meda.ts` rather
 * than duplicating its range-fetch/parse logic. That handler:
 *  - fetches the last few KB of the exact PDS CSV products (ATS/PS/RHS Sol
 *    1859; WIND Sol 313),
 *  - converts ATS Kelvin → Celsius while preserving `rawKelvin`,
 *  - falls back to directly verified baseline values and flags the response
 *    `isLastKnownGood` when a live read fails,
 *  - never interpolates or invents a missing value.
 *
 * This module reshapes that response into the D-006 tool contract and adds
 * per-observation provenance. It keeps each sensor's own sol/time and reports
 * the Sol 313 vs Sol 1859 mismatch explicitly: the rover's wind sensor was
 * damaged around Sol 315, so wind values are NOT simultaneous with the latest
 * temperature/pressure/humidity rows.
 *
 * There is no coordinate input: the PDS product rows do not publish the
 * rover's position, so no observation location is claimed.
 */

import {
  handleMedaEnvironmentLatest,
  type MedaEnvironmentResponse,
  type MedaSensorObservation,
} from '../meda';
import type {
  MedaObservationEntry,
  MedaObservationsInput,
  MedaObservationsResult,
  MedaSensorKey,
} from './contracts';

const SENSOR_META: ReadonlyArray<{
  key: MedaSensorKey;
  responseKey: keyof MedaEnvironmentResponse['sensors'];
  label: string;
  dataClass: 'measured' | 'derived';
}> = [
  {
    key: 'airTemperature',
    responseKey: 'airTemperature',
    label: 'Air temperature (ATS1, calibrated)',
    dataClass: 'measured',
  },
  {
    key: 'relativeHumidity',
    responseKey: 'relativeHumidity',
    label: 'Relative humidity (local)',
    dataClass: 'derived',
  },
  {
    key: 'pressure',
    responseKey: 'pressure',
    label: 'Atmospheric pressure (transducer 1)',
    dataClass: 'derived',
  },
  {
    key: 'windSpeed',
    responseKey: 'windSpeed',
    label: 'Horizontal wind speed',
    dataClass: 'derived',
  },
  {
    key: 'windDirection',
    responseKey: 'windDirection',
    label: 'Wind direction (from north)',
    dataClass: 'derived',
  },
];

function observationEntry(
  key: MedaSensorKey,
  label: string,
  dataClass: 'measured' | 'derived',
  observation: MedaSensorObservation & { rawKelvin?: number | null },
  latestSol: number,
): MedaObservationEntry {
  const isTemperature = key === 'airTemperature';
  const rawKelvin = isTemperature ? (observation.rawKelvin ?? null) : null;

  return {
    sensor: key,
    label,
    value: observation.value,
    unit: observation.unit,
    rawValue: isTemperature ? rawKelvin : null,
    rawUnit: isTemperature ? 'K' : null,
    sol: observation.sol,
    lmst: observation.lmst,
    ltst: observation.ltst,
    utcTime: observation.utcTime,
    sensorId: observation.sensorId,
    instrument: 'MEDA',
    productType: observation.productType,
    productFile: observation.productFile,
    status: observation.status,
    qualityNote: observation.qualityNote ?? null,
    solsOlderThanLatest: Math.max(0, latestSol - observation.sol),
    dataClass,
  };
}

function unavailableResult(
  fetchedAt: string,
  reason: string,
  archiveUrl: string,
): MedaObservationsResult {
  return {
    tool: 'get_meda_observations',
    status: 'unavailable',
    source: {
      provider: 'NASA Planetary Data System (PDS) Atmospheres Node',
      mission: 'Mars 2020 (Perseverance)',
      instrument: 'MEDA',
      archiveUrl,
      fetchedAt,
      fromCache: false,
      isLastKnownGood: false,
    },
    observations: [],
    coverage: {
      measurementType: 'in-situ',
      locationDescription:
        'Perseverance rover, Jezero Crater, Mars (rover location is not published with the product rows).',
      observationLocation: null,
      observationLocationNote:
        'MEDA rows contain no rover coordinates. SOLARA does not infer or assign a map position to these observations.',
      temporalCoverage: 'unknown',
      spatialScope: 'Point in-situ measurements along the rover traverse; not an area coverage product.',
    },
    warnings: [reason],
  };
}

/**
 * `get_meda_observations` service.
 *
 * @param options.refresh — bypass the handler's 5-minute cache. Tests and
 *   explicit freshness requests use this; normal assistant calls do not.
 */
export async function getMedaObservations(
  options: MedaObservationsInput = {},
): Promise<MedaObservationsResult> {
  const requestUrl = new URL('https://solara.local/api/meda/environment/latest');
  if (options.refresh) requestUrl.searchParams.set('refresh', 'true');

  let response: Response;
  try {
    response = await handleMedaEnvironmentLatest(new Request(requestUrl.toString()), undefined);
  } catch (error) {
    return unavailableResult(
      new Date().toISOString(),
      `MEDA request failed: ${error instanceof Error ? error.message : String(error)}.`,
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    );
  }

  if (!response.ok) {
    return unavailableResult(
      new Date().toISOString(),
      `MEDA handler returned HTTP ${response.status} ${response.statusText}.`,
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    );
  }

  let payload: MedaEnvironmentResponse;
  try {
    payload = (await response.json()) as MedaEnvironmentResponse;
  } catch {
    return unavailableResult(
      new Date().toISOString(),
      'MEDA handler returned a non-JSON response.',
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    );
  }

  if (!payload || typeof payload !== 'object' || !payload.sensors) {
    return unavailableResult(
      new Date().toISOString(),
      'MEDA handler returned an unexpected response shape.',
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    );
  }

  const missingSensors = SENSOR_META.filter((meta) => {
    const observation = payload.sensors[meta.responseKey] as unknown;
    return !observation || typeof observation !== 'object';
  });
  if (missingSensors.length > 0) {
    return unavailableResult(
      new Date().toISOString(),
      `MEDA handler response is missing sensor entries: ${missingSensors
        .map((meta) => meta.responseKey)
        .join(', ')}.`,
      'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
    );
  }

  const observationList = SENSOR_META.map((meta) => {
    const observation = payload.sensors[meta.responseKey] as MedaSensorObservation;
    return { meta, observation };
  });

  const latestSol = observationList.reduce(
    (max, { observation }) => (Number.isFinite(observation.sol) ? Math.max(max, observation.sol) : max),
    0,
  );

  const observations = observationList.map(({ meta, observation }) =>
    observationEntry(meta.key, meta.label, meta.dataClass, observation, latestSol),
  );

  const warnings: string[] = [
    'These are in-situ MEDA observations at the Perseverance rover inside Jezero Crater, not weather at another map coordinate and not a forecast.',
  ];

  if (payload.source.isLastKnownGood) {
    warnings.push(
      'At least one live PDS read failed. The adapter returned directly verified last-known-good values flagged `isLastKnownGood`; see `errors`.',
    );
  }

  const windSol = observations.find((entry) => entry.sensor === 'windSpeed')?.sol ?? null;
  const latestNonWindSol =
    observations.find((entry) => entry.sensor === 'airTemperature')?.sol ?? latestSol;
  if (windSol !== null && latestNonWindSol !== null && windSol < latestNonWindSol) {
    warnings.push(
      `Wind observations are from Sol ${windSol}, while ATS/PS/RHS are from Sol ${latestNonWindSol}. The wind sensor was damaged around Sol 315; these values are not a simultaneous snapshot.`,
    );
  }

  const anyValue = observations.some((entry) => entry.value !== null);
  if (!anyValue) {
    warnings.push('No sensor returned a numeric value; all observations are missing.');
  }

  return {
    tool: 'get_meda_observations',
    status: anyValue ? 'available' : 'unavailable',
    source: {
      provider: payload.source.provider,
      mission: payload.source.mission,
      instrument: payload.source.instrument,
      archiveUrl: payload.source.archiveUrl,
      fetchedAt: payload.source.fetchedAt,
      fromCache: payload.source.fromCache,
      isLastKnownGood: payload.source.isLastKnownGood,
    },
    observations,
    coverage: {
      measurementType: 'in-situ',
      locationDescription:
        'Perseverance rover, Jezero Crater, Mars (rover location is not published with the product rows).',
      observationLocation: null,
      observationLocationNote:
        'MEDA rows contain no rover coordinates. SOLARA does not infer or assign a map position to these observations.',
      temporalCoverage:
        payload.source.isLastKnownGood
          ? 'Last-known-good archive values; per-observation sol/time is reported for each sensor.'
          : 'Latest rows retrieved from the PDS archive; per-observation sol/time is reported for each sensor.',
      spatialScope:
        'Point in-situ measurements along the rover traverse; not an area coverage product.',
    },
    warnings,
    ...(payload.errors && payload.errors.length > 0 ? { errors: [...payload.errors] } : {}),
  };
}
