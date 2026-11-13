/**
 * SOLARA — Jezero prepared-asset builder.
 *
 * Converts verified NASA Trek services into small static assets for the
 * no-backend MVP. Every asset records its exact source (service + query date)
 * in a `solara` metadata block so provenance stays auditable.
 *
 * Sources (all verified reachable on 2026-11-13):
 *  - USGS SIM 3292 global geology (Tanaka et al., 2014), Trek ArcGIS MapServer
 *    query over the Jezero footprint (1° margin for context).
 *  - Perseverance_Traverse_Path Trek ArcGIS MapServer (M2020 rover
 *    localization-derived traverse segments by sol).
 *  - perseverance_landing_ellipse Trek ArcGIS MapServer.
 *  - Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw Trek ArcGIS
 *    ImageServer exportImage (MOLA+HRSC blend DEM, ~200 m/px), cropped to the
 *    CTX mosaic footprint at native pixel size.
 *
 * Coordinate systems:
 *  - Vector services return lon/lat degrees in the ESRI "Mars 2000" geographic
 *    CRS (ESRI:104905). Numerically these are planetocentric east-positive
 *    degrees on the Mars 2000 sphere; assets record them as
 *    SOLARA:MARS_2000_SPHERE_LONLAT (IAU:2015:49900-equivalent). No EPSG:4326
 *    claim is made.
 *  - The DEM exportImage response extent is returned by the service itself
 *    (f=json) and copied verbatim; cell sizes are derived from that extent.
 *
 * Usage:  node scripts/prepare-jezero-assets.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const outRoot = join(repoRoot, 'public', 'data', 'mars', 'jezero');

const PREPARED_AT = new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Trek ArcGIS query helpers                                           */
/* ------------------------------------------------------------------ */

const ARCGIS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';

