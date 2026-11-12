/**
 * WMTS layer factory for verified Trek EQ datasets.
 *
 * Builds an OpenLayers WMTS tile source from a parsed + validated Trek
 * capabilities configuration and a catalog DatasetRecord. The tile grid is
 * in EPSG:104905 metres (see map/trek/tileGrid.ts), matching the map view
 * projection exactly, so no tile reprojection is needed.
 *
 * REST request encoding: OpenLayers substitutes {Style} and {TileMatrixSet}
 * from the source options and {TileMatrix} (from the tile grid matrix ids),
 * {TileRow} and {TileCol} from the tile coordinate — so the ResourceURL
 * template is passed through exactly as the service declares it.
 */

import TileLayer from 'ol/layer/Tile.js';
import WMTS from 'ol/source/WMTS.js';
import type { TileSourceEvent } from 'ol/source/Tile.js';
import { getMarsEquirectangular } from '../projections/ProjectionRegistry';
import { buildMetreTileGrid } from '../trek/tileGrid';
import type { TrekWmtsConfig } from '../trek/trekCapabilities';
import type { DatasetRecord } from '../../data/catalog/types';

export interface CreatedWmtsLayer {
  layer: TileLayer<WMTS>;
  source: WMTS;
  /** Resolutions in metres/pixel for view configuration. */
  resolutions: number[];
  /** Full world extent in EPSG:104905 metres. */
  worldExtent: [number, number, number, number];
}

/**
 * Create the WMTS tile layer for a verified Trek EQ dataset.
 *
 * @param config   parsed and validated Trek capabilities configuration
 * @param dataset  catalog record supplying attribution and identity
 */
export function createTrekWmtsLayer(
  config: TrekWmtsConfig,
  dataset: DatasetRecord,
): CreatedWmtsLayer {
  const grid = buildMetreTileGrid(config);

  const source = new WMTS({
    requestEncoding: 'REST',
    url: config.layer.resourceUrlTemplate,
    projection: getMarsEquirectangular(),
    tileGrid: grid.tileGrid,
    layer: config.layer.identifier,
    matrixSet: config.layer.tileMatrixSetIdentifier,
    style: config.layer.styleIdentifier,
    format: config.layer.format,
    attributions: dataset.attribution,
    crossOrigin: 'anonymous',
    wrapX: false,
    transition: 120,
  });

  const layer = new TileLayer({
    source,
    properties: { datasetId: dataset.id },
  });

  return {
    layer,
    source,
    resolutions: grid.resolutions,
    worldExtent: grid.worldExtent,
  };
}

/** Re-export for consumers that type tile event handlers. */
export type { TileSourceEvent };
