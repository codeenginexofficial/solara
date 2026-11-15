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
import type TileGrid from 'ol/tilegrid/TileGrid.js';
import type { Extent } from 'ol/extent.js';
import { intersects } from 'ol/extent.js';
import { getMarsEquirectangular, marsBboxToMetresExtent } from '../projections/ProjectionRegistry';
import { buildMetreTileGrid } from '../trek/tileGrid';
import type { TrekWmtsConfig } from '../trek/trekCapabilities';
import type { DatasetRecord } from '../../data/catalog/types';
import type { TileFailureKind } from '../mapTypes';
import { loadCachedImageTile } from '../cache/tileImageLoader';
import { marsTrekTileCachePolicy, type TileCachePolicy } from '../cache/tileCache';

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
  policy: TileCachePolicy,
): (tile: Tile, src: string) => void {
  return (tile: Tile, src: string) => {
    const tileExtent = grid.getTileCoordExtent(tile.getTileCoord());
    if (tileExtent && !intersects(tileExtent, footprint)) {
      tile.setState(TileState.EMPTY);
      return;
    }
    const failWith = (kind: Exclude<TileFailureKind, 'unknown'>) => {
      tileFailureKinds.set(tile, kind);
    };
    loadCachedImageTile(tile, src, policy, failWith);
  };
}

export interface CreatedWmtsLayer {
  layer: TileLayer<WMTS>;
  source: WMTS;
  cachePolicy: TileCachePolicy;
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
  // Some Trek layers declare more tile levels than the tile cache serves
  // (finer levels answer HTTP 404). The catalog records the levels verified
  // to serve imagery (DatasetRecord.verifiedServedLevels); the tile grid is
  // truncated accordingly so the map never requests known-missing levels.
  // OpenLayers then upscales the finest served level at finer zooms.
  const declaredCount = config.matrices.length;
  const servedCount = dataset.verifiedServedLevels;
  const matrices =
    servedCount !== undefined && servedCount < declaredCount
      ? config.matrices.slice(0, servedCount)
      : config.matrices;
  const grid = buildMetreTileGrid({ ...config, matrices });
  // Footprint extent is computed analytically (marsBboxToMetresExtent): the
  // global layers' pole-touching bounding boxes would be silently collapsed
  // if run through proj4 (verified ±90° sign-flip quirk).
  const bbox = config.layer.boundingBox;
  const footprintMetres: Extent = marsBboxToMetresExtent(bbox);

  const cachePolicy = marsTrekTileCachePolicy(dataset.id);
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
    tileLoadFunction: createTrekTileLoadFunction(
      grid.tileGrid,
      footprintMetres,
      cachePolicy,
    ),
    wrapX: false,
    transition: 120,
  });

  const layer = new TileLayer({
    source,
    cacheSize: 96,
    preload: 0,
    properties: { datasetId: dataset.id },
  });

  return {
    layer,
    source,
    cachePolicy,
    resolutions: grid.resolutions,
    worldExtent: grid.worldExtent,
  };
}
