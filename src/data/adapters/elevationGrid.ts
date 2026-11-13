/**
 * Prepared elevation grid loader + sampler.
 *
 * The route engine consumes a static, prepared grid asset
 * (public/data/mars/jezero/rasters/mola-hrsc-dem-jezero-grid.json, format
 * "solara-elevation-grid/1") produced by scripts/prepare-jezero-assets.mjs
 * from the live Trek ImageServer (Mars_MOLA_blend200ppx_HRSC_DEM...,
 * ~200 m/px MOLA+HRSC blend). The script cross-validated the crop centre
 * against the live identify endpoint (diff 10.5 m, bilinear vs nearest
 * sampling) before writing the asset; the validation result is embedded in
 * the asset metadata and surfaced through `meta.centreValidation`.
 *
 * Asset schema (as written by scripts/prepare-jezero-assets.mjs):
 *   { solaraGrid: { format, datasetId, crsId, elevationUnit,
 *       verticalReference, width, height, extentDeg, cellSizeDegX,
 *       cellSizeDegY, noDataValue, note },
 *     source: { service, method, declaredPixelSizeDeg, queryBboxDeg,
 *       preparedAt, centreValidation },
 *     values: number[] }  // row-major, row 0 = northernmost row
 *
 * This module is deliberately ol-free and framework-free: it is used by the
 * route worker and the mission UI.
 *
 * Honesty rules (Context.md §7):
 *  - Sampling outside the grid extent is UNKNOWN, never interpolated.
 *  - NoData cells are UNKNOWN; bilinear interpolation never mixes NoData
 *    corners with valid values.
 *  - Callers must label values as derived from the prepared grid, including
 *    its preparation date (asset metadata), not as live observations.
 */

export const ELEVATION_GRID_FORMAT = 'solara-elevation-grid/1';

export interface GridExtentDeg {
  westLon: number;
  southLat: number;
  eastLon: number;
  northLat: number;
}

export interface ElevationGridMeta {
  format: string;
  datasetId: string;
  crsId: string;
  elevationUnit: string;
  verticalReference: string;
  note: string;
  extent: GridExtentDeg;
  cols: number;
  rows: number;
  cellSizeDegX: number;
  cellSizeDegY: number;
  /** Sentinel value for missing data, or null when the crop has none. */
  noDataValue: number | null;
  /** ISO timestamp from the preparation script (source.preparedAt). */
  preparedAt: string;
  sourceService: string;
  sourceMethod: string;
  centreValidation: {
    identifyValueM: number;
    gridBilinearM: number;
    diffM: number;
  } | null;
}

export interface ElevationGrid {
  meta: ElevationGridMeta;
  cols: number;
  rows: number;
  /** Row-major elevations in metres, row 0 = northernmost row. */
  values: Int16Array;
  /** Per-cell validity (0 where the source reported NoData). */
  valid: Uint8Array;
}

export class ElevationGridError extends Error {}

function requireNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ElevationGridError(`Grid asset field "${field}" is missing or not a finite number.`);
  }
  return v;
}

