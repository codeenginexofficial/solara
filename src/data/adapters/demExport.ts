import type { ElevationGrid, GridExtentDeg } from './elevationGrid';
import {
  logicalLongitudeForExtent,
  type DemWindowSegment,
  type RouteWindow,
} from '../../science/terrain/routeGrid';

const EXPORT_SR = 104905;
const EXPORT_FORMAT = 'tiff';
const EXPORT_INTERPOLATION = 'RSP_NearestNeighbor';
const NO_DATA_VALUE = -32768;
const MAX_EXPORT_PIXELS = 4_000_000;
const REQUEST_TIMEOUT_MS = 45_000;

const VERTICAL_REFERENCE =
  'Elevation relative to the Mars areoid (MOLA reference). The MOLA+HRSC blend is registered to MOLA topography; HRSC contributes higher planimetric resolution. Treat as derived, vertically aligned to MOLA.';

const SOURCE_METHOD =
  'NASA Trek ArcGIS ImageServer exportImage f=image&format=tiff at native or coarsened window resolution, nearest-neighbour sampling, then stitched in SOLARA:MARS_2000_SPHERE_LONLAT.';

export type DemExportErrorCode = 'dem-unavailable' | 'dem-response-invalid';

export class DemExportError extends Error {
  readonly code: DemExportErrorCode;

  constructor(code: DemExportErrorCode, message: string) {
    super(message);
    this.name = 'DemExportError';
    this.code = code;
  }
}

interface ExportExtent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface ExportMetadata {
  width: number;
  height: number;
  extent: ExportExtent;
}

export interface DemWindowGrid {
  grid: ElevationGrid;
  datelineSegments: number;
  seamBridgedCells: number;
  acquiredAt: string;
}

interface TiffTag {
  type: number;
  count: number;
  valueOffset: number;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DemExportError('dem-response-invalid', `${label} is missing or not a finite number.`);
  }
  return value;
}

function readTiffTags(view: DataView, littleEndian: boolean): Map<number, TiffTag> {
  if (view.byteLength < 8) throw new DemExportError('dem-response-invalid', 'DEM TIFF is too short.');
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > view.byteLength) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF IFD offset is outside the response.');
  }
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  const tags = new Map<number, TiffTag>();
  for (let i = 0; i < entryCount; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) {
      throw new DemExportError('dem-response-invalid', 'DEM TIFF IFD entry is truncated.');
    }
    tags.set(view.getUint16(entry, littleEndian), {
      type: view.getUint16(entry + 2, littleEndian),
      count: view.getUint32(entry + 4, littleEndian),
      valueOffset: entry + 8,
    });
  }
  return tags;
}

function tagValues(view: DataView, littleEndian: boolean, tag: TiffTag, label: string): number[] {
  const typeSize =
    tag.type === 1 ? 1 : tag.type === 3 ? 2 : tag.type === 4 ? 4 : tag.type === 16 ? 8 : 0;
  if (typeSize === 0) {
    throw new DemExportError('dem-response-invalid', `DEM TIFF tag ${label} has unsupported type ${tag.type}.`);
  }
  if (tag.count > 100_000) {
    throw new DemExportError('dem-response-invalid', `DEM TIFF tag ${label} has an implausible count.`);
  }
  const byteLength = typeSize * tag.count;
  const offset = byteLength <= 4 ? tag.valueOffset : view.getUint32(tag.valueOffset, littleEndian);
  if (offset + byteLength > view.byteLength) {
    throw new DemExportError('dem-response-invalid', `DEM TIFF tag ${label} points outside the response.`);
  }
  const values: number[] = [];
  for (let i = 0; i < tag.count; i++) {
    const at = offset + i * typeSize;
    if (tag.type === 1) values.push(view.getUint8(at));
    else if (tag.type === 3) values.push(view.getUint16(at, littleEndian));
    else if (tag.type === 4) values.push(view.getUint32(at, littleEndian));
    else values.push(Number(view.getBigUint64(at, littleEndian)));
  }
  return values;
}

function readTag(
  view: DataView,
  littleEndian: boolean,
  tags: Map<number, TiffTag>,
  tagId: number,
  label: string,
  required: true,
): number[];
function readTag(
  view: DataView,
  littleEndian: boolean,
  tags: Map<number, TiffTag>,
  tagId: number,
  label: string,
  required: false,
): number[] | null;
function readTag(
  view: DataView,
  littleEndian: boolean,
  tags: Map<number, TiffTag>,
  tagId: number,
  label: string,
  required: boolean,
): number[] | null {
  const tag = tags.get(tagId);
  if (!tag) {
    if (required) {
      throw new DemExportError('dem-response-invalid', `DEM TIFF is missing required tag ${label}.`);
    }
    return null;
  }
  return tagValues(view, littleEndian, tag, label);
}

