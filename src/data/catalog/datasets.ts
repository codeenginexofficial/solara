/**
 * SOLARA dataset catalog — Milestone 0/0.2.
 *
 * Every record below was verified against its live source before its status
 * was set. Verification evidence is recorded per record. No value is
 * invented: anything the source does not publish is listed as a limitation.
 *
 * Live-verification evidence summary (2026-11-13):
 *  - jezero-ctx-mosaic-soc-008 (WMTS): verified 2026-11-12 (Milestone 0.1).
 *  - mola-hrsc-blend-200m-colorshade (WMTS): capabilities HTTP 200; tiles
 *    HTTP 200 image/jpeg at levels 0/7/8; the verified snapshot declares only
 *    tile levels 0–8 (verified-served-levels = 9); CORS reflection confirmed.
 *  - Mars_MOLA_blend200ppx_HRSC_DEM... (ImageServer): metadata HTTP 200
 *    (S16, global, ~200 m/px declared pixel size 0.0033741°/px); identify
 *    HTTP 200 at the Jezero check point (77.42982°E, 18.46611°N) → −2520 m
 *    (consistent with the MOLA 463 m global DEM: −2524 m); exportImage
 *    f=image&format=tiff HTTP 200 over HTTPS; prepared grid asset
 *    cross-validated against live identify (diff 10.5 m at centre, bilinear
 *    vs nearest-neighbour cell sampling).
 *  - SIM3292_Global_Geology (MapServer): query HTTP 200, 2 units intersect
 *    the Jezero footprint + 1° context box (mNhm, HNt).
 *  - Perseverance_Traverse_Path (MapServer): query HTTP 200, 332 segments,
 *    sols 14–1176, total length ≈ 27.2 km; starts at the Octavia E. Butler
 *    landing site (77.452°E, 18.4448°N).
 *  - perseverance_landing_ellipse (MapServer): query HTTP 200, 1 polygon.
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

export const TREK_MOLA_200M_CAPABILITIES_URL =
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml';

export const VIKING_ARCGIS_MOSAIC_SERVICE_URL =
  'https://tiles.arcgis.com/tiles/lqRTrQp2HrfnJt8U/arcgis/rest/services/mars_viking_mosaic/MapServer';

export const TREK_ARCGIS_SERVICES = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';

/** Dataset id shared with the map's feature hit-testing. */
export const SCIENCE_STOPS_DATASET_ID = 'mars2020-science-stops';
export const IAU_NOMENCLATURE_DATASET_ID = 'jezero-iau-nomenclature';

/* ------------------------------------------------------------------ */
/* Shared CRS descriptions                                             */
/* ------------------------------------------------------------------ */

const MARS_SPHERE_AUTHORITY =
  'Declared by Trek as urn:ogc:def:crs:EPSG::104905. That URN does not resolve under the ' +
  'EPSG authority (the EPSG registry has no CRS 104905; ESRI:104905 denotes the geographic ' +
  'Mars 2000 CRS). The served projection is numerically equivalent to IAU:2015:49910 ' +
  '(Mars (2015) - Sphere / Equirectangular, clon = 0); SOLARA renders with the internal id ' +
  'SOLARA:MARS_EQC_IAU2015.';

const MARS_SPHERE_DATUM =
  'Mars sphere, R = 3,396,190 m (IAU 2015; anchor: Viking 1 lander, 47.95137°W)';

const EQC_COORD_SYSTEM =
  'Equirectangular (Equidistant Cylindrical, EPSG method 1028), standard parallel 0°, central meridian 0°, false easting/northing 0, projected units metres';

const GEOGRAPHIC_AUTHORITY =
  'Declared by Trek as urn:ogc:def:crs:EPSG::104905; that code exists only under the ESRI ' +
  'authority as ESRI:104905 "Mars 2000" (GCS_Mars_2000) — a geographic CRS on the Mars 2000 ' +
  'sphere/ellipsoid. Numerically the coordinates are east-positive planetocentric degrees on ' +
  'the Mars 2000 sphere; SOLARA records them with the internal id ' +
  'SOLARA:MARS_2000_SPHERE_LONLAT (equivalent to IAU:2015:49900).';

/* ------------------------------------------------------------------ */
/* 1. Optical — Jezero CTX mosaic (Milestone 0.1, verified)            */
/* ------------------------------------------------------------------ */

