/**
 * SOLARA dataset catalog — Milestone 0.
 *
 * Contains exactly one dataset: the NASA Trek Jezero CTX mosaic WMTS layer,
 * whose capabilities document, tile responses, CORS behaviour, footprint
 * alignment, and browser rendering have been verified on 2026-11-12.
 *
 * Every value below is either (a) read from the live WMTS capabilities
 * document, or (b) explicitly marked as a limitation because the source does
 * not publish it. No value has been invented.
 *
 * Verification evidence (2026-11-12, recorded during integration):
 *  - WMTSCapabilities.xml: HTTP 200, application/xml.
 *  - Tiles: HTTP 200, image/png, 256x256 at levels 5 / 12 / 13 inside the
 *    advertised footprint; HTTP 404 outside it.
 *  - CORS: Access-Control-Allow-Origin: * on capabilities and tiles.
 *  - Footprint: mosaic edge pixels at levels 8/12 match the advertised
 *    bounding box on all four sides (west 77.1604655, north 18.7211945,
 *    east 77.6991776, south 18.2110274 in lon/lat degrees).
 *  - High-zoom tile at the Perseverance "Octavia E. Butler" landing site
 *    area (18.4447N, 77.4508E) shows controlled-mosaic terrain content.
 *
 * CRS authority investigation (2026-11-12, Milestone 0.1) — see
 * map/projections/ProjectionRegistry.ts and Architecture.md §6:
 *  - Trek declares urn:ogc:def:crs:EPSG::104905, but the official EPSG
 *    registry has no CRS 104905, and under the ESRI authority code 104905
 *    denotes the geographic "Mars 2000" CRS (GCS_Mars_2000) — not the
 *    projected CRS this layer is served in.
 *  - The served projection was verified numerically as equirectangular on
 *    the Mars sphere (R = 3,396,190 m), equivalent to IAU:2015:49910
 *    ("Mars (2015) - Sphere / Equirectangular, clon = 0"). SOLARA renders
 *    with the internal id SOLARA:MARS_EQC_IAU2015.
 */

import type { DatasetRecord, RegionRecord } from './types';

export const TREK_CAPABILITIES_URL =
  'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml';

export const JEZERO_CTX_DATASET: DatasetRecord = {
  id: 'jezero-ctx-mosaic-soc-008',
  title: 'Jezero Crater CTX Orthorectified Mosaic',
  provider: 'NASA Trek (trek.nasa.gov)',
  mission: 'Mars Reconnaissance Orbiter (MRO)',
  instrument: 'CTX — Context Camera',
  productId: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
  kind: 'optical',
  description:
    'Controlled, orthorectified CTX image mosaic covering the Jezero Crater ' +
    'exploration area, served by NASA Trek as a RESTful WMTS 1.0.0 layer ' +
    '(OGC conformance). Used as the optical/context base layer.',
  sourceUrl: TREK_CAPABILITIES_URL,
  accessMethod: 'wmts',
  assetUrl:
    'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0//default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.png',
  spatialReference: {
    body: 'Mars',
    authority:
      'Declared by Trek as urn:ogc:def:crs:EPSG::104905. That URN does not resolve under the ' +
      'EPSG authority (the EPSG registry has no CRS 104905; ESRI:104905 denotes the geographic ' +
      'Mars 2000 CRS). The served projection is numerically equivalent to IAU:2015:49910 ' +
      '(Mars (2015) - Sphere / Equirectangular, clon = 0); SOLARA renders with the internal id ' +
      'SOLARA:MARS_EQC_IAU2015.',
    proj4:
      '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs',
    datum: 'Mars sphere, R = 3,396,190 m (IAU 2015; anchor: Viking 1 lander, 47.95137°W)',
    coordinateSystem:
      'Equirectangular (Equidistant Cylindrical, EPSG method 1028), standard parallel 0°, central meridian 0°, false easting/northing 0, projected units metres',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees (geographic lon/lat), metres (projected working projection)',
    sourceDefinition:
      'urn:ogc:def:crs:EPSG::104905 — declared verbatim by Trek (SupportedCRS and Layer BoundingBox). Preserved as source metadata; SOLARA does not use it as its working projection id.',
  },
  coverageDescription:
    'lon 77.1604655°E – 77.6991776°E, lat 18.2110274°N – 18.7211945°N ' +
    '(WMTS BoundingBox; footprint verified against actual tile imagery at all four edges).',
  boundingBox: {
    westLon: 77.1604655,
    eastLon: 77.6991776,
    southLat: 18.2110274,
    northLat: 18.7211945,
  },
  spatialResolution: 5.087,
  resolutionUnit:
    'm/pixel at tile level 13 (finest served level). Product identifier states a nominal 6 m CTX imaging scale; exact mosaic production resolution is not stated in the service metadata.',
  attribution:
    'Imagery: NASA / JPL-Caltech / MSSS (MRO CTX). Service: NASA Trek (trek.nasa.gov).',
  limitations: [
    'The tile matrix "ScaleDenominator" values in the Trek capabilities document are not consistent with the Mars sphere (they imply ~111,268 m per degree of longitude). SOLARA derives tile resolutions from the verified matrix geometry (matrix dimensions × Mars sphere circumference) instead of trusting those values.',
    'The tile grid is a plate carrée (degree-based) grid: east–west ground distance at Jezero (~18.4°N) is ~5.1% smaller than the map projection scale. True scale applies only at the equator.',
    'Tiles fully outside the mosaic footprint return HTTP 404; smaller gaps can also exist inside the advertised bounding box.',
    'The mosaic production institution and the acquisition dates of the component CTX images are not stated in the WMTS service metadata.',
    'This is historical imagery: it shows the surface as the component CTX images captured it, not necessarily current conditions.',
    'Optical imagery only. No elevation, slope, geology, rover, or environmental datasets are integrated in this milestone, and no terrain hazard assessment is performed.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-12',
};

export const JEZERO_REGION: RegionRecord = {
  id: 'jezero-crater-west',
  name: 'Jezero Crater (western fan area)',
  body: 'Mars',
  description:
    'Initial detailed exploration region: the CTX-controlled mosaic extent ' +
    'inside Jezero Crater, spanning the western crater rim, the delta landforms, ' +
    'and the western Nili Planum margin. The 2020 Mars Perseverance rover ' +
    '"Octavia E. Butler" landing site (18.4447°N, 77.4508°E) lies inside this extent.',
  boundingBox: {
    westLon: 77.1604655,
    eastLon: 77.6991776,
    southLat: 18.2110274,
    northLat: 18.7211945,
  },
  datasetIds: [JEZERO_CTX_DATASET.id],
};

const DATASETS: readonly DatasetRecord[] = [JEZERO_CTX_DATASET];

const REGIONS: readonly RegionRecord[] = [JEZERO_REGION];

export function getAllDatasets(): readonly DatasetRecord[] {
  return DATASETS;
}

export function getDatasetById(id: string): DatasetRecord | undefined {
  return DATASETS.find((d) => d.id === id);
}

export function getAllRegions(): readonly RegionRecord[] {
  return REGIONS;
}