export function decodeDemTiff(buffer: Uint8Array): { width: number; height: number; values: Int16Array } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength < 2) throw new DemExportError('dem-response-invalid', 'DEM TIFF is empty.');
  const order = view.getUint16(0, true);
  if (order !== 0x4949 && order !== 0x4d4d) {
    throw new DemExportError('dem-response-invalid', 'DEM response is not a TIFF file.');
  }
  const littleEndian = order === 0x4949;
  if (view.getUint16(2, littleEndian) !== 42) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF has an unexpected version marker.');
  }
  const tags = readTiffTags(view, littleEndian);
  const width = readTag(view, littleEndian, tags, 256, 'ImageWidth', true)[0] ?? 0;
  const height = readTag(view, littleEndian, tags, 257, 'ImageLength', true)[0] ?? 0;
  const bits = readTag(view, littleEndian, tags, 258, 'BitsPerSample', true);
  const compression = readTag(view, littleEndian, tags, 259, 'Compression', true)[0] ?? 0;
  const sampleFormat = readTag(view, littleEndian, tags, 339, 'SampleFormat', false);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF has invalid image dimensions.');
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF exceeds the supported pixel limit.');
  }
  if (bits.length === 0 || bits.some((value) => value !== 16)) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF is not 16-bit.');
  }
  if (sampleFormat === null || sampleFormat[0] !== 2) {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF is not signed 16-bit integer data.');
  }
  if (compression !== 1) {
    throw new DemExportError('dem-response-invalid', `DEM TIFF uses unsupported compression ${compression}.`);
  }

  const values = new Int16Array(width * height);
  const tileWidth = readTag(view, littleEndian, tags, 322, 'TileWidth', false)?.[0];
  const tileHeight = readTag(view, littleEndian, tags, 323, 'TileLength', false)?.[0];
  const tileOffsets = readTag(view, littleEndian, tags, 324, 'TileOffsets', false);
  const tileByteCounts = readTag(view, littleEndian, tags, 325, 'TileByteCounts', false);
  const stripOffsets = readTag(view, littleEndian, tags, 273, 'StripOffsets', false);
  const stripByteCounts = readTag(view, littleEndian, tags, 279, 'StripByteCounts', false);

  if (tileOffsets !== null) {
    if (
      tileWidth === undefined ||
      tileHeight === undefined ||
      tileWidth <= 0 ||
      tileHeight <= 0 ||
      tileByteCounts === null
    ) {
      throw new DemExportError('dem-response-invalid', 'DEM TIFF tiling metadata is incomplete.');
    }
    const tilesAcross = Math.ceil(width / tileWidth);
    for (let tile = 0; tile < tileOffsets.length; tile++) {
      const offset = tileOffsets[tile]!;
      const byteCount = tileByteCounts[tile] ?? tileWidth * tileHeight * 2;
      if (offset + byteCount > view.byteLength) {
        throw new DemExportError('dem-response-invalid', `DEM TIFF tile ${tile} points outside the response.`);
      }
      const tileRow = Math.floor(tile / tilesAcross);
      const tileCol = tile - tileRow * tilesAcross;
      for (let row = 0; row < tileHeight; row++) {
        const y = tileRow * tileHeight + row;
        if (y >= height) break;
        for (let col = 0; col < tileWidth; col++) {
          const x = tileCol * tileWidth + col;
          if (x >= width) break;
          values[y * width + x] = view.getInt16(offset + (row * tileWidth + col) * 2, littleEndian);
        }
      }
    }
  } else if (stripOffsets !== null) {
    if (stripByteCounts === null) {
      throw new DemExportError('dem-response-invalid', 'DEM TIFF strip metadata is incomplete.');
    }
    let pixel = 0;
    for (let strip = 0; strip < stripOffsets.length; strip++) {
      const offset = stripOffsets[strip]!;
      const byteCount = stripByteCounts[strip] ?? 0;
      if (offset + byteCount > view.byteLength) {
        throw new DemExportError('dem-response-invalid', `DEM TIFF strip ${strip} points outside the response.`);
      }
      for (let byte = 0; byte < byteCount && pixel < width * height; byte += 2, pixel++) {
        values[pixel] = view.getInt16(offset + byte, littleEndian);
      }
    }
  } else {
    throw new DemExportError('dem-response-invalid', 'DEM TIFF contains neither tiles nor strips.');
  }

  return { width, height, values };
}