export const VIKING_GLOBAL_MOSAIC_DATASET: DatasetRecord = {
  id: 'mars-viking-mdim21-colorized-global',
  title: 'Viking MDIM 2.1 Colorized Global Mosaic',
  provider: 'NASA Ames / USGS Astrogeology Science Center; cached tiles hosted by Esri',
  mission: 'Viking orbiters',
  instrument: 'Viking imaging cameras',
  productId: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
  kind: 'optical',
  description:
    'Global historical Mars color mosaic from Viking imagery, blended over the USGS MDIM 2.1 grayscale mosaic. Used as low-resolution optical context beneath the detailed Jezero CTX layer.',
  sourceUrl: VIKING_ARCGIS_MOSAIC_SERVICE_URL,
  accessMethod: 'xyz',
  assetUrl: `${VIKING_ARCGIS_MOSAIC_SERVICE_URL}/tile/{z}/{y}/{x}`,
  spatialReference: {
    body: 'Mars',
    authority:
      'Esri MapServer publishes custom projected CRS MarsEC0 over GCS_Mars_2000 (ESRI:104905; semimajor 3,396,190 m, semiminor 3,376,200 m). SOLARA preserves this as the source CRS and reprojects tiles into its internal Mars sphere equirectangular view.',
    proj4:
      '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +a=3396190 +b=3376200 +units=m +no_defs',
    datum: 'Mars 2000 ellipsoid as published by the Esri MapServer',
    coordinateSystem: 'MarsEC0 equidistant cylindrical, metres, central meridian 0°',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees (geographic lon/lat), metres (MarsEC0 projected service tiles)',
    sourceDefinition: 'Custom Esri MarsEC0 / GCS_Mars_2000 as published in the ArcGIS MapServer metadata.',
  },
  coverageDescription: 'Global: lon −180° – +180°, lat −90° – +90° (Esri MapServer full extent).',
  boundingBox: { westLon: -180, eastLon: 180, southLat: -90, northLat: 90 },
  spatialResolution: 231,
  resolutionUnit:
    'Native mosaic resolution approximately 231 m/pixel at the equator. The cached MapServer exposes 9 levels, with finest level 8 at 325.605638 m/pixel; map display beyond that level is resampled.',
  observationPeriod:
    'Viking mission era (1976–1982); individual source-image acquisition dates are not exposed by this map service.',
  attribution: 'NASA Ames; USGS Astrogeology Science Center; NASA / JPL; Esri; Rice University (MapServer copyright metadata).',
  limitations: [
    'Historical global context imagery; the service does not expose acquisition dates for individual source frames.',
    'The product description estimates positional accuracy at roughly one pixel (~200 m); this is not local hazard-scale imagery.',
    'The MapServer cache exposes 9 levels (0–8), with finest served resolution 325.605638 m/pixel. Its approximately 231 m/pixel native product resolution is not available at every location/level.',
    'Tiles use the custom MarsEC0 projection on the Mars 2000 ellipsoid and are reprojected into SOLARA:MARS_EQC_IAU2015 on the Mars sphere.',
    'This layer provides broad optical context only; Jezero CTX remains the higher-resolution local planning source within its verified footprint.',
  ],
  verification: 'inspected',
  lastVerifiedAt: '2026-11-14',
};

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
    authority: MARS_SPHERE_AUTHORITY,
    proj4:
      '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: EQC_COORD_SYSTEM,
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
  observationPeriod: '2006-01-01 – 2019-08-20 (source imagery content; USGS)',
  sourcePublication: {
    title: 'Mars 2020 Terrain Relative Navigation Context Camera Orthorectified Image Mosaic',
    authors: 'USGS Astrogeology Science Center',
    year: 2020,
    doi: '10.5066/P9GV1ND3',
    url: 'https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_context_camera_orthorectified_image_mosaic',
  },
  limitations: [
    'The tile matrix "ScaleDenominator" values in the Trek capabilities document are not consistent with the Mars sphere (they imply ~111,195 m per degree — the Earth mean-sphere value, ~1.88× the Mars value of 59,274.7 m/deg). SOLARA derives tile resolutions from the verified matrix geometry (matrix dimensions × Mars sphere circumference) instead of trusting those values.',
    'The tile grid is a plate carrée (degree-based) grid: east–west ground distance at Jezero (~18.4°N) is ~5.1% smaller than the map projection scale. True scale applies only at the equator.',
    'Tiles fully outside the mosaic footprint return HTTP 404; smaller gaps can also exist inside the advertised bounding box.',
    'Production details are not stated in the WMTS service metadata itself, but are documented by the USGS source publication: produced by USGS Astrogeology (published 2020-07-24) as the Mars 2020 Lander Vision System truth map, built from three CTX stereo pairs with imagery content 2006-01-01 – 2019-08-20.',
    'This is historical imagery: it shows the surface as the component CTX images captured it, not necessarily current conditions.',
    'Optical imagery only. No elevation, slope, geology, rover, or environmental datasets are integrated in this milestone, and no terrain hazard assessment is performed.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-12',
  verifiedServedLevels: 14,
};

