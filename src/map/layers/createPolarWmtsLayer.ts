import TileLayer from 'ol/layer/Tile.js';
import WMTS from 'ol/source/WMTS.js';
import WMTSTileGrid from 'ol/tilegrid/WMTS.js';
import TileState from 'ol/TileState.js';
import type Tile from 'ol/Tile.js';
import type { Extent } from 'ol/extent.js';
import { intersects } from 'ol/extent.js';
import type { DatasetRecord } from '../../data/catalog/types';
import {
  MARS_NORTH_POLAR_WMTS_XML,
  MARS_SOUTH_POLAR_WMTS_XML,
} from '../trek/polarCapabilities';
import { getMarsPolar } from '../projections/ProjectionRegistry';
import { loadCachedImageTile } from '../cache/tileImageLoader';
import { marsTrekTileCachePolicy } from '../cache/tileCache';

const WMTS_NS = 'http://www.opengis.net/wmts/1.0';
const OWS_NS = 'http://www.opengis.net/ows/1.1';

interface PolarConfig {
  layerId: string;
  style: string;
  matrixSetId: string;
  template: string;
  tileFormat: string;
  ids: string[];
  origins: Array<[number, number]>;
  sizes: Array<[number, number]>;
  tileSizes: Array<[number, number]>;
  resolutions: number[];
  footprint: Extent;
}

function oneText(parent: Element, ns: string, localName: string): string {
  const value = parent.getElementsByTagNameNS(ns, localName)[0]?.textContent?.trim();
  if (!value) throw new Error(`Polar MOLA capabilities are missing ${localName}.`);
  return value;
}