async function fetchWithRetry(url: string, label: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { mode: 'cors', signal: controller.signal });
      if (response.ok) return response;
      if (response.status >= 500 || response.status === 429) {
        lastError = new DemExportError(
          'dem-unavailable',
          `${label} failed: HTTP ${response.status} ${response.statusText}.`,
        );
      } else {
        throw new DemExportError(
          'dem-response-invalid',
          `${label} failed: HTTP ${response.status} ${response.statusText}.`,
        );
      }
    } catch (error) {
      if (error instanceof DemExportError) {
        if (error.code === 'dem-response-invalid') throw error;
        lastError = error;
      } else {
        lastError = new DemExportError(
          'dem-unavailable',
          `${label} could not be fetched: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (lastError instanceof DemExportError) throw lastError;
  throw new DemExportError('dem-unavailable', `${label} could not be fetched.`);
}

function exportUrl(
  endpoint: string,
  format: 'json' | 'image',
  extent: { westLon: number; southLat: number; eastLon: number; northLat: number },
  size: { cols: number; rows: number },
): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  const bbox = `${extent.westLon},${extent.southLat},${extent.eastLon},${extent.northLat}`;
  return (
    `${endpoint}${separator}f=${format}&bbox=${encodeURIComponent(bbox)}` +
    `&bboxSR=${EXPORT_SR}&size=${size.cols},${size.rows}&imageSR=${EXPORT_SR}` +
    `&format=${EXPORT_FORMAT}&interpolation=${EXPORT_INTERPOLATION}`
  );
}

async function fetchExportMetadata(
  endpoint: string,
  segment: DemWindowSegment,
): Promise<ExportMetadata> {
  const url = exportUrl(
    endpoint,
    'json',
    { westLon: segment.westLon, southLat: segment.southLat, eastLon: segment.eastLon, northLat: segment.northLat },
    { cols: segment.cols, rows: segment.rows },
  );
  const response = await fetchWithRetry(url, 'DEM export metadata');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new DemExportError(
      'dem-response-invalid',
      `DEM export metadata was not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new DemExportError('dem-response-invalid', 'DEM export metadata is not a JSON object.');
  }
  const root = payload as {
    error?: unknown;
    width?: unknown;
    height?: unknown;
    extent?: { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown; spatialReference?: { wkid?: unknown } };
  };
  if (root.error !== undefined) {
    throw new DemExportError('dem-response-invalid', `DEM export metadata error: ${JSON.stringify(root.error)}.`);
  }
  const width = requireFinite(root.width, 'DEM export width');
  const height = requireFinite(root.height, 'DEM export height');
  const extent = root.extent;
  if (!extent) throw new DemExportError('dem-response-invalid', 'DEM export metadata has no extent.');
  const xmin = requireFinite(extent.xmin, 'DEM export xmin');
  const ymin = requireFinite(extent.ymin, 'DEM export ymin');
  const xmax = requireFinite(extent.xmax, 'DEM export xmax');
  const ymax = requireFinite(extent.ymax, 'DEM export ymax');
  if (extent.spatialReference?.wkid !== undefined && Number(extent.spatialReference.wkid) !== EXPORT_SR) {
    throw new DemExportError('dem-response-invalid', 'DEM export metadata returned an unexpected spatial reference.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new DemExportError('dem-response-invalid', 'DEM export metadata has invalid image dimensions.');
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new DemExportError('dem-response-invalid', 'DEM export metadata exceeds the supported pixel limit.');
  }
  if (!(xmax > xmin) || !(ymax > ymin)) {
    throw new DemExportError('dem-response-invalid', 'DEM export metadata has a degenerate extent.');
  }
  return { width, height, extent: { xmin, ymin, xmax, ymax } };
}

async function fetchExportTiff(endpoint: string, segment: DemWindowSegment, metadata: ExportMetadata): Promise<Int16Array> {
  const url = exportUrl(
    endpoint,
    'image',
    { westLon: segment.westLon, southLat: segment.southLat, eastLon: segment.eastLon, northLat: segment.northLat },
    { cols: segment.cols, rows: segment.rows },
  );
  const response = await fetchWithRetry(url, 'DEM export image');
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new DemExportError(
      'dem-unavailable',
      `DEM export image could not be read: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  const tiff = decodeDemTiff(buffer);
  if (tiff.width !== metadata.width || tiff.height !== metadata.height) {
    throw new DemExportError(
      'dem-response-invalid',
      `DEM TIFF size ${tiff.width}x${tiff.height} does not match declared ${metadata.width}x${metadata.height}.`,
    );
  }
  return tiff.values;
}

function mapSegmentIntoWindow(
  segment: DemWindowSegment,
  metadata: ExportMetadata,
  tiffValues: Int16Array,
  window: RouteWindow,
  values: Int16Array,
  valid: Uint8Array,
): number {
  const { width, height, extent } = metadata;
  const segmentColumnEnd = segment.columnStart + segment.cols;
  let mapped = 0;
  for (let row = 0; row < height; row++) {
    const latitude = extent.ymax - ((row + 0.5) * (extent.ymax - extent.ymin)) / height;
    const rawTargetRow = Math.floor((window.extent.northLat - latitude) / window.cellSizeDegY);
    const targetRow =
      rawTargetRow === -1 ? 0 : rawTargetRow === window.rows ? window.rows - 1 : rawTargetRow;
    if (targetRow < 0 || targetRow >= window.rows) continue;
    for (let col = 0; col < width; col++) {
      const longitude = extent.xmin + ((col + 0.5) * (extent.xmax - extent.xmin)) / width;
      const logicalLongitude = logicalLongitudeForExtent(longitude, window.extent);
      const targetCol = Math.floor((logicalLongitude - window.extent.westLon) / window.cellSizeDegX);
      if (targetCol < segment.columnStart || targetCol >= segmentColumnEnd) continue;
      const source = tiffValues[row * width + col]!;
      const target = targetRow * window.cols + targetCol;
      values[target] = source;
      valid[target] = source === NO_DATA_VALUE ? 0 : 1;
      mapped++;
    }
  }
  return mapped;
}

function bridgeDatelineSeam(
  window: RouteWindow,
  values: Int16Array,
  valid: Uint8Array,
): number {
  const boundary = window.segments[1]?.columnStart;
  if (boundary === undefined) return 0;
  let bridged = 0;
  const maxGapCells = 3;
  for (let row = 0; row < window.rows; row++) {
    let left = -1;
    for (let col = boundary - 1; col >= Math.max(0, boundary - maxGapCells); col--) {
      if (valid[row * window.cols + col]) {
        left = col;
        break;
      }
    }
    let right = -1;
    for (let col = boundary; col < Math.min(window.cols, boundary + maxGapCells); col++) {
      if (valid[row * window.cols + col]) {
        right = col;
        break;
      }
    }
    if (left < 0 || right < 0 || right - left - 1 > maxGapCells) continue;
    for (let col = left + 1; col < right; col++) {
      const index = row * window.cols + col;
      if (valid[index]) continue;
      const sourceCol = col - left <= right - col ? left : right;
      values[index] = values[row * window.cols + sourceCol]!;
      valid[index] = 1;
      bridged++;
    }
  }
  return bridged;
}

function toGridExtent(extent: RouteWindow['extent']): GridExtentDeg {
  return {
    westLon: extent.westLon,
    southLat: extent.southLat,
    eastLon: extent.eastLon,
    northLat: extent.northLat,
  };
}

export async function fetchDemWindowGrid(
  window: RouteWindow,
  exportImageEndpoint: string,
): Promise<DemWindowGrid> {
  if (!exportImageEndpoint) {
    throw new DemExportError('dem-unavailable', 'No live DEM export endpoint is configured.');
  }
  if (window.segments.length === 0) {
    throw new DemExportError('dem-response-invalid', 'The route window has no DEM requestable segments.');
  }

  const metadata = await Promise.all(window.segments.map((segment) => fetchExportMetadata(exportImageEndpoint, segment)));
  const tiffs = await Promise.all(
    window.segments.map((segment, index) => fetchExportTiff(exportImageEndpoint, segment, metadata[index]!)),
  );

  const values = new Int16Array(window.cols * window.rows);
  const valid = new Uint8Array(window.cols * window.rows);
  let mapped = 0;
  for (let index = 0; index < window.segments.length; index++) {
    mapped += mapSegmentIntoWindow(
      window.segments[index]!,
      metadata[index]!,
      tiffs[index]!,
      window,
      values,
      valid,
    );
  }
  if (mapped === 0) {
    throw new DemExportError('dem-response-invalid', 'DEM window pixels did not map into the requested grid.');
  }
  const seamBridgedCells = bridgeDatelineSeam(window, values, valid);

  const acquiredAt = new Date().toISOString();
  return {
    grid: {
      meta: {
        format: 'solara-elevation-grid/1',
        datasetId: 'mola-hrsc-blend-200m-dem',
        crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT',
        elevationUnit: 'm',
        verticalReference: VERTICAL_REFERENCE,
        note:
          'Live NASA Trek exportImage window at route-search resolution. NoData pixels (source sentinel -32768) are UNKNOWN and impassable; a value of 0 is a measured elevation, not missing data. Narrow source-product seam gaps at ±180° may be bridged from the nearest known equivalent-meridian sample and are reported as derived.',
        extent: toGridExtent(window.extent),
        cols: window.cols,
        rows: window.rows,
        cellSizeDegX: window.cellSizeDegX,
        cellSizeDegY: window.cellSizeDegY,
        noDataValue: NO_DATA_VALUE,
        preparedAt: acquiredAt,
        sourceService: exportImageEndpoint,
        sourceMethod: SOURCE_METHOD,
        centreValidation: null,
      },
      cols: window.cols,
      rows: window.rows,
      values,
      valid,
    },
    datelineSegments: window.segments.length,
    seamBridgedCells,
    acquiredAt,
  };
}
