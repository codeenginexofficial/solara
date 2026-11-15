/** Build the cached, global Viking image layer from its published ArcGIS grid. */

import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import type { Extent } from 'ol/extent.js';
import { get as getProjection } from 'ol/proj.js';
import { VIKING_GLOBAL_MOSAIC_DATASET } from '../../data/catalog/datasets';
import { MARS_VIKING_MARSECO0 } from '../../lib/marsCrs';
import { marsBboxToMetresExtent } from '../projections/ProjectionRegistry';
import { loadCachedImageTile } from '../cache/tileImageLoader';
import { MARS_VIKING_TILE_CACHE_POLICY } from '../cache/tileCache';

// Values are copied from the MapServer TileInfo metadata. The image cache has
// 256 px tiles, origin (-10669445.5542, 10669445.5542), and LODs 0–8.
const TILE_ORIGIN: [number, number] = [-10_669_445.5542, 10_669_445.5542];
const TILE_EXTENT: Extent = [-10_669_445.5542, -5_334_722.2771, 10_669_445.5542, 5_334_722.2771];
const TILE_RESOLUTIONS = [
  83_355.0433921,
  41_677.5216961,
  20_838.760848,
  10_419.380424,
  5_209.69021201,
  2_604.845106,
  1_302.422553,
  651.211276501,
  325.605638251,
];

export function createVikingGlobalLayer() {
  const sourceProjection = getProjection(MARS_VIKING_MARSECO0);
  if (!sourceProjection) throw new Error('The Viking mosaic source CRS is not registered.');
  const tileTemplate = VIKING_GLOBAL_MOSAIC_DATASET.assetUrl;
  if (!tileTemplate) throw new Error('The Viking mosaic tile URL is missing from the dataset catalog.');
  const grid = new TileGrid({
    extent: TILE_EXTENT,
    origin: TILE_ORIGIN,
    resolutions: TILE_RESOLUTIONS,
    tileSize: 256,
  });
  const source = new XYZ({
    url: tileTemplate,
    projection: sourceProjection,
    tileGrid: grid,
    attributions: VIKING_GLOBAL_MOSAIC_DATASET.attribution,
    crossOrigin: 'anonymous',
    wrapX: false,
    maxZoom: TILE_RESOLUTIONS.length - 1,
    tileLoadFunction: (tile, src) =>
      loadCachedImageTile(tile, src, MARS_VIKING_TILE_CACHE_POLICY, () => undefined),
  });
  const layer = new TileLayer({
    source,
    extent: marsBboxToMetresExtent(VIKING_GLOBAL_MOSAIC_DATASET.boundingBox!),
    cacheSize: 96,
    preload: 0,
    zIndex: 0,
  });
  layer.setProperties({ datasetId: VIKING_GLOBAL_MOSAIC_DATASET.id });

  // TileImage reads the source CRS and reprojects into MarsMap's current
  // verified Mars-sphere view projection.
  return { layer, source, cachePolicy: MARS_VIKING_TILE_CACHE_POLICY };
}
