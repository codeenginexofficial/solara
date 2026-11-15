/**
 * OpenRouter tool definitions and validated dispatch to Agent C's isolated,
 * deterministic scientific services. This module owns orchestration only;
 * the service implementations and their result contracts stay in ./science.
 */

import { getDatasetCoverage } from './science/coverage';
import { getTerrainElevation } from './science/dem';
import { getMedaObservations } from './science/meda';
import { getNearbyHistoricalRoverTrack, listPerseveranceRoverImages } from './science/rover';
import { calculateSlope } from './science/slope';

const MAX_ARGUMENT_CHARS = 8_000;
const MAX_RESULT_CHARS = 48_000;
const MAX_IMAGE_RESULTS = 24;
const MAX_SOL = 1_000_000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function invalidArguments(message: string): string {
  return JSON.stringify({ error: 'invalid_arguments', status: 'unavailable', message });
}

function toolFailure(message: string): string {
  return JSON.stringify({ status: 'unavailable', warnings: [message] });
}

function serializeResult(result: unknown): string {
  const serialized = JSON.stringify(result);
  if (!serialized) return toolFailure('The scientific service returned no serializable result.');
  if (serialized.length > MAX_RESULT_CHARS) {
    return toolFailure('The scientific service result was too large to return to the assistant.');
  }
  return serialized;
}