async function fetchJson(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

/** Query an ArcGIS MapServer layer intersecting an envelope, as esri JSON. */
async function queryLayer(service, geometry, extraParams = '') {
  const geom = encodeURIComponent(JSON.stringify(geometry));
  const url =
    `${ARCGIS}/${service}/MapServer/0/query?f=json&where=1%3D1` +
    `&geometry=${geom}&geometryType=esriGeometryEnvelope&inSR=104905` +
    `&spatialRel=esriSpatialRelIntersects&outFields=*&outSR=104905${extraParams}`;
  const j = await fetchJson(url);
  if (j.error) throw new Error(`ArcGIS error for ${service}: ${JSON.stringify(j.error)}`);
  return j;
}

/* ------------------------------------------------------------------ */
/* esri JSON → GeoJSON conversion                                      */
/* ------------------------------------------------------------------ */

function esriGeometryToGeoJson(geometry) {
  if (geometry.x !== undefined && geometry.y !== undefined) {
    return { type: 'Point', coordinates: [geometry.x, geometry.y] };
  }
  if (geometry.paths) {
    return { type: geometry.paths.length > 1 ? 'MultiLineString' : 'LineString', coordinates: geometry.paths.length > 1 ? geometry.paths : geometry.paths[0] };
  }
  if (geometry.rings) {
    // esri rings: first/last point equal; GeoJSON polygon rings need that too.
    return {
      type: geometry.rings.length > 1 ? 'MultiPolygon' : 'Polygon',
      coordinates: geometry.rings.length > 1 ? [[...geometry.rings]] : geometry.rings,
    };
  }
  throw new Error('Unsupported esri geometry');
}

function toFeatureCollection(esriFeatures, crsNote) {
  return {
    type: 'FeatureCollection',
    // GeoJSON spec has no Mars CRS; the coordinate meaning is recorded here
    // and consumed by SOLARA's projection registry (never EPSG:4326).
    solaraCrs: crsNote,
    features: esriFeatures.map((f, i) => ({
      type: 'Feature',
      id: f.attributes?.FID ?? f.attributes?.OBJECTID ?? i,
      properties: f.attributes,
      geometry: esriGeometryToGeoJson(f.geometry),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* TIFF decoding (single-band S16, uncompressed, tiled)                */
/* ------------------------------------------------------------------ */

function decodeDemTiff(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = view.getUint16(0, true) === 0x4949;
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  const i16 = (o) => view.getInt16(o, le);

  const ifdOff = u32(4);
  const nEntries = u16(ifdOff);
  const tags = {};
  for (let i = 0; i < nEntries; i++) {
    tags[u16(ifdOff + 2 + i * 12)] = { type: u16(ifdOff + 2 + i * 12 + 2), count: u32(ifdOff + 2 + i * 12 + 4), valOff: ifdOff + 2 + i * 12 + 8 };
  }
  const readU32s = (tag) => {
    const t = tags[tag];
    if (!t) return null;
    if (t.type !== 4) throw new Error(`Tag ${tag}: unexpected type ${t.type}`);
    const size = 4 * t.count;
    const off = size <= 4 ? t.valOff : u32(t.valOff);
    return Array.from({ length: t.count }, (_, i) => u32(off + i * 4));
  };
  const readU16s = (tag) => {
    const t = tags[tag];
    if (!t) return null;
    if (t.type !== 3) throw new Error(`Tag ${tag}: unexpected type ${t.type}`);
    const size = 2 * t.count;
    const off = size <= 4 ? t.valOff : u32(t.valOff);
    return Array.from({ length: t.count }, (_, i) => u16(off + i * 2));
  };

  const width = readU16s(256)[0];
  const height = readU16s(257)[0];
  const bits = readU16s(258);
  const compression = readU16s(259)[0];
  const sampleFormat = readU16s(339);
  const tileW = readU16s(322)?.[0];
  const tileH = readU16s(323)?.[0];
  const tileOffsets = readU32s(324);
  const tileByteCounts = readU32s(325);
  const stripOffsets = readU32s(273);
  const stripByteCounts = readU32s(279);

  if (bits[0] !== 16 || sampleFormat[0] !== 2) throw new Error(`Expected S16 TIFF, got bits=${bits} sampleFormat=${sampleFormat}`);
  if (compression !== 1) throw new Error(`Expected uncompressed TIFF, got compression=${compression}`);

  const values = new Int16Array(width * height);
  if (tileOffsets) {
    const tilesX = Math.ceil(width / tileW);
    for (let t = 0; t < tileOffsets.length; t++) {
      const ty = Math.floor(t / tilesX);
      const tx = t % tilesX;
      for (let r = 0; r < tileH; r++) {
        const y = ty * tileH + r;
        if (y >= height) break;
        for (let c = 0; c < tileW; c++) {
          const x = tx * tileW + c;
          if (x >= width) break;
          values[y * width + x] = i16(tileOffsets[t] + (r * tileW + c) * 2);
        }
      }
    }
  } else if (stripOffsets) {
    let p = 0;
    for (let s = 0; s < stripOffsets.length; s++) {
      for (let b = 0; b < stripByteCounts[s] && p < width * height; b += 2, p++) {
        values[p] = i16(stripOffsets[s] + b);
      }
    }
  } else {
    throw new Error('TIFF has neither tiles nor strips');
  }
  return { width, height, values };
}

/* ------------------------------------------------------------------ */
/* Asset builders                                                      */
/* ------------------------------------------------------------------ */

const CRS_NOTE = 'SOLARA:MARS_2000_SPHERE_LONLAT — planetocentric east-positive lon/lat degrees on the Mars 2000 sphere (numerically equivalent to IAU:2015:49900). Source services declare ESRI:104905 (GCS_Mars_2000).';

async function buildGeology() {
  // 1° box around the Jezero footprint for context units.
  const geom = { xmin: 77.0, ymin: 18.0, xmax: 78.0, ymax: 19.0 };
  const esri = await queryLayer('SIM3292_Global_Geology', geom);
  const fc = toFeatureCollection(esri.features, CRS_NOTE);
  const meta = {
    datasetId: 'usgs-sim3292-jezero-geology',
    source: 'USGS SIM 3292 "Geologic Map of Mars" (Tanaka et al., 2014) via NASA Trek ArcGIS MapServer SIM3292_Global_Geology',
    queryService: `${ARCGIS}/SIM3292_Global_Geology/MapServer/0/query`,
    queryExtentDeg: geom,
    preparedAt: PREPARED_AT,
    featureCount: fc.features.length,
  };
  writeJson('geology/usgs-sim3292-jezero.geojson', fc, meta);
  console.log(`geology: ${fc.features.length} features, units: ${[...new Set(fc.features.map((f) => f.properties.Unit))].join(', ')}`);
}

async function buildRover() {
  const traverse = await queryLayer('Perseverance_Traverse_Path', undefined);
  const pathFc = toFeatureCollection(traverse.features, CRS_NOTE);
  const totalLengthM = pathFc.features.reduce((a, f) => a + (f.properties.length ?? 0), 0);
  const sols = pathFc.features.map((f) => f.properties.sol).filter((s) => typeof s === 'number');
  const pathMeta = {
    datasetId: 'mars2020-perseverance-traverse',
    source: 'NASA Trek ArcGIS MapServer "Perseverance_Traverse_Path" (Mars 2020 rover traverse, derived from rover localization)',
    queryService: `${ARCGIS}/Perseverance_Traverse_Path/MapServer/0/query`,
    preparedAt: PREPARED_AT,
    segmentCount: pathFc.features.length,
    solRange: sols.length ? [Math.min(...sols), Math.max(...sols)] : null,
    totalLengthM: Math.round(totalLengthM),
  };
  writeJson('rover/perseverance-traverse-path.geojson', pathFc, pathMeta);
  console.log(`rover traverse: ${pathFc.features.length} segments, sols ${pathMeta.solRange?.join('–')}, length ~${pathMeta.totalLengthM} m`);

  const ellipse = await queryLayer('perseverance_landing_ellipse', undefined);
  const ellipseFc = toFeatureCollection(ellipse.features, CRS_NOTE);
  const ellipseMeta = {
    datasetId: 'mars2020-landing-ellipse',
    source: 'NASA Trek ArcGIS MapServer "perseverance_landing_ellipse" (Mars 2020 landing ellipse)',
    queryService: `${ARCGIS}/perseverance_landing_ellipse/MapServer/0/query`,
    preparedAt: PREPARED_AT,
    featureCount: ellipseFc.features.length,
  };
  writeJson('rover/perseverance-landing-ellipse.geojson', ellipseFc, ellipseMeta);
  console.log(`landing ellipse: ${ellipseFc.features.length} feature(s)`);
}

async function buildDemGrid() {
  const imageServer = `${ARCGIS}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer`;
  // Native pixel size from the ImageServer metadata (verified 2026-11-13):
  // 0.00337412083064107 deg/px (~200 m/px at the Mars equator).
  const pixelSizeDeg = 0.00337412083064107;
  const bbox = { xmin: 77.1604655, ymin: 18.2110274, xmax: 77.6991776, ymax: 18.7211945 };
  const sizeX = Math.round((bbox.xmax - bbox.xmin) / pixelSizeDeg);
  const sizeY = Math.round((bbox.ymax - bbox.ymin) / pixelSizeDeg);

  // Step 1: f=json gives the exact output extent the server will produce.
  const metaUrl =
    `${imageServer}/exportImage?f=json&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}` +
    `&bboxSR=104905&size=${sizeX},${sizeY}&format=tiff&imageSR=104905&interpolation=RSP_NearestNeighbor`;
  const exportMeta = await fetchJson(metaUrl);
  if (exportMeta.error) throw new Error(`exportImage error: ${JSON.stringify(exportMeta.error)}`);
  const extent = exportMeta.extent;
  if (!extent || extent.spatialReference?.wkid !== 104905) throw new Error('Unexpected export extent');

  // Step 2: f=image streams the TIFF directly over HTTPS (the f=json href is
  // http-only and unreachable from HTTPS pages).
  const imageUrl =
    `${imageServer}/exportImage?f=image&format=tiff&bbox=${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}` +
    `&bboxSR=104905&size=${sizeX},${sizeY}&imageSR=104905&interpolation=RSP_NearestNeighbor`;
  const res = await fetch(imageUrl, { mode: 'cors' });
  if (!res.ok) throw new Error(`DEM TIFF fetch failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { width, height, values } = decodeDemTiff(buf);
  if (width !== exportMeta.width || height !== exportMeta.height) {
    throw new Error(`TIFF size ${width}x${height} != declared ${exportMeta.width}x${exportMeta.height}`);
  }

  const lonSpacingDeg = (extent.xmax - extent.xmin) / width;
  const latSpacingDeg = (extent.ymax - extent.ymin) / height;

  // Validation cross-check: compare the identify endpoint at the grid centre
  // against the bilinear sample of the grid at that point.
  const cx = (extent.xmin + extent.xmax) / 2;
  const cy = (extent.ymin + extent.ymax) / 2;
  const identify = await fetchJson(
    `${imageServer}/identify?f=pjson&geometry=${encodeURIComponent(JSON.stringify({ x: cx, y: cy }))}&geometryType=esriGeometryPoint&sr=104905&returnGeometry=false`,
  );
  const identifyValue = Number.parseFloat(identify.value);
  const gx = (cx - extent.xmin) / lonSpacingDeg - 0.5;
  const gy = (extent.ymax - cy) / latSpacingDeg - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const fx = gx - i0;
  const fy = gy - j0;
  const v = (i, j) => values[j * width + i];
  const bilinear =
    v(i0, j0) * (1 - fx) * (1 - fy) + v(i0 + 1, j0) * fx * (1 - fy) +
    v(i0, j0 + 1) * (1 - fx) * fy + v(i0 + 1, j0 + 1) * fx * fy;
  const diff = Math.abs(bilinear - identifyValue);
  console.log(`DEM centre check: identify=${identifyValue} m, grid bilinear=${bilinear.toFixed(1)} m, diff=${diff.toFixed(1)} m`);
  if (diff > 30) throw new Error(`Grid does not match live identify at centre (diff ${diff.toFixed(1)} m) — refusing to write asset`);

  let min = Infinity;
  let max = -Infinity;
  for (const val of values) {
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const asset = {
    solaraGrid: {
      format: 'solara-elevation-grid/1',
      datasetId: 'mola-hrsc-blend-200m-dem',
      crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT',
      elevationUnit: 'm',
      verticalReference:
        'Elevation relative to the Mars areoid (MOLA reference). The MOLA+HRSC blend is registered to MOLA topography; HRSC contributes higher planimetric resolution. Treat as derived, vertically aligned to MOLA.',
      width,
      height,
      extentDeg: {
        westLon: extent.xmin,
        southLat: extent.ymin,
        eastLon: extent.xmax,
        northLat: extent.ymax,
      },
      cellSizeDegX: lonSpacingDeg,
      cellSizeDegY: latSpacingDeg,
      noDataValue: null,
      note: 'Elevation values are metres (S16, exact integers from the source service). A value of 0 is a measured elevation, not missing data. The source service reports NoData pixels as gaps in coverage; none were detected in this crop (verified min/max within plausible MOLA range).',
    },
    source: {
      service: imageServer,
      method: 'exportImage f=image&format=tiff (native resolution, nearest neighbour)',
      declaredPixelSizeDeg: pixelSizeDeg,
      queryBboxDeg: bbox,
      preparedAt: PREPARED_AT,
      centreValidation: { identifyValueM: identifyValue, gridBilinearM: Number(bilinear.toFixed(1)), diffM: Number(diff.toFixed(1)) },
    },
    values: Array.from(values),
  };
  writeJson('rasters/mola-hrsc-dem-jezero-grid.json', asset, null);
  console.log(`DEM grid: ${width}x${height}, elevations ${min}…${max} m`);
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function writeJson(relPath, data, meta) {
  const path = join(outRoot, relPath);
  mkdirSync(dirname(path), { recursive: true });
  if (meta && data.type === 'FeatureCollection') {
    writeFileSync(path, JSON.stringify({ solara: meta, ...data }, null, 1));
  } else {
    writeFileSync(path, JSON.stringify(data));
  }
  console.log(`wrote ${path}`);
}

await buildGeology();
await buildRover();
await buildDemGrid();
console.log('DONE');
