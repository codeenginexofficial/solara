import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import TileState from 'ol/TileState.js';
import type Tile from 'ol/Tile.js';
import { intersects } from 'ol/extent.js';
import type { Extent } from 'ol/extent.js';
import { GLOBAL_CTX_MOSAIC_DATASET } from '../../data/catalog/datasets';
import { getMarsGeographic, ensureMarsProjectionsRegistered } from '../projections/ProjectionRegistry';
import { MARS_GLOBAL_CTX_TILE_CACHE_POLICY } from '../cache/tileCache';
import { loadCachedImageTile } from '../cache/tileImageLoader';

// Copied from the hosted ArcGIS MapServer tileInfo (WKID 104971): geographic
// origin (-180, 90), 512px tiles, two-by-one level zero, 2x matrix growth.
// At level 12 the equatorial sample interval is about 5.087m/px.
const TILE_EXTENT: Extent = [-180, -90, 180, 90];
const TILE_ORIGIN: [number, number] = [-180, 90];
const RESOLUTIONS = Array.from({ length: 13 }, (_, z) => 0.3515625 / 2 ** z);
const MATRIX_SIZES = RESOLUTIONS.map((_, z): [number, number] => [2 ** (z + 1), 2 ** z]);
const DECLARED_COVERAGE: Extent = [-180, -88, 180, 88];

function cacheOnlyDeclaredCoverage(tile: Tile, src: string, grid: TileGrid): void {
  const extent = grid.getTileCoordExtent(tile.getTileCoord());
  if (extent && !intersects(extent, DECLARED_COVERAGE)) {
    tile.setState(TileState.EMPTY);
    return;
  }
  loadCachedImageTile(tile, src, MARS_GLOBAL_CTX_TILE_CACHE_POLICY, () => undefined);
}

export function createGlobalCtxLayer() {
  ensureMarsProjectionsRegistered();
  const grid = new TileGrid({
    extent: TILE_EXTENT,
    origin: TILE_ORIGIN,
    resolutions: RESOLUTIONS,
    tileSize: 512,
    sizes: MATRIX_SIZES,
  });
  const template = GLOBAL_CTX_MOSAIC_DATASET.assetUrl;
  if (!template) throw new Error('Global CTX dataset is missing its tile endpoint.');
  const source = new XYZ({
    url: template,
    projection: getMarsGeographic(),
    tileGrid: grid,
    attributions: GLOBAL_CTX_MOSAIC_DATASET.attribution,
    crossOrigin: 'anonymous',
    wrapX: false,
    minZoom: 0,
    maxZoom: 12,
    transition: 120,
    tileLoadFunction: (tile, src) => cacheOnlyDeclaredCoverage(tile, src, grid),
  });
  const layer = new TileLayer({
    source,
    cacheSize: 96,
    preload: 0,
    properties: { datasetId: GLOBAL_CTX_MOSAIC_DATASET.id },
  });
  return {
    layer,
    source,
    cachePolicy: MARS_GLOBAL_CTX_TILE_CACHE_POLICY,
    resolutionsMpp: RESOLUTIONS.map((resolution) => resolution * 59_274.7),
  };
}