/* ------------------------------------------------------------------ */
/* 2. Topography — MOLA+HRSC blend color-hillshade WMTS (verified)      */
/* ------------------------------------------------------------------ */

export const MOLA_HRSC_COLORSHADE_DATASET: DatasetRecord = {
  id: 'mola-hrsc-blend-200m-colorshade',
  title: 'MOLA + HRSC Blend, Color Hillshade (200 m)',
  provider: 'NASA Trek (trek.nasa.gov)',
  mission: 'Mars Global Surveyor (MOLA) + Mars Express (HRSC)',
  instrument: 'MOLA laser altimeter / HRSC stereo camera blend',
  productId: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw',
  kind: 'topography',
  description:
    'Global colorized hillshade of the merged MGS MOLA and Mars Express HRSC ' +
    'elevation blend, served by NASA Trek as a RESTful WMTS 1.0.0 layer. ' +
    'Used as the topographic context layer over the exploration area.',
  sourceUrl:
    'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml',
  accessMethod: 'wmts',
  assetUrl:
    'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0//default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  spatialReference: {
    body: 'Mars',
    authority: MARS_SPHERE_AUTHORITY,
    proj4:
      '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: EQC_COORD_SYSTEM,
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees (geographic lon/lat), metres (projected working projection)',
    sourceDefinition:
      'urn:ogc:def:crs:EPSG::104905 — declared verbatim by Trek. Preserved as source metadata; SOLARA renders with SOLARA:MARS_EQC_IAU2015.',
  },
  coverageDescription:
    'Global: lon −180°E – +179.998°E, lat −89.999° – 90° (WMTS BoundingBox, full Mars).',
  boundingBox: {
    westLon: -180,
    eastLon: 179.9984479044183,
    southLat: -89.99922395220915,
    northLat: 90,
  },
  spatialResolution: 162.8,
  resolutionUnit:
    'm/pixel at tile level 8, the finest served level (verified from matrix geometry); product nominal 200 m/px.',
  attribution:
    'Topography blend: NASA/MGS MOLA + ESA/Mars Express HRSC, via NASA Trek (trek.nasa.gov).',
  sourcePublication: {
    title: 'Mars MGS MOLA-MEX HRSC Blended Shaded Relief Global 200m',
    authors: 'Fergason, R. L., Hare, T. M., and Laura, J.',
    year: 2018,
    url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_shaded_relief_200m',
  },
  limitations: [
    'Colorized hillshade rendering: colors encode elevation ranges, but this layer is a visual product — read quantitative elevations from the DEM query layer, not from colors.',
    'The tile matrix "ScaleDenominator" values imply ~111,195 m per degree (Earth mean sphere), ~1.88× the Mars value of 59,274.7 m/deg; SOLARA derives resolutions from matrix geometry.',
    'The verified capabilities snapshot declares tile levels 0–8; no finer levels are declared, and the map caps zoom at level 8 for this layer (~162.8 m/px).',
    'Merged product of two instruments of different generations and resolutions; blending artifacts can exist where HRSC and MOLA disagree.',
    'Global, regional-scale topography — NOT hazard-grade local terrain detail. Rock-scale hazards are invisible at this resolution.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-13',
  verifiedServedLevels: 9,
};

/* ------------------------------------------------------------------ */
/* 3. Elevation values — MOLA+HRSC blend DEM (live query + prepared grid) */
/* ------------------------------------------------------------------ */

