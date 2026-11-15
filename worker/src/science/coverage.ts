/**
 * Dataset coverage service: declares which catalog datasets claim the
 * requested point — and, just as importantly, what that claim means.
 *
 * A bounding box is a metadata extent, NOT proof that valid pixels exist at
 * the point (Trek WMTS layers have internal gaps and 404 outside the real
 * footprint; prepared assets are regional; rover products are paths and
 * ellipses; MEDA observations are in-situ). The tool therefore reports
 * `within_declared_extent | outside_declared_extent | extent_unknown` and an
 * explicit per-dataset note. It never claims "data available here".
 *
 * Coordinates are east-positive planetocentric degrees (D-006 / SOLARA CRS
 * conventions), matching the catalog's bounding boxes.
 */

import {
  getAllDatasets,
  getAllRegions,
  MARS2020_MEDA_DATASET,
  MOLA_HRSC_BLEND_DEM_DATASET,
  PERSEVERANCE_TRAVERSE_DATASET,
} from '../../../src/data/catalog/datasets';
import type { DatasetRecord } from '../../../src/data/catalog/types';
import { isInsideBoundingBox } from '../../../src/lib/bbox';
import type {
  CoverageExtentStatus,
  DatasetAvailability,
  DatasetCoverageEntry,
  DatasetCoverageResult,
  MarsPlanetocentricPoint,
} from './contracts';

function availabilityOf(dataset: DatasetRecord): DatasetAvailability {
  if (dataset.queryEndpoint) return 'live_query_service';
  if (dataset.preparedAssetUrl) return 'prepared_asset';
  if (dataset.accessMethod === 'wmts' || dataset.accessMethod === 'xyz') return 'live_tile_service';
  return 'catalog_only';
}

function spatialResolutionOf(dataset: DatasetRecord): string | null {
  if (typeof dataset.spatialResolution !== 'number' || !Number.isFinite(dataset.spatialResolution)) {
    return null;
  }
  const unit = dataset.resolutionUnit?.trim();
  return unit ? `${dataset.spatialResolution} ${unit}` : String(dataset.spatialResolution);
}

function observationPeriodOf(dataset: DatasetRecord): string | null {
  if (dataset.observationPeriod) return dataset.observationPeriod;
  if (dataset.observationStart || dataset.observationEnd) {
    return `${dataset.observationStart ?? 'unknown'} – ${dataset.observationEnd ?? 'unknown'}`;
  }
  return null;
}

function isGlobalExtent(dataset: DatasetRecord): boolean {
  const bbox = dataset.boundingBox;
  return Boolean(
    bbox &&
      bbox.westLon <= -180 &&
      bbox.eastLon >= 179.9 &&
      bbox.southLat <= -89.9 &&
      bbox.northLat >= 89.9,
  );
}

function extentNoteOf(dataset: DatasetRecord): string {
  if (!dataset.boundingBox) {
    return 'The catalog records no bounding box for this product; spatial membership is unknown here and is not inferred.';
  }
  if (dataset.id === PERSEVERANCE_TRAVERSE_DATASET.id) {
    return 'Bounding box of the historical rover traverse path — it encloses the path line, not full-area coverage. A point inside the box may be far from any track point.';
  }
  if (dataset.id === MARS2020_MEDA_DATASET.id) {
    return 'In-situ rover observations: the bounding box encloses ground the rover traversed. It is not an observed area, and the published rows do not carry a position for each measurement.';
  }
  if (dataset.id === MOLA_HRSC_BLEND_DEM_DATASET.id) {
    return 'Declared global query extent for point elevation. The prepared route grid is only a regional Jezero crop; this is extent membership, not a pixel-level value guarantee.';
  }
  if (dataset.kind === 'topography' || isGlobalExtent(dataset)) {
    return 'Declared global extent. Extent membership does not guarantee a valid (non-NoData) pixel at this point.';
  }
  return 'Declared product extent (bounding box). Extent membership does not prove that imagery/data exist at every point; gaps can occur inside an advertised footprint.';
}

function evaluateDataset(
  dataset: DatasetRecord,
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
): DatasetCoverageEntry {
  let extentStatus: CoverageExtentStatus = 'extent_unknown';
  if (dataset.boundingBox) {
    extentStatus = isInsideBoundingBox(
      { lon: longitudeEastDeg, lat: latitudePlanetocentricDeg },
      dataset.boundingBox,
    )
      ? 'within_declared_extent'
      : 'outside_declared_extent';
  }

  return {
    datasetId: dataset.id,
    title: dataset.title,
    kind: dataset.kind,
    verification: dataset.verification,
    lastVerifiedAt: dataset.lastVerifiedAt ?? null,
    availability: availabilityOf(dataset),
    extentStatus,
    boundingBox: dataset.boundingBox
      ? {
          westLon: dataset.boundingBox.westLon,
          eastLon: dataset.boundingBox.eastLon,
          southLat: dataset.boundingBox.southLat,
          northLat: dataset.boundingBox.northLat,
        }
      : null,
    extentNote: extentNoteOf(dataset),
    spatialResolution: spatialResolutionOf(dataset),
    units: dataset.units ?? null,
    observationPeriod: observationPeriodOf(dataset),
    sourceUrl: dataset.sourceUrl,
    limitations: [...dataset.limitations],
  };
}

/** `get_dataset_coverage` service. */
export function getDatasetCoverage(
  longitudeEastDeg: number,
  latitudePlanetocentricDeg: number,
): DatasetCoverageResult {
  const location: MarsPlanetocentricPoint = {
    longitudeEastDeg,
    latitudePlanetocentricDeg,
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    crsId: 'SOLARA:MARS_2000_SPHERE_LONLAT',
  };

  const region =
    getAllRegions().find((candidate) =>
      isInsideBoundingBox(
        { lon: longitudeEastDeg, lat: latitudePlanetocentricDeg },
        candidate.boundingBox,
      ),
    ) ?? null;

  return {
    tool: 'get_dataset_coverage',
    location,
    region: region
      ? {
          id: region.id,
          name: region.name,
          boundingBox: { ...region.boundingBox },
        }
      : null,
    datasets: getAllDatasets().map((dataset) =>
      evaluateDataset(dataset, longitudeEastDeg, latitudePlanetocentricDeg),
    ),
    notes: [
      'Coverage status reflects the catalog-declared bounding box only; it is not a promise of valid data at the point.',
      'Coordinates are east-positive planetocentric degrees (Mars 2000 sphere, R = 3,396,190 m), not Earth WGS84.',
      'Rover entries are historical products (traverse path, landing ellipse); SOLARA has no live rover-position feed.',
      'MEDA entries describe in-situ measurements at the rover, never weather at the requested map coordinate.',
    ],
  };
}
