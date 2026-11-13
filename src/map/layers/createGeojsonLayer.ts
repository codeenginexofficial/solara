/**
 * GeoJSON overlay layer factory for prepared SOLARA datasets.
 *
 * Prepared assets (public/data/mars/...) are static GeoJSON files produced
 * by scripts/prepare-jezero-assets.mjs from verified Trek map-service
 * queries (esri JSON -> GeoJSON, see the script for provenance). Coordinates
 * are geographic lon/lat degrees on the Mars 2000 sphere
 * (SOLARA:MARS_2000_SPHERE_LONLAT); they are transformed to the working
 * metre projection (SOLARA:MARS_EQC_IAU2015) at parse time by OpenLayers.
 *
 * Styling is per dataset kind and deliberately simple:
 *  - geology:  translucent unit fills keyed by the USGS unit code
 *              (mNhm / HNt in the verified Jezero extent), thin outline.
 *  - rover:    solid cyan polyline for the historical traverse, dashed
 *              outline for the landing ellipse (historical context).
 */

import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import type { FeatureLike } from 'ol/Feature.js';
import { getMarsEquirectangular, getMarsGeographic } from '../projections/ProjectionRegistry';
import type { DatasetRecord } from '../../data/catalog/types';

/** Verified USGS SIM 3292 unit colours for the Jezero extent (muted, dark-
 *  UI friendly). Unknown unit codes fall back to a neutral fill — the legend
 *  in DatasetPanel lists the verified codes. */
const GEOLOGY_UNIT_STYLE: Readonly<Record<string, { fill: string; stroke: string }>> = {
  mNhm: { fill: 'rgba(164, 122, 84, 0.30)', stroke: 'rgba(214, 174, 128, 0.9)' },
  HNt: { fill: 'rgba(104, 122, 168, 0.30)', stroke: 'rgba(158, 178, 224, 0.9)' },
};

const GEOLOGY_FALLBACK_STYLE = { fill: 'rgba(140, 140, 140, 0.30)', stroke: 'rgba(190, 190, 190, 0.9)' };

/** Style function for geology polygons: unit-coloured fill + unit-code label. */
function geologyStyleFunction(feature: FeatureLike): Style {
  const unit = String(feature.get('unit') ?? '');
  const colors = GEOLOGY_UNIT_STYLE[unit] ?? GEOLOGY_FALLBACK_STYLE;
  return new Style({
    fill: new Fill({ color: colors.fill }),
    stroke: new Stroke({ color: colors.stroke, width: 1.5 }),
    text:
      unit
        ? new Text({
            text: unit,
            font: '600 11px ui-monospace, monospace',
            fill: new Fill({ color: colors.stroke }),
            stroke: new Stroke({ color: 'rgba(8, 12, 18, 0.85)', width: 3 }),
            overflow: true,
          })
        : undefined,
  });
}

function roverPathStyle(): Style {
  return new Style({
    stroke: new Stroke({ color: 'rgba(96, 220, 255, 0.9)', width: 2 }),
  });
}

function landingEllipseStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(255, 205, 96, 0.9)',
      width: 1.5,
      lineDash: [6, 5],
    }),
    fill: new Fill({ color: 'rgba(255, 205, 96, 0.06)' }),
  });
}

export interface CreatedGeojsonLayer {
  layer: VectorLayer<VectorSource>;
  source: VectorSource;
}

/**
 * Create a vector overlay from a fetched GeoJSON FeatureCollection for a
 * prepared catalog dataset. Throws when the asset does not look like a
 * FeatureCollection so mis-declared data is never rendered silently.
 */
export function createGeojsonOverlayLayer(
  geojson: unknown,
  dataset: DatasetRecord,
): CreatedGeojsonLayer {
  if (
    typeof geojson !== 'object' ||
    geojson === null ||
    (geojson as { type?: unknown }).type !== 'FeatureCollection' ||
    !Array.isArray((geojson as { features?: unknown }).features)
  ) {
    throw new Error(
      `Dataset "${dataset.id}": prepared asset is not a GeoJSON FeatureCollection.`,
    );
  }

  const source = new VectorSource({
    features: new GeoJSON().readFeatures(geojson, {
      dataProjection: getMarsGeographic(),
      featureProjection: getMarsEquirectangular(),
    }),
    attributions: dataset.attribution,
  });

  let layer: VectorLayer<VectorSource>;
  switch (dataset.kind) {
    case 'geology':
      layer = new VectorLayer({
        source,
        style: geologyStyleFunction,
      });
      break;
    case 'rover':
      layer = new VectorLayer({
        source,
        style:
          dataset.id === 'mars2020-landing-ellipse'
            ? landingEllipseStyle()
            : roverPathStyle(),
      });
      break;
    default:
      throw new Error(
        `Dataset "${dataset.id}": kind "${dataset.kind}" has no GeoJSON overlay style.`,
      );
  }

  layer.set('datasetId', dataset.id);
  return { layer, source };
}
