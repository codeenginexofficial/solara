/**
 * Prepared-raster overlay factory.
 *
 * Some verified Trek products are published as ArcGIS dynamic map services
 * (export endpoint), not as WMTS tile pyramids. SOLARA prepares one
 * georeferenced PNG per dataset (see scripts/prepare-jezero-assets.mjs) and
 * renders it as an ol ImageStatic layer, reprojected from geographic
 * lon/lat (SOLARA:MARS_2000_SPHERE_LONLAT) into the working metre CRS.
 *
 * Rasters are categorical (detection pixels), so interpolation is disabled:
 * a stretched pixel would imply coverage that does not exist.
 */

import ImageLayer from 'ol/layer/Image.js';
import ImageStatic from 'ol/source/ImageStatic.js';
import { getMarsGeographic } from '../projections/ProjectionRegistry';
import type { DatasetRecord } from '../../data/catalog/types';

export function createRasterOverlayLayer(dataset: DatasetRecord): ImageLayer<ImageStatic> {
  if (!dataset.preparedAssetUrl) {
    throw new Error(`Raster dataset "${dataset.id}" has no prepared asset URL.`);
  }
  const bb = dataset.boundingBox;
  if (!bb) {
    throw new Error(`Raster dataset "${dataset.id}" has no bounding box for georeferencing.`);
  }
  const source = new ImageStatic({
    url: dataset.preparedAssetUrl,
    projection: getMarsGeographic(),
    imageExtent: [bb.westLon, bb.southLat, bb.eastLon, bb.northLat],
    interpolate: false,
  });
  return new ImageLayer({ source });
}