export const MOLA_HRSC_BLEND_DEM_DATASET: DatasetRecord = {
  id: 'mola-hrsc-blend-200m-dem',
  title: 'MOLA + HRSC Blend DEM (200 m, elevation query)',
  provider: 'NASA Trek (trek.nasa.gov)',
  mission: 'Mars Global Surveyor (MOLA) + Mars Express (HRSC)',
  instrument: 'MOLA laser altimeter / HRSC stereo camera blend DEM',
  productId: 'Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw',
  kind: 'topography',
  description:
    'Elevation values from the merged MGS MOLA / Mars Express HRSC digital ' +
    'elevation model blend, served by NASA Trek as an ArcGIS ImageServer. ' +
    'Point elevations are queried live from the service; the route engine ' +
    'uses a prepared, validated grid crop over the Jezero exploration area ' +
    '(public/data/mars/jezero/rasters/mola-hrsc-dem-jezero-grid.json, ' +
    'cross-validated against the live service at the crop centre).',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer?f=pjson`,
  accessMethod: 'api',
  queryEndpoint:
    `${TREK_ARCGIS_SERVICES}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/identify`,
  preparedAssetUrl: '/data/mars/jezero/rasters/mola-hrsc-dem-jezero-grid.json',
  spatialReference: {
    body: 'Mars',
    authority:
      'Trek ArcGIS services declare ESRI:104905 "GCS_Mars_2000" (a geographic Mars CRS, ' +
      'wkid 104905 under the ESRI authority — no equivalent exists in the EPSG registry). ' +
      'SOLARA records queried coordinates with the internal id SOLARA:MARS_2000_SPHERE_LONLAT.',
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem:
      'Geographic lon/lat in degrees for queries (identify sr=104905); the DEM raster itself is stored in a Mars equirectangular projection server-side (source metadata only).',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees (query coordinates), metres (elevation values)',
    sourceDefinition:
      'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — the CRS Trek ArcGIS services declare for identify/exportImage queries. Preserved verbatim as source metadata.',
  },
  coverageDescription:
    'Global DEM (lon −180°E – +179.998°E, lat −89.999° – 90°). The prepared route-planning grid covers the CTX mosaic footprint: lon 77.1604655°E – 77.6991776°E, lat 18.2110274°N – 18.7211945°N.',
  boundingBox: {
    westLon: -180,
    eastLon: 179.9984479044183,
    southLat: -89.99922395220915,
    northLat: 90,
  },
  spatialResolution: 200,
  resolutionUnit:
    'm/pixel nominal (declared pixel size 0.0033741°/px ≈ 200 m at the Mars equator; ~190 m east–west at 18.4°N). The prepared grid is served at native resolution (nearest neighbour).',
  units: 'metres (elevation, S16 integers)',
  attribution:
    'Topography blend: NASA/MGS MOLA + ESA/Mars Express HRSC, via NASA Trek (trek.nasa.gov).',
  observationPeriod: 'MOLA laser points 1999–2001; blended product published 2018',
  sourcePublication: {
    title: 'Mars MGS MOLA-MEX HRSC Blended DEM Global 200m v2',
    authors: 'Fergason, R. L., Hare, T. M., and Laura, J.',
    year: 2018,
    url: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m',
  },
  limitations: [
    'Elevation is relative to the Mars areoid (MOLA reference); the blend is registered to MOLA topography. Treat values as derived, not raw MOLA observations.',
    'Total elevation uncertainty ≥ ±3 m (areoid ±1.8 m); HRSC covers ~44% of Mars; USGS: blending artifacts exist — "care should be taken".',
    'Nominal ~200 m ground resolution: crater floors and rims are resolved, but rock-scale hazards, small scarps, and landing-zone-scale roughness are NOT represented. A route on this grid is a regional terrain-cost candidate only.',
    'The prepared route grid was fetched 2026-11-13 and validated against the live identify endpoint (centre-point difference 10.5 m, bilinear vs nearest-neighbour sampling). If the source service updates, the grid and the live service can disagree.',
    'Vertical alignment artifacts between HRSC and MOLA can exist in blend seams.',
    'NoData handling: cells the service reports as missing are treated as UNKNOWN terrain, never as safe. The prepared crop contained no NoData cells (verified by value range).',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-13',
};

/* ------------------------------------------------------------------ */
/* 4. Geology — USGS SIM 3292 (prepared GeoJSON, verified query)        */
/* ------------------------------------------------------------------ */

export const USGS_SIM3292_GEOLOGY_DATASET: DatasetRecord = {
  id: 'usgs-sim3292-jezero-geology',
  title: 'Geologic Map of Mars — Jezero area (USGS SIM 3292)',
  provider: 'USGS Astrogeology Science Center, via NASA Trek',
  mission: 'Compilation (Tanaka et al., 2014)',
  instrument: 'USGS SIM 3292 global geologic map',
  productId: 'SIM3292_Global_Geology',
  kind: 'geology',
  description:
    'Geologic map units (USGS Scientific Investigations Map 3292, "Geologic ' +
    'Map of Mars") intersecting the Jezero exploration area and a 1° context ' +
    'margin, prepared as a static GeoJSON overlay with unit codes and ' +
    'descriptions. Global compilation units — useful for regional context, ' +
    'not site-scale mapping.',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/SIM3292_Global_Geology/MapServer?f=pjson`,
  accessMethod: 'geojson',
  preparedAssetUrl: '/data/mars/jezero/geology/usgs-sim3292-jezero.geojson',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem:
      'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'Prepared extent: lon 77.0°E – 78.0°E, lat 18.0°N – 19.0°N (footprint + 1° context margin). Underlying map is global.',
  boundingBox: {
    westLon: 77.0,
    eastLon: 78.0,
    southLat: 18.0,
    northLat: 19.0,
  },
  spatialResolution: undefined,
  resolutionUnit:
    'Published at 1:20,000,000 scale (global compilation). Effective ground detail is kilometres-scale; unit boundaries are generalized.',
  attribution:
    'Geology: Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., et al. (2014), Geologic Map of Mars, USGS SIM 3292. Served via NASA Trek (trek.nasa.gov).',
  sourcePublication: {
    title: 'Geologic Map of Mars (SIM 3292)',
    authors:
      'Tanaka, K. L., Skinner, J. A., Dohm, J. M., Irwin, R. P., Kolb, E. J., Fortezzo, C. M., Platz, T., Michael, G. G., and Hare, T. M.',
    year: 2014,
    doi: '10.3133/sim3292',
    url: 'https://pubs.usgs.gov/sim/3292/',
  },
  limitations: [
    'Global 1:20M compilation: this is regional geologic context, NOT a site-scale Jezero hazard or mineral map.',
    'Only 2 units intersect the prepared extent (mNhm — Middle Noachian highland massif unit; HNt — Hesperian and Noachian transition unit). Jezero-crater-scale mapping (e.g. delta fan units) is below this map\'s resolution.',
    'Unit boundaries are generalized at compilation scale; do not infer precise material boundaries from them.',
    'Prepared 2026-11-13 from a live Trek query; upstream map edits would not propagate automatically.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-13',
};

/* ------------------------------------------------------------------ */
/* 5. Rover — Perseverance traverse path (prepared GeoJSON, verified)   */
/* ------------------------------------------------------------------ */

export const PERSEVERANCE_TRAVERSE_DATASET: DatasetRecord = {
  id: 'mars2020-perseverance-traverse',
  title: 'Perseverance Rover Traverse Path (historical)',
  provider: 'NASA Trek (trek.nasa.gov), Mars 2020 mission',
  mission: 'Mars 2020 (Perseverance rover)',
  instrument: 'Rover localization products (Trek compilation)',
  productId: 'Perseverance_Traverse_Path',
  kind: 'rover',
  description:
    'Historical traverse of the Perseverance rover as sol-by-sol path ' +
    'segments with Rover Motion Counter (RMC) references and segment ' +
    'lengths, prepared as a static GeoJSON overlay from the NASA Trek ' +
    'Mars 2020 traverse map service.',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/Perseverance_Traverse_Path/MapServer?f=pjson`,
  accessMethod: 'geojson',
  preparedAssetUrl: '/data/mars/jezero/rover/perseverance-traverse-path.geojson',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'The rover\'s historical traverse inside Jezero Crater (lon ~77.304°E – 77.463°E, lat ~18.427°N – 18.500°N). Prepared 2026-11-13.',
  boundingBox: {
    westLon: 77.303808,
    eastLon: 77.463133,
    southLat: 18.427253,
    northLat: 18.499663,
  },
  spatialResolution: undefined,
  resolutionUnit:
    'Localization-derived track line; positional accuracy follows Mars 2020 rover localization products (metres-scale). SOLARA does not re-derive localization accuracy.',
  observationStart: undefined,
  observationEnd: undefined,
  attribution:
    'Traverse: NASA/JPL-Caltech, Mars 2020 Perseverance rover localization, via NASA Trek (trek.nasa.gov).',
  limitations: [
    'HISTORICAL path of a robotic rover — it is NOT a validated astronaut route and must never be shown as one.',
    'The track reflects rover localization products as compiled by Trek at preparation time (2026-11-13); newer mission data are not included.',
    'Segment lengths and RMC references are as published by the service; SOLARA does not re-verify rover odometry.',
    'Positional accuracy depends on the rover localization product chain; treat individual track points as approximate.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-13',
};

/* ------------------------------------------------------------------ */
/* 6. Rover context — Perseverance landing ellipse (prepared GeoJSON)   */
/* ------------------------------------------------------------------ */

export const PERSEVERANCE_LANDING_ELLIPSE_DATASET: DatasetRecord = {
  id: 'mars2020-landing-ellipse',
  title: 'Perseverance Landing Ellipse (historical)',
  provider: 'NASA Trek (trek.nasa.gov), Mars 2020 mission',
  mission: 'Mars 2020 (Perseverance rover)',
  instrument: 'Mission-planning landing ellipse (Trek compilation)',
  productId: 'perseverance_landing_ellipse',
  kind: 'rover',
  description:
    'The Mars 2020 Perseverance rover landing ellipse polygon as served by ' +
    'NASA Trek, prepared as a static GeoJSON overlay. Historical mission ' +
    'context for the exploration area.',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/perseverance_landing_ellipse/MapServer?f=pjson`,
  accessMethod: 'geojson',
  preparedAssetUrl: '/data/mars/jezero/rover/perseverance-landing-ellipse.geojson',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'Landing ellipse footprint inside Jezero Crater (polygon served by Trek). Prepared 2026-11-13.',
  attribution:
    'Landing ellipse: NASA/JPL-Caltech, Mars 2020 mission, via NASA Trek (trek.nasa.gov).',
  limitations: [
    'Historical mission-planning geometry, not real-time information.',
    'The service does not publish ellipse dimensions or target name in feature attributes; SOLARA does not invent them.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-13',
};

/* ------------------------------------------------------------------ */
/* 7. Environmental — Mars 2020 Perseverance MEDA (PDS Atmospheres)    */
/* ------------------------------------------------------------------ */

export const MARS2020_MEDA_DATASET: DatasetRecord = {
  id: 'mars2020-meda-environmental',
  title: 'Perseverance Rover MEDA Environmental Observations',
  provider: 'NASA Planetary Data System (PDS) Atmospheres Node',
  mission: 'Mars 2020 (Perseverance)',
  instrument: 'MEDA — Mars Environmental Dynamics Analyzer',
  productId: 'urn:nasa:pds:mars2020_meda',
  kind: 'atmospheric',
  description:
    'In-situ surface atmospheric and meteorological observations from the MEDA instrument ' +
    'suite aboard the Perseverance rover at Jezero Crater, archived at the NASA PDS Atmospheres Node. ' +
    'Includes calibrated air temperature (ATS), derived pressure (PS), derived relative humidity (RHS), ' +
    'and derived horizontal wind speed and direction (WS).',
  sourceUrl:
    'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html',
  accessMethod: 'api',
  queryEndpoint: '/api/meda/environment/latest',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Mars 2020 Perseverance rover localized positions inside Jezero Crater',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees (rover location); °C, Pa, %, m/s, ° (environmental measurements)',
    sourceDefinition:
      'Perseverance rover surface traverse inside Jezero Crater (~77.4°E, 18.4°N).',
  },
  coverageDescription:
    'Jezero Crater floor and delta traverse path (Perseverance rover operational sites, sols 14–1859+).',
  boundingBox: {
    westLon: 77.1604655,
    eastLon: 77.6991776,
    southLat: 18.2110274,
    northLat: 18.7211945,
  },
  attribution:
    'Data: NASA / JPL-Caltech / INTA / CAB (CSIC-INTA). Archive: NASA PDS Atmospheres Node (NMSU).',
  observationPeriod: '2021-02-18 – present (PDS releases through Sol 1859+)',
  sourcePublication: {
    title: 'The Mars Environmental Dynamics Analyzer (MEDA) on the Mars 2020 Mission',
    authors: 'Rodriguez-Manfredi, J. A. et al.',
    year: 2021,
    doi: '10.1007/s11214-021-00816-9',
    url: 'https://doi.org/10.1007/s11214-021-00816-9',
  },
  limitations: [
    'Historical in-situ planetary observations from Mars surface instruments — never Earth-like live weather forecasts.',
    'Perseverance wind sensor (WS) on Booms 1 & 2 suffered grit/pebble impact damage on Sol 315. In current PDS releases, subsequent wind records are missing or invalid; the latest valid derived wind observation from Sol 313 is preserved honestly without interpolation.',
    'Air temperature (ATS) is measured at specific mast and deck locations (e.g. ATS1 at 1.45 m on mast) and is affected by local microclimate and rover thermal signature.',
    'Pressure (PS) and humidity (RHS) sensors report local ambient conditions along the rover traverse inside Jezero Crater.',
    'Missing values and sensor anomalies are preserved honestly and never interpolated.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-14',
};

/* ------------------------------------------------------------------ */
/* 6b. IAU nomenclature — Jezero identification label (prepared GeoJSON) */
/* ------------------------------------------------------------------ */

export const JEZERO_IAU_NOMENCLATURE_DATASET: DatasetRecord = {
  id: 'jezero-iau-nomenclature',
  title: 'IAU Nomenclature — Jezero (USGS/IAU Gazetteer)',
  provider: 'USGS Astrogeology / IAU Working Group for Planetary System Nomenclature, via NASA Trek',
  mission: 'Gazetteer of Planetary Nomenclature',
  instrument: 'IAU-approved feature nomenclature',
  productId: 'outreach_nomenclature',
  kind: 'science',
  description:
    'The IAU-adopted name for the landing region. Only one IAU feature ' +
    'falls inside this area — Jezero (a 47.52 km crater in the Syrtis Major ' +
    'quadrangle) — so this overlay identifies the region rather than ' +
    'labelling a gazetteer of features.',
  sourceUrl: `${TREK_ARCGIS_SERVICES}/outreach_nomenclature/MapServer?f=pjson`,
  accessMethod: 'geojson',
  preparedAssetUrl: '/data/mars/jezero/science/iau-nomenclature.geojson',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'Prepared from the 76°E–79°E, 17°N–20°N query; the only in-area feature is ' +
    'Jezero at 77.687°E, 18.408°N. Hargraves crater (20.74°N) is outside the ' +
    'exploration region and is not shipped.',
  boundingBox: {
    westLon: 76,
    eastLon: 79,
    southLat: 17,
    northLat: 20,
  },
  resolutionUnit:
    'Point position from the IAU gazetteer. Published diameter 47.52 km is recorded as metadata; the crater rim is not drawn.',
  attribution:
    'Nomenclature: IAU Working Group for Planetary System Nomenclature / USGS Gazetteer of Planetary Nomenclature.',
  limitations: [
    'Identification label only: the published position is the feature centre; no boundary, rim, or hazard information is implied.',
    'A single feature (Jezero) exists in this area — this is not a regional place-name index.',
    'Approval status and origin are reproduced verbatim from the gazetteer; SOLARA does not re-verify IAU records.',
    'The gazetteer link is served over HTTP by USGS and may be unavailable; the label itself is prepared locally.',
  ],
  verification: 'tested',
  lastVerifiedAt: '2026-11-14',
};

/* ------------------------------------------------------------------ */
/* 7. Hydrous-mineral detections (prepared raster, verified)           */
/* ------------------------------------------------------------------ */

export const JEZERO_HYDROUS_MINERALS_DATASET: DatasetRecord = {
  id: 'jezero-hydrous-minerals-omega-crism',
  title: 'Hydrous Mineral Detections — OMEGA/CRISM (NASA Trek)',
  provider: 'NASA Trek (trek.nasa.gov)',
  mission: 'Mars Express (OMEGA) + Mars Reconnaissance Orbiter (CRISM) compilations',
  instrument: 'OMEGA and CRISM near-infrared spectrometers (published detections)',
  productId: 'Hydrous_Mineral_Detections_OMEGA_CRISM_clon0',
  kind: 'spectral',
  description:
    'Detections of hydrous minerals near Jezero, exported from the NASA Trek ' +
    'mineral-detection map service as a georeferenced transparency. Detections ' +
    'are sparse class pixels, not a continuous abundance map; useful for ' +
    'anchoring science destinations, never as a resource or trafficability ' +
    'assessment.',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer?f=pjson`,
  accessMethod: 'raster',
  preparedAssetUrl: '/data/mars/jezero/rasters/hydrous-minerals-omega-crism.png',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'Prepared export: lon 77.00°E – 77.86°E, lat 18.05°N – 18.88°N (exploration ' +
    'region + ~0.16° margin), 1400 × 1400 px. Underlying service is global.',
  boundingBox: {
    westLon: 77.0,
    eastLon: 77.86,
    southLat: 18.05,
    northLat: 18.88,
  },
  resolutionUnit:
    'Prepared at ~36 m/px (0.16°–0.17° per 1400 px). Detection pixels indicate presence, not concentration or confidence.',
  attribution:
    'Hydrous-mineral detections: OMEGA (ESA Mars Express) and CRISM (NASA MRO) compilations served by NASA Trek (trek.nasa.gov).',
  limitations: [
    'Sparse detection class pixels — presence only. Do not read them as mineral abundance, grade, or economic potential.',
    'The Trek service publishes no per-class legend or confidence values; class colours are shown as published and are not independently identified by SOLARA.',
    'Chloride-salt detections (THEMIS service) were checked 2026-11-14 and returned no opaque pixels over this footprint — SOLARA ships no chloride layer rather than implying coverage.',
    'Detection compilations aggregate orbital observations across years; they are not current surface conditions.',
    'Prepared 2026-11-14 from a live Trek export; upstream map edits will not propagate automatically.',
  ],
  verification: 'tested',
  lastVerifiedAt: '2026-11-14',
};

/* ------------------------------------------------------------------ */
/* 8. Science waypoints — Mars 2020 mission bookmarks (prepared GeoJSON) */
/* ------------------------------------------------------------------ */

export const MARS2020_SCIENCE_STOPS_DATASET: DatasetRecord = {
  id: 'mars2020-science-stops',
  title: 'Mars 2020 Science Waypoints (NASA Trek)',
  provider: 'NASA Trek (trek.nasa.gov), Mars 2020 mission',
  mission: 'Mars 2020 (Perseverance rover)',
  instrument: 'Mission waypoint bookmark compilation (Trek)',
  productId: 'mars2020_waypoints',
  kind: 'science',
  description:
    'Named waypoint bookmarks compiled by NASA Trek for the Mars 2020 ' +
    'mission area: the Jezero landing site, delta deposits, breach and ' +
    'inflow/outflow channels. Prepared as a static GeoJSON overlay so a ' +
    'planned walk can be anchored to named destinations of scientific ' +
    'interest. Points of interest only — not a hazard or trafficability ' +
    'assessment.',
  sourceUrl:
    `${TREK_ARCGIS_SERVICES}/mars2020_waypoints/MapServer/0/query` +
    '?where=1%3D1&outFields=*&returnGeometry=true&f=geojson',
  accessMethod: 'geojson',
  preparedAssetUrl: '/data/mars/jezero/science/mars2020-waypoints.geojson',
  spatialReference: {
    body: 'Mars',
    authority: GEOGRAPHIC_AUTHORITY,
    proj4: '+proj=longlat +R=3396190 +no_defs',
    datum: MARS_SPHERE_DATUM,
    coordinateSystem: 'Geographic lon/lat degrees (map service declares ESRI:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'east',
    units: 'degrees',
    sourceDefinition: 'ESRI:104905 "Mars 2000" (GCS_Mars_2000) — as declared by the Trek map service.',
  },
  coverageDescription:
    'Eight waypoint bookmarks, lon 77.203°E – 78.713°E, lat 18.408°N – 18.870°N. ' +
    'Six lie inside the CTX mosaic footprint; Northern Inflow Channel and ' +
    'Outflow Channel lie beyond the mosaic edge (global imagery only there).',
  boundingBox: {
    westLon: 77.203,
    eastLon: 78.713,
    southLat: 18.4082,
    northLat: 18.87,
  },
  resolutionUnit:
    'Point bookmarks — no spatial resolution. Positions are published to ~1e-5° in the service response.',
  attribution:
    'Waypoints: NASA/JPL-Caltech, Mars 2020 Perseverance mission, compiled by NASA Trek (trek.nasa.gov).',
  limitations: [
    'Compiled bookmark points — locations of mission/geological interest, NOT a hazard, trafficability, landing, or safety assessment.',
    'The service publishes elevation = 0 for every waypoint; SOLARA records that value verbatim and never displays it as a measured elevation.',
    'Northern Inflow Channel (18.870°N) and Outflow Channel (78.713°E) lie outside the CTX mosaic footprint — only global-context imagery is available there.',
    'The bookmark compilation date is not published by the service; SOLARA prepared this snapshot 2026-11-14 and does not assume it is current.',
  ],
  verification: 'integrated',
  lastVerifiedAt: '2026-11-14',
};

/* ------------------------------------------------------------------ */
/* Region                                                              */
/* ------------------------------------------------------------------ */

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
  datasetIds: [
    VIKING_GLOBAL_MOSAIC_DATASET.id,
    JEZERO_CTX_DATASET.id,
    MOLA_HRSC_COLORSHADE_DATASET.id,
    USGS_SIM3292_GEOLOGY_DATASET.id,
    PERSEVERANCE_TRAVERSE_DATASET.id,
    PERSEVERANCE_LANDING_ELLIPSE_DATASET.id,
    MARS2020_SCIENCE_STOPS_DATASET.id,
    JEZERO_IAU_NOMENCLATURE_DATASET.id,
    JEZERO_HYDROUS_MINERALS_DATASET.id,
    MOLA_HRSC_BLEND_DEM_DATASET.id,
    MARS2020_MEDA_DATASET.id,
  ],
};

const DATASETS: readonly DatasetRecord[] = [
  VIKING_GLOBAL_MOSAIC_DATASET,
  JEZERO_CTX_DATASET,
  MOLA_HRSC_COLORSHADE_DATASET,
  MOLA_HRSC_BLEND_DEM_DATASET,
  USGS_SIM3292_GEOLOGY_DATASET,
  PERSEVERANCE_TRAVERSE_DATASET,
  PERSEVERANCE_LANDING_ELLIPSE_DATASET,
  MARS2020_MEDA_DATASET,
  MARS2020_SCIENCE_STOPS_DATASET,
  JEZERO_HYDROUS_MINERALS_DATASET,
  JEZERO_IAU_NOMENCLATURE_DATASET,
];

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