function parsePolarConfig(xml: string, hemisphere: 'north' | 'south'): PolarConfig {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    throw new Error(`${hemisphere} polar MOLA capabilities XML is malformed.`);
  }
  const layer = document.getElementsByTagNameNS(WMTS_NS, 'Layer')[0];
  const matrixSet = Array.from(document.getElementsByTagNameNS(WMTS_NS, 'TileMatrixSet'))
    .find((candidate) => candidate.getElementsByTagNameNS(WMTS_NS, 'TileMatrix').length > 0);
  if (!layer || !matrixSet) throw new Error(`${hemisphere} polar MOLA capabilities have no layer or matrix set.`);

  const layerId = oneText(layer, OWS_NS, 'Identifier');
  if (!layerId.endsWith(hemisphere === 'north' ? '_np' : '_sp')) {
    throw new Error(`${hemisphere} polar MOLA layer id does not match the expected hemisphere.`);
  }
  const styleElement = Array.from(layer.getElementsByTagNameNS(WMTS_NS, 'Style'))
    .find((candidate) => candidate.getAttribute('isDefault') === 'true')
    ?? layer.getElementsByTagNameNS(WMTS_NS, 'Style')[0];
  if (!styleElement) throw new Error('Polar MOLA layer declares no style.');
  const style = oneText(styleElement, OWS_NS, 'Identifier');
  const matrixSetId = oneText(matrixSet, OWS_NS, 'Identifier');
  const declaredCrs = oneText(matrixSet, OWS_NS, 'SupportedCRS');
  // Trek publishes an invalid EPSG::0 URN for this native planetary CRS. Keep
  // that source declaration explicit; projection parameters come from the
  // documented IAU2000 polar grid (not from EPSG resolution).
  if (declaredCrs !== 'urn:ogc:def:crs:EPSG::0') {
    throw new Error(`Unexpected polar MOLA CRS declaration ${declaredCrs}.`);
  }

  const format = oneText(layer, WMTS_NS, 'Format');
  if (format !== 'image/png') throw new Error(`Unexpected polar MOLA tile format ${format}.`);
  const tileResource = Array.from(layer.getElementsByTagNameNS(WMTS_NS, 'ResourceURL'))
    .find((candidate) => candidate.getAttribute('resourceType') === 'tile');
  const template = tileResource?.getAttribute('template') ?? '';
  if (!template || !['{TileMatrix}', '{TileRow}', '{TileCol}'].every((part) => template.includes(part))) {
    throw new Error('Polar MOLA resource URL is missing WMTS tile placeholders.');
  }

  const bbox = layer.getElementsByTagNameNS(OWS_NS, 'BoundingBox')[0];
  const lower = bbox && oneText(bbox, OWS_NS, 'LowerCorner').split(/\s+/).map(Number);
  const upper = bbox && oneText(bbox, OWS_NS, 'UpperCorner').split(/\s+/).map(Number);
  if (!bbox || !lower || !upper || lower.length < 2 || upper.length < 2 || [...lower, ...upper].some((value) => !Number.isFinite(value))) {
    throw new Error('Polar MOLA layer has an invalid projected bounding box.');
  }
  const footprint: Extent = [lower[0]!, lower[1]!, upper[0]!, upper[1]!];

  const matrixElements = Array.from(matrixSet.getElementsByTagNameNS(WMTS_NS, 'TileMatrix'));
  if (matrixElements.length !== 6) throw new Error(`Expected six verified polar MOLA levels; found ${matrixElements.length}.`);
  const ids: string[] = [];
  const origins: Array<[number, number]> = [];
  const sizes: Array<[number, number]> = [];
  const tileSizes: Array<[number, number]> = [];
  const resolutions: number[] = [];
  let previous: [number, number] | null = null;
  for (const matrix of matrixElements) {
    const id = oneText(matrix, OWS_NS, 'Identifier');
    const topLeft = oneText(matrix, OWS_NS, 'TopLeftCorner').split(/\s+/).map(Number);
    const tileWidth = Number(oneText(matrix, WMTS_NS, 'TileWidth'));
    const tileHeight = Number(oneText(matrix, WMTS_NS, 'TileHeight'));
    const matrixWidth = Number(oneText(matrix, WMTS_NS, 'MatrixWidth'));
    const matrixHeight = Number(oneText(matrix, WMTS_NS, 'MatrixHeight'));
    const scale = Number(oneText(matrix, WMTS_NS, 'ScaleDenominator'));
    if (topLeft.length < 2 || topLeft.some((value) => !Number.isFinite(value)) || tileWidth !== 256 || tileHeight !== 256 || ![matrixWidth, matrixHeight, scale].every(Number.isFinite)) {
      throw new Error(`Polar MOLA matrix ${id} has invalid dimensions or scale metadata.`);
    }
    const size: [number, number] = [matrixWidth, matrixHeight];
    if (previous && (size[0] !== previous[0] * 2 || size[1] !== previous[1] * 2)) {
      throw new Error(`Polar MOLA matrix ${id} does not double the preceding level.`);
    }
    previous = size;
    ids.push(id);
    origins.push([topLeft[0]!, topLeft[1]!]);
    sizes.push(size);
    tileSizes.push([tileWidth, tileHeight]);
    // WMTS standard 0.28 mm pixel; these native polar matrices are metre-based.
    resolutions.push(scale * 0.00028);
  }

  return { layerId, style, matrixSetId, template, tileFormat: format, ids, origins, sizes, tileSizes, resolutions, footprint };
}

export function createPolarWmtsLayer(dataset: DatasetRecord, hemisphere: 'north' | 'south') {
  const config = parsePolarConfig(
    hemisphere === 'north' ? MARS_NORTH_POLAR_WMTS_XML : MARS_SOUTH_POLAR_WMTS_XML,
    hemisphere,
  );
  const tileGrid = new WMTSTileGrid({
    matrixIds: config.ids,
    origins: config.origins,
    resolutions: config.resolutions,
    sizes: config.sizes,
    tileSizes: config.tileSizes,
  });
  const cachePolicy = marsTrekTileCachePolicy(dataset.id);
  const tileLoadFunction = (tile: Tile, src: string) => {
    const extent = tileGrid.getTileCoordExtent(tile.getTileCoord());
    if (extent && !intersects(extent, config.footprint)) {
      tile.setState(TileState.EMPTY);
      return;
    }
    loadCachedImageTile(tile, src, cachePolicy, () => undefined);
  };
  const source = new WMTS({
    requestEncoding: 'REST',
    url: config.template,
    projection: getMarsPolar(hemisphere),
    tileGrid,
    layer: config.layerId,
    matrixSet: config.matrixSetId,
    style: config.style,
    format: config.tileFormat,
    attributions: dataset.attribution,
    tileLoadFunction,
    wrapX: false,
    transition: 120,
  });
  const layer = new TileLayer({
    source,
    cacheSize: 64,
    preload: 0,
    properties: { datasetId: dataset.id },
  });
  return { layer, source, cachePolicy, resolutions: config.resolutions, footprint: config.footprint };
}