/** Fetch, validate and decode a prepared elevation grid asset. */
export async function fetchElevationGrid(url: string): Promise<ElevationGrid> {
  let json: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ElevationGridError(
        `Elevation grid asset request failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    json = await response.json();
  } catch (e) {
    if (e instanceof ElevationGridError) throw e;
    throw new ElevationGridError(
      `Elevation grid asset could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (typeof json !== 'object' || json === null) {
    throw new ElevationGridError('Grid asset is not a JSON object.');
  }
  const root = json as {
    solaraGrid?: unknown;
    source?: unknown;
    values?: unknown;
  };
  const grid = (typeof root.solaraGrid === 'object' && root.solaraGrid !== null
    ? root.solaraGrid
    : undefined) as Record<string, unknown> | undefined;
  const source = (typeof root.source === 'object' && root.source !== null
    ? root.source
    : undefined) as Record<string, unknown> | undefined;
  if (!grid || !source) {
    throw new ElevationGridError('Grid asset is missing the "solaraGrid" or "source" metadata block.');
  }

  if (grid.format !== ELEVATION_GRID_FORMAT) {
    throw new ElevationGridError(
      `Grid asset has unexpected format "${String(grid.format)}" — expected "${ELEVATION_GRID_FORMAT}".`,
    );
  }
  const cols = requireNumber(grid.width, 'solaraGrid.width');
  const rows = requireNumber(grid.height, 'solaraGrid.height');
  const cellSizeDegX = requireNumber(grid.cellSizeDegX, 'solaraGrid.cellSizeDegX');
  const cellSizeDegY = requireNumber(grid.cellSizeDegY, 'solaraGrid.cellSizeDegY');

  const extentRaw = grid.extentDeg as Record<string, unknown> | undefined;
  if (
    !extentRaw ||
    typeof extentRaw.westLon !== 'number' ||
    typeof extentRaw.eastLon !== 'number' ||
    typeof extentRaw.southLat !== 'number' ||
    typeof extentRaw.northLat !== 'number'
  ) {
    throw new ElevationGridError('Grid asset field "solaraGrid.extentDeg" is missing or malformed.');
  }
  const extent: GridExtentDeg = {
    westLon: extentRaw.westLon,
    eastLon: extentRaw.eastLon,
    southLat: extentRaw.southLat,
    northLat: extentRaw.northLat,
  };

  if (!Array.isArray(root.values)) {
    throw new ElevationGridError('Grid asset field "values" is missing or not an array.');
  }
  if (root.values.length !== cols * rows) {
    throw new ElevationGridError(
      `Grid asset declares ${cols}×${rows} cells but contains ${root.values.length} values.`,
    );
  }

  const noDataValue =
    grid.noDataValue === null || grid.noDataValue === undefined ? null : requireNumber(grid.noDataValue, 'solaraGrid.noDataValue');

  const values = new Int16Array(cols * rows);
  const valid = new Uint8Array(cols * rows);
  for (let i = 0; i < root.values.length; i++) {
    const v = root.values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ElevationGridError(`Grid value at index ${i} is not a finite number.`);
    }
    values[i] = v;
    valid[i] = noDataValue !== null && v === noDataValue ? 0 : 1;
  }

  const centreValidationRaw = source.centreValidation as Record<string, unknown> | undefined;
  const centreValidation =
    centreValidationRaw &&
    typeof centreValidationRaw.identifyValueM === 'number' &&
    typeof centreValidationRaw.gridBilinearM === 'number' &&
    typeof centreValidationRaw.diffM === 'number'
      ? {
          identifyValueM: centreValidationRaw.identifyValueM,
          gridBilinearM: centreValidationRaw.gridBilinearM,
          diffM: centreValidationRaw.diffM,
        }
      : null;

  return {
    meta: {
      format: String(grid.format),
      datasetId: String(grid.datasetId ?? ''),
      crsId: String(grid.crsId ?? ''),
      elevationUnit: String(grid.elevationUnit ?? 'm'),
      verticalReference: String(grid.verticalReference ?? ''),
      note: String(grid.note ?? ''),
      extent,
      cols,
      rows,
      cellSizeDegX,
      cellSizeDegY,
      noDataValue,
      preparedAt: String(source.preparedAt ?? ''),
      sourceService: String(source.service ?? ''),
      sourceMethod: String(source.method ?? ''),
      centreValidation,
    },
    cols,
    rows,
    values,
    valid,
  };
}

/** Result of a grid sample. `interpolated=false` means nearest-neighbour. */
export interface GridSample {
  /** Elevation in metres, or null when the sample is UNKNOWN. */
  elevationM: number | null;
  /** True when the value came from bilinear interpolation of 4 valid cells. */
  interpolated: boolean;
}

/**
 * Bilinear sample of the grid at a geographic position. Positions outside
 * the grid extent sample as UNKNOWN (never extrapolated). Samples touching
 * a NoData cell are UNKNOWN (no mixing of known and unknown corners).
 */
export function sampleElevation(grid: ElevationGrid, lon: number, lat: number): GridSample {
  const { meta, cols, rows, values, valid } = grid;
  const { westLon, southLat, eastLon, northLat } = meta.extent;
  if (lon < westLon || lon > eastLon || lat < southLat || lat > northLat) {
    return { elevationM: null, interpolated: false };
  }
  // Column/row in cell units (row 0 is the northernmost row).
  const fx = ((lon - westLon) / (eastLon - westLon)) * cols;
  const fy = ((northLat - lat) / (northLat - southLat)) * rows;
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
  // Clamp to the last cell; the extreme east/north edge uses the final cell.
  const x1 = Math.min(x0 + 1, cols - 1);
  const y1 = Math.min(y0 + 1, rows - 1);

  const i00 = y0 * cols + x0;
  const i10 = y0 * cols + x1;
  const i01 = y1 * cols + x0;
  const i11 = y1 * cols + x1;

  const v00 = values[i00]!;
  const v10 = values[i10]!;
  const v01 = values[i01]!;
  const v11 = values[i11]!;
  if (!valid[i00] || !valid[i10] || !valid[i01] || !valid[i11]) {
    return { elevationM: null, interpolated: false };
  }

  const tx = fx - x0;
  const ty = fy - y0;
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  const value = top + (bottom - top) * ty;
  return { elevationM: value, interpolated: true };
}

/**
 * Ground distance (metres) of one grid cell step east-west at the given
 * latitude on the Mars 2000 sphere.
 */
export function cellMetresAtLatitude(cellSizeDeg: number, latDeg: number, metresPerDegree: number): number {
  return cellSizeDeg * metresPerDegree * Math.cos((latDeg * Math.PI) / 180);
}