/** OpenAI-compatible function tools accepted by OpenRouter chat completions. */
export const SCIENTIFIC_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_meda_observations',
      description:
        'Retrieve the latest available Perseverance MEDA sensor observations from the NASA PDS archive. This takes no map coordinate: each sensor has its own sol and time, and the product rows publish no rover coordinates. Values are historical in-situ measurements, not weather at the selected point or a forecast.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_terrain_elevation',
      description:
        'Query one point in the NASA Trek MOLA+HRSC blended DEM. Coordinates are east-positive longitude and planetocentric latitude in degrees on Mars. Returns elevation in metres, explicit no-data/coverage status, source and limitations. The approximately 200 m/pixel DEM is regional context, not a site survey.',
      parameters: {
        type: 'object',
        properties: {
          longitudeEastDeg: { type: 'number', minimum: -180, maximum: 180 },
          latitudePlanetocentricDeg: { type: 'number', minimum: -90, maximum: 90 },
        },
        required: ['longitudeEastDeg', 'latitudePlanetocentricDeg'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_slope',
      description:
        'Calculate deterministic terrain slope at a Mars coordinate from the centre and four neighbouring samples of the real MOLA+HRSC DEM using a central-difference stencil. Coordinates are east-positive longitude and planetocentric latitude in degrees. Returns slope in degrees, downhill aspect, each sample, spacing, provenance and warnings. Missing neighbours produce no numeric slope.',
      parameters: {
        type: 'object',
        properties: {
          longitudeEastDeg: { type: 'number', minimum: -180, maximum: 180 },
          latitudePlanetocentricDeg: { type: 'number', minimum: -90, maximum: 90 },
        },
        required: ['longitudeEastDeg', 'latitudePlanetocentricDeg'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dataset_coverage',
      description:
        'Check catalog-declared dataset extents at an east-positive, planetocentric Mars coordinate. Each dataset reports within_declared_extent, outside_declared_extent, or extent_unknown. Extent membership is not proof of valid pixels or observations.',
      parameters: {
        type: 'object',
        properties: {
          longitudeEastDeg: { type: 'number', minimum: -180, maximum: 180 },
          latitudePlanetocentricDeg: { type: 'number', minimum: -90, maximum: 90 },
        },
        required: ['longitudeEastDeg', 'latitudePlanetocentricDeg'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_nearby_historical_rover_track',
      description:
        'Find the nearest published historical Perseverance traverse segment near an east-positive, planetocentric Mars coordinate. This is a historical track association, never a live rover location or an astronaut route. The search radius is 100–10,000 m.',
      parameters: {
        type: 'object',
        properties: {
          longitudeEastDeg: { type: 'number', minimum: -180, maximum: 180 },
          latitudePlanetocentricDeg: { type: 'number', minimum: -90, maximum: 90 },
          radiusM: { type: 'number', minimum: 100, maximum: 10_000 },
        },
        required: ['longitudeEastDeg', 'latitudePlanetocentricDeg'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rover_imagery_metadata',
      description:
        'List NASA Perseverance raw-image metadata for a historical Mars sol. Results do not include validated surface coordinates; do not claim that an image depicts the selected point. The tool returns metadata only, not image interpretation.',
      parameters: {
        type: 'object',
        properties: {
          sol: { type: 'integer', minimum: 0, maximum: MAX_SOL },
          limit: { type: 'integer', minimum: 1, maximum: MAX_IMAGE_RESULTS },
        },
        required: ['sol'],
        additionalProperties: false,
      },
    },
  },
] as const;

function parseArguments(rawArguments: string): JsonObject | null {
  if (rawArguments.length === 0 || rawArguments.length > MAX_ARGUMENT_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCoordinate(args: JsonObject):
  | { longitudeEastDeg: number; latitudePlanetocentricDeg: number }
  | string {
  const longitudeEastDeg = args.longitudeEastDeg;
  const latitudePlanetocentricDeg = args.latitudePlanetocentricDeg;
  if (
    typeof longitudeEastDeg !== 'number' ||
    !Number.isFinite(longitudeEastDeg) ||
    longitudeEastDeg < -180 ||
    longitudeEastDeg > 180
  ) {
    return 'longitudeEastDeg must be a finite number from -180 through 180.';
  }
  if (
    typeof latitudePlanetocentricDeg !== 'number' ||
    !Number.isFinite(latitudePlanetocentricDeg) ||
    latitudePlanetocentricDeg < -90 ||
    latitudePlanetocentricDeg > 90
  ) {
    return 'latitudePlanetocentricDeg must be a finite number from -90 through 90.';
  }
  return { longitudeEastDeg, latitudePlanetocentricDeg };
}

function validateCoordinateKeys(args: JsonObject):
  | { longitudeEastDeg: number; latitudePlanetocentricDeg: number }
  | string {
  if (!hasOnlyKeys(args, ['longitudeEastDeg', 'latitudePlanetocentricDeg'])) {
    return 'Only longitudeEastDeg and latitudePlanetocentricDeg are accepted.';
  }
  return readCoordinate(args);
}

/** Execute one model-requested tool after strict server-side argument checks. */
export async function runScientificToolCall(
  name: string,
  rawArguments: string,
): Promise<string> {
  const args = parseArguments(rawArguments);
  if (!args) return invalidArguments('Arguments must be a JSON object within the size limit.');

  try {
    switch (name) {
      case 'get_meda_observations': {
        if (Object.keys(args).length !== 0) {
          return invalidArguments('get_meda_observations accepts no arguments.');
        }
        return serializeResult(await getMedaObservations());
      }
      case 'get_terrain_elevation': {
        const coordinate = validateCoordinateKeys(args);
        if (typeof coordinate === 'string') return invalidArguments(coordinate);
        return serializeResult(
          await getTerrainElevation(coordinate.longitudeEastDeg, coordinate.latitudePlanetocentricDeg),
        );
      }
      case 'calculate_slope': {
        const coordinate = validateCoordinateKeys(args);
        if (typeof coordinate === 'string') return invalidArguments(coordinate);
        return serializeResult(
          await calculateSlope(coordinate.longitudeEastDeg, coordinate.latitudePlanetocentricDeg),
        );
      }
      case 'get_dataset_coverage': {
        const coordinate = validateCoordinateKeys(args);
        if (typeof coordinate === 'string') return invalidArguments(coordinate);
        return serializeResult(
          getDatasetCoverage(coordinate.longitudeEastDeg, coordinate.latitudePlanetocentricDeg),
        );
      }
      case 'get_nearby_historical_rover_track': {
        if (!hasOnlyKeys(args, ['longitudeEastDeg', 'latitudePlanetocentricDeg', 'radiusM'])) {
          return invalidArguments('Unexpected argument for get_nearby_historical_rover_track.');
        }
        const coordinate = readCoordinate(args);
        if (typeof coordinate === 'string') return invalidArguments(coordinate);
        const radiusM = args.radiusM;
        if (
          radiusM !== undefined &&
          (typeof radiusM !== 'number' || !Number.isFinite(radiusM) || radiusM < 100 || radiusM > 10_000)
        ) {
          return invalidArguments('radiusM must be a number from 100 through 10000.');
        }
        return serializeResult(
          await getNearbyHistoricalRoverTrack(
            coordinate.longitudeEastDeg,
            coordinate.latitudePlanetocentricDeg,
            radiusM === undefined ? {} : { radiusM },
          ),
        );
      }
      case 'get_rover_imagery_metadata': {
        if (!hasOnlyKeys(args, ['sol', 'limit'])) {
          return invalidArguments('Only sol and limit are accepted for rover image metadata.');
        }
        const sol = args.sol;
        if (typeof sol !== 'number' || !Number.isSafeInteger(sol) || sol < 0 || sol > MAX_SOL) {
          return invalidArguments(`sol must be a non-negative integer no greater than ${MAX_SOL}.`);
        }
        const limit = args.limit;
        if (
          limit !== undefined &&
          (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_IMAGE_RESULTS)
        ) {
          return invalidArguments(`limit must be an integer from 1 through ${MAX_IMAGE_RESULTS}.`);
        }
        return serializeResult(
          await listPerseveranceRoverImages({ sol, ...(limit === undefined ? {} : { limit }) }),
        );
      }
      default:
        return JSON.stringify({
          error: 'unknown_tool',
          status: 'unavailable',
          message: 'The requested scientific tool is not available.',
        });
    }
  } catch {
    return toolFailure('The requested scientific service did not complete successfully.');
  }
}
