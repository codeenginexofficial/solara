/**
 * WMTS layer factory for verified Trek EQ datasets.
 *
 * Builds an OpenLayers WMTS tile source from a parsed + validated Trek
 * capabilities configuration and a catalog DatasetRecord. The tile grid is
 * in working-projection metres (see map/trek/tileGrid.ts), matching the map
 * view projection exactly, so no tile reprojection is needed.
 *
 * REST request encoding: OpenLayers substitutes {Style} and {TileMatrixSet}
 * from the source options and {TileMatrix} (from the tile grid matrix ids),
 * {TileRow} and {TileCol} from the tile coordinate — so the ResourceURL
 * template is passed through exactly as the service declares it.
 *
 * Tile loading uses a fetch-based loader (the pattern documented by ol) so
 * that HTTP status and response content type can be recorded per tile. The
 * cause is stored in a WeakMap keyed by the tile; MarsMap reads it in the
 * source's 'tileloaderror' event and combines it with the advertised
 * footprint to distinguish expected no-data tiles from genuine failures
 * (see map/mapTypes.ts TileFailureKind). Blob URLs are revoked once the
 * image has finished loading or failed.
 */

import TileLayer from 'ol/layer/Tile.js';
import WMTS from 'ol/source/WMTS.js';
import TileState from 'ol/TileState.js';
import type Tile from 'ol/Tile.js';
import type ImageTile from 'ol/ImageTile.js';
import type TileGrid from 'ol/tilegrid/TileGrid.js';
import type { Extent } from 'ol/extent.js';
import { intersects } from 'ol/extent.js';
import { getMarsEquirectangular, lonLatToMarsMetres } from '../projections/ProjectionRegistry';
import { buildMetreTileGrid } from '../trek/tileGrid';
import type { TrekWmtsConfig } from '../trek/trekCapabilities';
import type { DatasetRecord } from '../../data/catalog/types';
import type { TileFailureKind } from '../mapTypes';

/**
 * Failure cause per tile object (ol Tile is not a BaseObject, so a per-tile
 * property cannot be used; a WeakMap keeps entries alive only as long as the
 * tile itself).
 */
const tileFailureKinds = new WeakMap<Tile, TileFailureKind>();

/** Read the recorded failure cause for a tile (undefined when not recorded). */
export function getTrekTileFailureKind(tile: Tile): TileFailureKind | undefined {
  return tileFailureKinds.get(tile);
}

/**
 * Fetch-based tile loader (ol's documented fetch/blob pattern).
 * Records the failure kind, then puts the tile into the error state via
 * tile.setState so the source dispatches its normal 'tileloaderror' event.
 * Successful responses are decoded from a blob URL (CORS is satisfied by the
 * fetch; blob URLs are same-origin, so the map canvas stays untainted).
 *
 * Tiles fully outside the advertised mosaic footprint are marked EMPTY
 * before any request is made: the verified Trek service answers 404 for
 * them WITHOUT an Access-Control-Allow-Origin header, so every such request
 * is CORS-rejected by the browser and logs console errors. Not requesting
 * those tiles at all keeps the console clean and the no-data regions
 * visually quiet (verified Trek behaviour, 2026-11-12).
 */
export function createTrekTileLoadFunction(
  grid: TileGrid,
  footprint: Extent,
): (tile: Tile, src: string) => void {
  return (tile: Tile, src: string) => {
    const tileExtent = grid.getTileCoordExtent(tile.getTileCoord());
    if (tileExtent && !intersects(tileExtent, footprint)) {
      tile.setState(TileState.EMPTY);
      return;
    }
    const imageTile = tile as ImageTile;
    const element = imageTile.getImage();
    const failWith = (kind: Exclude<TileFailureKind, 'unknown'>) => {
      tileFailureKinds.set(tile, kind);
      tile.setState(TileState.ERROR);
    };
    // Only the plain-image path is supported here: Trek tiles are
    // HTMLImageElements (the OffscreenCanvas branch does not apply in the
    // browser build this loader runs in).
    if (!(element instanceof HTMLImageElement)) {
      failWith('invalid-response');
      return;
    }
    void fetch(src, { mode: 'cors' })
      .then((response) => {
        if (!response.ok) {
          failWith(
            response.status === 404
              ? 'http-404'
              : response.status >= 500
                ? 'http-server'
                : 'http-other',
          );
          return;
        }
        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        if (!contentType.startsWith('image/')) {
          failWith('invalid-response');
          return;
        }
        return response.blob().then((blob) => {
          const url = URL.createObjectURL(blob);
          element.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
          element.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
          element.src = url;
        });
      })
      .catch(() => {
        failWith('network-error');
      });
  };
}

export interface CreatedWmtsLayer {
  layer: TileLayer<WMTS>;
  source: WMTS;
  /** Resolutions in metres/pixel for view configuration. */
  resolutions: number[];
  /** Full world extent in working-projection metres. */
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
  const bbox = config.layer.boundingBox;
  const [x0, y0] = lonLatToMarsMetres(bbox.westLon, bbox.southLat);
  const [x1, y1] = lonLatToMarsMetres(bbox.eastLon, bbox.northLat);
  const footprintMetres: Extent = [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
  ];

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
    tileLoadFunction: createTrekTileLoadFunction(grid.tileGrid, footprintMetres),
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
