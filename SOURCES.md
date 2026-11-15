# SOLARA external sources and attribution audit

This file records external datasets, APIs, services, software and scientific
references consumed by or directly supporting the repository's implemented
features. `Integrated` means there is code that consumes the source; it does
not imply current upstream availability. Static snapshots and prepared assets
are distinguished from runtime requests, and scientific references are not
presented as runtime integrations.

## 3D globe and planetary rendering

### CesiumJS

- **Status:** Integrated, lazy-loaded when a user opens the 3D Globe.
- **Official URL:** [CesiumJS](https://cesium.com/platform/cesiumjs/), [CesiumJS API reference](https://cesium.com/learn/cesiumjs/ref-doc/).
- **Provider:** Cesium GS, Inc.; Apache-2.0 open-source JavaScript library.
- **What it provides:** WebGL rendering, globe camera controls, entity interaction,
  and 3D Tiles decoding. It does not itself provide Mars data.
- **SOLARA use:** `package.json`; `src/features/mars-globe/MarsGlobe.tsx`;
  `vite.config.ts` (worker/static asset serving); `src/features/habitat-mode/HabitatMode.tsx`;
  `src/features/field-tablet/FieldTabletMode.tsx`.
- **Functionality:** Full-planet rotation, zoom and pan; point picking; an optional
  historical Perseverance traverse over the Mars surface.
- **Format/API:** CesiumJS ES modules, WebGL, Cesium 3D Tiles client.
- **Coverage/resolution:** Determined by the separately licensed Cesium Mars asset.
- **Authentication:** None for the library. It lazy-imports only after a browser
  token is configured.
- **Limitations:** WebGL-capable browser required. Cesium worker and widget assets
  are copied to the production `dist/cesium/` directory by the Vite plugin; they
  are not checked into `public/` and are not requested on map-only sessions.
- **Attribution/license:** CesiumJS is Apache-2.0. Cesium ion content has separate
  terms and attribution requirements (see below).

### Cesium ion — Cesium Mars asset 3644333

- **Status:** Integrated behind an explicit token/configuration state; upstream
  streaming was not browser-verified in this environment without a configured token.
- **Official URL:** [Cesium Mars content page](https://cesium.com/platform/cesium-ion/content/cesium-mars/).
- **Provider:** Cesium ion; source datasets credited by Cesium to NASA and the
  USGS Astrogeology Science Center.
- **What it provides:** A global Mars 3D Tiles tileset combining a Viking global
  color mosaic and MOLA/MGS + MEX/HRSC topography; finer Jezero imagery and terrain
  are included in the same hierarchical tileset.
- **SOLARA use:** `src/features/mars-globe/MarsGlobe.tsx` loads ion asset `3644333`;
  `vite.config.ts` hosts the Cesium runtime assets; `.env.example` documents the token.
- **Functionality:** Actual planetary surface imagery and elevation geometry with
  progressive 3D Tiles refinement as the camera zooms. It is a 3D Tiles tileset,
  not a standard Cesium imagery layer or TerrainProvider.
- **Format/API:** Cesium ion 3D Tiles streaming API; published CRS `IAU_2015:49901`.
- **Coverage/resolution:** Mars-wide; approximately 232 m/pixel imagery and
  200 m terrain globally. Cesium lists Jezero at approximately 6 m imagery and
  20 m terrain. The existing OpenLayers Jezero CTX mosaic remains a separate,
  finer 2D planning source at approximately 5.087 m/pixel in its verified footprint.
- **Authentication:** Cesium ion account and a browser-visible token are required.
  Configure `VITE_CESIUM_ION_TOKEN` locally. Use an app-specific token with only
  `assets:read`, selected asset 3644333, and allowed application origins. Browser
  tokens are visible to users; never put private scopes or account credentials in
  a `VITE_*` variable.
- **Limitations:** The globe displays global context, not hazard-grade coverage.
  The token is unavailable in a fresh checkout, so the UI shows setup instructions
  and does not draw a substitute planet. Streaming quotas and current ion access
  are controlled by the account. Review current Cesium ion plan and license terms
  before publishing this hosted content for third-party use.
- **Attribution:** Cesium's CreditDisplay is preserved in the globe UI; SOLARA also
  names Cesium ion and NASA/USGS in its source label. Follow the [Content Usage and
  Attribution Guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/)
  and [Cesium ion Terms of Service](https://cesium.com/legal/terms-of-service/).

### Cesium ion token and usage terms

- **Status:** Configuration documented; no token is stored in the repository.
- **Official URL:** [Access tokens](https://cesium.com/learn/ion/cesium-ion-access-tokens/),
  [ion terms](https://cesium.com/legal/terms-of-service/),
  [content attribution guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/).
- **Provider:** Cesium GS, Inc.
- **SOLARA use:** `src/features/mars-globe/MarsGlobe.tsx`, `.env.example`,
  `vite.config.ts`, `index.html` (`strict-origin-when-cross-origin` referrer policy).
- **Functionality/API:** `assets:read` access to the Mars tileset; no token is sent
  to SOLARA's Cloudflare Worker.
- **Authentication:** `VITE_CESIUM_ION_TOKEN` is a public browser token and must be
  restricted by scope, selected asset and URL. Do not use a default, unrestricted
  production token.
- **Limitations/licensing:** Cesium's terms are account/plan dependent and include
  restrictions on third-party access and operating a service for third parties.
  Confirm that the intended public deployment is permitted by the current plan or
  obtain an appropriate agreement. Cesium ion credit/logo and data attribution must
  remain visible.
- **Attribution:** See the official terms and guide above; Cesium's client provides
  its built-in attribution display.

## Mars global imagery

### Viking MDIM 2.1 global color mosaic (2D map context)

- **Status:** Integrated in OpenLayers as global optical context.
- **Official service URL:** [Esri-hosted Mars Viking Mosaic MapServer](https://tiles.arcgis.com/tiles/lqRTrQp2HrfnJt8U/arcgis/rest/services/mars_viking_mosaic/MapServer).
- **Provider:** NASA Ames / USGS Astrogeology source mosaic; cached tiles hosted by Esri.
- **What it provides:** Global historical Viking colorized mosaic imagery.
- **SOLARA use:** `src/data/catalog/datasets.ts` (`VIKING_GLOBAL_MOSAIC_DATASET`);
  `src/map/layers/createVikingGlobalLayer.ts`; `src/map/MarsMap.tsx`.
- **Functionality:** Low-resolution global context underneath the Jezero CTX map layer.
- **Format/API:** Esri cached MapServer XYZ tiles (`/tile/{z}/{y}/{x}`).
- **Coverage/resolution:** Global Mars. Product nominal resolution is approximately
  231 m/pixel; the inspected Esri cache is only served through levels 0–8, with
  finest cache resolution approximately 325.606 m/pixel.
- **Authentication:** No key in the application.
- **Limitations:** Historical Viking-era imagery, not current surface conditions.
  Esri's custom MarsEC0 ellipsoid projection is reprojected to SOLARA's internal
  Mars-sphere projection. Cache levels are limited; zooming further resamples the
  highest cached level.
- **Attribution:** NASA Ames, USGS Astrogeology Science Center, NASA/JPL, Esri and
  source mosaic contributors; see MapServer copyright metadata and catalog record.

## Mars regional imagery and CTX

### NASA Trek Jezero CTX orthorectified mosaic

- **Status:** Integrated in OpenLayers.
- **Official URL:** [WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml).
- **Provider:** NASA Trek; source product produced by USGS Astrogeology Science Center.
- **What it provides:** Controlled, orthorectified Mars 2020 Terrain Relative
  Navigation CTX mosaic for Jezero.
- **SOLARA use:** `src/data/catalog/datasets.ts` (`JEZERO_CTX_DATASET`);
  `src/map/trek/trekCapabilities.ts`; `src/map/trek/tileGrid.ts`;
  `src/map/layers/createWmtsLayer.ts`; `src/map/MarsMap.tsx`.
- **Functionality:** Highest-resolution verified OpenLayers optical planning layer.
- **Format/API:** OGC WMTS 1.0.0 PNG tiles, using an embedded verified capabilities
  snapshot and a separate non-blocking live grid fingerprint check.
- **Coverage/resolution:** 77.1604655–77.6991776°E, 18.2110274–18.7211945°N;
  approximately 5.087 m/pixel at finest verified served level (13). The product ID
  nominally names a 6 m mosaic.
- **Authentication:** No key.
- **Limitations:** Historical component imagery dates 2006–2019. Tiles outside its
  verified footprint can be absent; SOLARA limits requests to the footprint and
  does not claim this layer outside it. Trek's declared CRS URN and matrix scale
  metadata are inconsistent; repository code uses the documented verified Mars
  sphere transform and analytic grid geometry.
- **Attribution:** NASA/JPL-Caltech/MSSS (MRO CTX), NASA Trek. USGS product page:
  [Mars 2020 TRN CTX mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_context_camera_orthorectified_image_mosaic),
  DOI [10.5066/P9GV1ND3](https://doi.org/10.5066/P9GV1ND3).

## Elevation and terrain

### Cesium Mars MOLA/HRSC terrain

- **Status:** Integrated in the 3D Globe through Cesium Mars asset 3644333.
- **Official URLs:** [Cesium Mars source/specification](https://cesium.com/platform/cesium-ion/content/cesium-mars/),
  [USGS blended DEM](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m).
- **Provider:** MOLA on NASA MGS and HRSC on ESA Mars Express; Cesium ion hosts the
  processed 3D Tiles dataset.
- **SOLARA use:** `src/features/mars-globe/MarsGlobe.tsx`; package and token setup
  described above.
- **Functionality/format:** Elevation geometry streamed as part of a Cesium 3D Tiles
  asset, not as a separate TerrainProvider.
- **Coverage/resolution:** Global terrain approximately 200 m; approximately 20 m
  at Jezero within this asset.
- **Authentication:** Cesium ion token for asset 3644333.
- **Limitations:** Global context is not hazard-grade. The tiles are an integrated
  visual product, not the numeric DEM used by SOLARA's route engine.
- **Attribution:** NASA and USGS Astrogeology Science Center; also retain Cesium ion
  attribution. Source/terms are linked from Cesium Mars.

### NASA Trek MOLA + HRSC global color hillshade

- **Status:** Integrated as an optional OpenLayers WMTS base layer.
- **Official URL:** [WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml).
- **Provider:** NASA Trek; MOLA (NASA MGS) plus HRSC (ESA Mars Express), USGS blended
  product (Fergason, Hare & Laura, 2018).
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `src/map/trek/trekCapabilities.ts`; `src/map/layers/createWmtsLayer.ts`;
  `src/map/MarsMap.tsx`.
- **Functionality:** Global topographic color-hillshade context beneath optical imagery.
- **Format/API:** OGC WMTS JPEG tiles.
- **Coverage/resolution:** Near-global Mars; product nominally 200 m/pixel, finest
  verified served layer resolution approximately 162.8 m/pixel.
- **Authentication:** No key.
- **Limitations:** Color hillshade is not a quantitative elevation layer. Elevation
  readouts use the separate DEM source. Global resolution is not suitable for local
  hazard avoidance.
- **Attribution:** NASA MOLA, ESA Mars Express HRSC, NASA Trek; product page:
  [MOLA-MEX-HRSC blended relief](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_shaded_relief_200m).

### NASA Trek MOLA + HRSC DEM ImageServer

- **Status:** Integrated for elevation queries and a prepared Jezero route grid.
- **Official URL:** [ImageServer metadata](https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer),
  [USGS product page](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m).
- **Provider:** NASA Trek; MGS MOLA blended with Mars Express HRSC.
- **SOLARA use:** `src/data/adapters/demService.ts` (`identify`); `src/data/adapters/elevationGrid.ts`;
  `scripts/prepare-jezero-assets.mjs`; `public/data/mars/jezero/rasters/mola-hrsc-dem-jezero-grid.json`;
  `src/workers/route.worker.ts` and `src/map/MarsMap.tsx` consumers.
- **Functionality/format:** ArcGIS ImageServer identify query for point elevation;
  prepared JSON grid for local sampling and A* route costs.
- **Coverage/resolution:** Global query service, nominal approximately 200 m/pixel.
  Prepared grid is 160 × 151 cells over Jezero CTX coverage only.
- **Authentication:** No key.
- **Limitations:** HRSC contributes about 44% of global coverage; blend seams and
  product uncertainty remain. NoData is unknown. This is regional planning context,
  not a high-resolution terrain hazard product.
- **Attribution:** USGS Astrogeology/NASA MOLA/ESA HRSC; product metadata and prepared
  asset sidecar record the query and transformation provenance.

## Rover locations and traverse data

### NASA Trek Perseverance traverse

- **Status:** Integrated in 2D; optional historical line in the 3D Globe.
- **Official source:** [Trek ArcGIS service](https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer).
- **Provider:** NASA Trek; localization-derived Mars 2020 Perseverance traverse.
- **SOLARA use:** `scripts/prepare-jezero-assets.mjs`;
  `public/data/mars/jezero/rover/perseverance-traverse-path.geojson`;
  `src/data/adapters/roverObservationService.ts`; `src/map/layers/createGeojsonLayer.ts`;
  `src/map/MarsMap.tsx`; `src/features/mars-globe/MarsGlobe.tsx`.
- **Functionality:** Historical route, Sol-tagged closest rover position calculations
  for contextual image search, and optional 3D surface draping. Selecting a 3D
  segment opens the existing Rover POV context for the picked point.
- **Format/API:** Trek ArcGIS MapServer query prepared as GeoJSON; 3D entities clamp
  to the Cesium Mars 3D Tiles surface.
- **Coverage/resolution:** Jezero traverse, 332 segments, Sols 14–1176, approximately
  27.2 km. This is not a current rover-position feed.
- **Authentication:** No key.
- **Limitations:** Historical localization only. The line is not a live rover track,
  astronaut path or safety assessment. Raw image records are associated by Sol/time;
  SOLARA does not assign an image the clicked coordinate.
- **Attribution:** NASA/JPL-Caltech via NASA Trek; the prepared GeoJSON retains the
  source service and preparation date.

### NASA Trek Perseverance landing ellipse

- **Status:** Integrated in OpenLayers only.
- **Official source:** [Trek ArcGIS service](https://trek.nasa.gov/mars/trekarcgis/rest/services/perseverance_landing_ellipse/MapServer).
- **Provider:** NASA Trek / Mars 2020 mission planning.
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `public/data/mars/jezero/rover/perseverance-landing-ellipse.geojson`;
  `src/map/layers/createGeojsonLayer.ts`; `src/map/MarsMap.tsx`.
- **Functionality/format:** Historical planning polygon prepared as GeoJSON overlay.
- **Coverage/resolution:** One ellipse in Jezero; source service does not publish a
  numeric dimension in the prepared record.
- **Authentication:** No key.
- **Limitations:** Historical mission planning geometry, not a current landing or
  safety recommendation.
- **Attribution:** NASA/JPL-Caltech via NASA Trek.

### NASA Trek Mars 2020 science waypoints

- **Status:** Integrated in OpenLayers.
- **Official URL:** [Waypoints query](https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020_waypoints/MapServer/0/query?where=1%3D1&outFields=%2A&returnGeometry=true&f=geojson).
- **Provider:** NASA Trek.
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `public/data/mars/jezero/science/mars2020-waypoints.geojson`;
  `src/map/layers/createGeojsonLayer.ts`; `src/map/MarsMap.tsx`;
  Habitat/Field Tablet Inspector components.
- **Functionality/format:** Eight compiled mission bookmarks as GeoJSON points with
  source properties and per-feature links.
- **Coverage/resolution:** Mars 2020/Jezero vicinity; six of eight are inside the
  verified Jezero CTX footprint. These are points of geological interest, not
  rover positions or hazard assessments.
- **Authentication:** No key.
- **Limitations:** Source elevation field value `0` is not treated as a measured
  elevation. Locations outside CTX coverage remain outside; they are not clamped.
- **Attribution:** NASA/JPL-Caltech via NASA Trek.

## Rover images and observations

### NASA Perseverance raw image feed

- **Status:** Integrated through a fixed Cloudflare Worker proxy.
- **Official URL:** [Perseverance raw images JSON feed](https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=50&page=0&order=sol+desc); [NASA Mars 2020 raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/).
- **Provider:** NASA/JPL-Caltech/MSSS Mars 2020 mission.
- **SOLARA use:** `worker/src/roverImages.ts`; `worker/src/index.ts`;
  `src/data/adapters/roverImageService.ts`; `src/data/adapters/roverObservationService.ts`;
  `src/features/rover-pov/RoverPovPanel.tsx`.
- **Functionality/format:** JSON metadata and image URLs; SOLARA supports image browsing,
  contextual search by nearby historical traverse Sol, image resolutions, and a
  large image viewer.
- **Coverage/resolution:** Publicly released Perseverance raw images; page and result
  count are bounded by the Worker. NASA supplies per-image resolutions where available.
- **Authentication:** No API key in the image route. Worker caches a successful
  response for five minutes and can use stale cached data for a limited period.
- **Limitations:** The feed does not provide verified geodetic image coordinates or
  a validated ground-pointing solution. Rover site/drive and camera-frame vectors
  are preserved as source metadata but not misrepresented as map coordinates or
  camera bearing. The traverse association is Sol/time-based, not exact geolocation.
- **Attribution:** NASA/JPL-Caltech/MSSS; use the source image and metadata credits
  supplied with each record.

## NASA video/media sources

### NASA Image and Video Library

- **Status:** Integrated as a separate archived-video browser; not location-linked to
  a selected Mars point.
- **Official APIs:** [Search](https://images-api.nasa.gov/search?q=Perseverance%20Mars%26media_type%3Dvideo),
  [asset manifest](https://images-api.nasa.gov/asset/{nasa_id}),
  [metadata](https://images-api.nasa.gov/metadata/{nasa_id}),
  [captions](https://images-api.nasa.gov/captions/{nasa_id}); [NASA Images](https://images.nasa.gov/).
- **Provider:** NASA.
- **SOLARA use:** `src/data/adapters/nasaMarsVideoService.ts`;
  `src/features/rover-pov/NasaMarsVideoPanel.tsx`.
- **Functionality/format:** Search JSON metadata and asset-manifest JSON; playback is
  lazy-loaded in HTML `<video>` only for a manifest-provided MP4 on NASA's media host.
- **Coverage/resolution:** NASA's indexed Mars video items; varies by search result.
- **Authentication:** No key used by SOLARA.
- **Limitations:** Archived media, not live video and not evidence of the selected
  map position. Items without a playable MP4 link to NASA's source page instead.
  Metadata/manifest results use a short in-memory cache.
- **Attribution:** NASA title, credit and source item link are shown where supplied.

## Existing NASA geospatial services

### NASA Trek ArcGIS services and WMTS catalog

- **Status:** Integrated for datasets listed below; the catalog page also documents
  additional layers that SOLARA does not consume.
- **Official URLs:** [Mars WMTS documentation/catalog](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars),
  [Mars Trek app](https://trek.nasa.gov/mars/),
  [ArcGIS service root](https://trek.nasa.gov/mars/trekarcgis/rest/services).
- **Provider:** NASA Solar System Treks / NASA Trek.
- **SOLARA use:** `src/data/catalog/datasets.ts`; `src/map/trek/trekCapabilities.ts`;
  `src/map/trek/tileGrid.ts`; `src/map/layers/`;
  `scripts/prepare-jezero-assets.mjs`; prepared files under `public/data/mars/jezero/`.
- **Functionality/formats:** WMTS map tiles, ArcGIS MapServer GeoJSON queries and
  ImageServer identify/export data. Individual dataset endpoints are recorded below
  or in their catalog records.
- **Authentication:** No key used for integrated public services.
- **Limitations:** Trek's declared `urn:ogc:def:crs:EPSG::104905` is retained only as
  source metadata. Repository evidence identifies the working EQC layer as equivalent
  to IAU:2015:49910, on a Mars sphere with R=3,396,190 m. Several WMTS pyramids encode
  degree-based matrices despite metre CRS declarations. The map uses checked
  capabilities snapshots and analytic grid geometry; it does not blindly use service
  scale denominators. Trek missing tiles represent no coverage; outside-footprint
  requests are avoided.
- **Attribution:** Preserve the attribution in each dataset catalog record.

### USGS SIM 3292 global geology

- **Status:** Integrated as a prepared Jezero GeoJSON overlay.
- **Official URLs:** [Trek service](https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer),
  [USGS publication](https://pubs.usgs.gov/sim/3292/),
  [USGS map record](https://www.usgs.gov/maps/geologic-map-jezero-crater-and-nili-planum-region-mars).
- **Provider:** USGS Astrogeology Science Center; Tanaka et al. (2014).
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `scripts/prepare-jezero-assets.mjs`;
  `public/data/mars/jezero/geology/usgs-sim3292-jezero.geojson`;
  `src/map/layers/createGeojsonLayer.ts`; `src/map/MarsMap.tsx`.
- **Functionality/format:** Prepared GeoJSON geological-unit polygons; the Jezero crop
  currently contains two generalized units.
- **Coverage/resolution:** Generalized 1:20,000,000 compilation; kilometer-scale,
  not site-scale mapping.
- **Authentication:** No key.
- **Limitations:** Unit classes/legend follow source data, and should not be treated
  as local hazard mapping.
- **Attribution:** USGS SIM 3292, Tanaka et al., DOI [10.3133/sim3292](https://doi.org/10.3133/sim3292).

### IAU Jezero nomenclature

- **Status:** Integrated as one prepared feature label in OpenLayers.
- **Official URLs:** [Trek nomenclature service](https://trek.nasa.gov/mars/trekarcgis/rest/services/outreach_nomenclature/MapServer),
  [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/).
- **Provider:** IAU Working Group for Planetary System Nomenclature; service hosted
  through NASA Trek/USGS.
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `public/data/mars/jezero/science/iau-nomenclature.geojson`;
  `src/map/layers/createGeojsonLayer.ts`; selection in `src/map/MarsMap.tsx` and
  Habitat/Field Tablet Inspector panels.
- **Functionality/format:** GeoJSON name point and source properties/link.
- **Coverage/resolution:** Jezero named crater center in the prepared crop; no feature
  boundary is inferred from the point.
- **Authentication:** No key.
- **Limitations:** A point location is not a crater outline.
- **Attribution:** IAU WGPSN / USGS Gazetteer; source feature record is retained in
  the prepared GeoJSON.

### OMEGA / CRISM hydrous-mineral compilation

- **Status:** Integrated as a prepared raster overlay in OpenLayers.
- **Official URL:** [Trek Hydrous Mineral Detections MapServer](https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer).
- **Provider:** OMEGA on ESA Mars Express and CRISM on NASA MRO, compiled and served
  by NASA Trek.
- **SOLARA use:** `src/data/catalog/datasets.ts`;
  `scripts/prepare-jezero-assets.mjs`;
  `public/data/mars/jezero/rasters/hydrous-minerals-omega-crism.png` and JSON sidecar;
  `src/map/layers/createRasterOverlayLayer.ts`; `src/map/MarsMap.tsx`.
- **Functionality/format:** Prepared transparent PNG raster export with source extent
  and metadata sidecar; nearest-neighbor resampling preserves categorical detections.
- **Coverage/resolution:** Prepared Jezero vicinity crop 77.0–77.86°E, 18.05–18.88°N;
  1400 × 1400 pixels, about 36.4 m/pixel.
- **Authentication:** No key.
- **Limitations:** Compiled detections only; no per-class legend, abundance or
  confidence is inferred. Historical orbital data, not an in-situ mineral assay.
- **Attribution:** OMEGA/ESA Mars Express; CRISM/NASA MRO; NASA Trek compilation.

## Backend APIs and external services

### NASA PDS Atmospheres Node — Perseverance MEDA

- **Status:** Integrated through the Cloudflare Worker; values remain historical archive
  observations and are explicitly not called live weather.
- **Official URLs:** [MEDA archive documentation](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html),
  [PDS data base](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/).
- **Provider:** NASA PDS Atmospheres Node; MEDA team (NASA/JPL-Caltech and Spanish
  collaborators, including INTA/CAB).
- **SOLARA use:** `worker/src/meda.ts`; `worker/src/index.ts` route
  `/api/meda/environment/latest`; `src/data/adapters/medaService.ts`;
  `src/features/habitat-mode/components/EnvironmentalPanel.tsx` and Inspector.
- **Functionality/format:** Reads known PDS archive product CSVs for calibrated ATS
  and derived pressure/relative humidity/wind values; same-origin JSON response.
- **Coverage/resolution:** Product-level historical Perseverance in-situ observations;
  currently configured examples include ATS/PS/RHS on Sol 1859 and wind on Sol 313.
- **Authentication:** No key for the listed public PDS products. Worker allowlists the
  source hosts.
- **Limitations:** Sparse selected archive products, not a continuous feed; missing
  values remain missing; no current environmental conditions are claimed. Wind sensor
  damage and product-specific caveats are documented in code/catalog.
- **Attribution:** NASA/JPL-Caltech, MEDA instrument team and PDS Atmospheres Node.
  Instrument paper DOI [10.1007/s11214-021-00816-9](https://doi.org/10.1007/s11214-021-00816-9).

### NASA Mars weather RSS snapshot

- **Status:** Historical/static reference only; no runtime polling.
- **Official URLs:** [MSL weather feed](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json),
  [Mars 2020 weather feed](https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json).
- **Provider:** NASA Mars public RSS API.
- **SOLARA use:** `src/science/environment/weatherContext.ts` and validation/reference
  for `src/science/environment/marsTime.ts`.
- **Functionality/format:** Historical JSON snapshot for stale-data labels and algorithm
  comparison.
- **Coverage/resolution:** Selected records are mission-specific (MSL/Gale and sparse
  Perseverance/MEDA); not a Jezero current-weather station feed.
- **Authentication:** No key.
- **Limitations:** Data is stale and not current weather or forecast. The app shows
  the product's date/sol and limitations.
- **Attribution:** NASA mission RSS source.

### NASA GISS Mars24 algorithm

- **Status:** Integrated as a documented, validated calculation; no runtime API calls.
- **Official URL:** [Mars24 algorithm](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html).
- **Provider:** NASA Goddard Institute for Space Studies; algorithm based on
  Allison & McEwen (2000).
- **SOLARA use:** `src/science/environment/marsTime.ts` and Habitat environment panel.
- **Functionality/format:** TypeScript implementation of Mars date, solar longitude
  and local solar time calculations.
- **Coverage/resolution:** Calculated from input UTC time and Mars longitude; output
  is model-derived, not an observation.
- **Authentication:** None.
- **Limitations:** Never present derived Mars time or solar longitude as observed
  surface conditions; implementation documents its validation and residuals.
- **Attribution:** NASA GISS Mars24 and Allison & McEwen (2000), bibliographic details
  in `src/science/environment/marsTime.ts`.

### OpenRouter chat completions (Mission Copilot)

- **Status:** Integrated server-side; not a science or imagery source.
- **Official URL:** [OpenRouter chat completions API](https://openrouter.ai/api/v1/chat/completions).
- **Provider:** OpenRouter and the configured model provider.
- **SOLARA use:** `src/features/copilot/copilotClient.ts` → `/api/copilot/chat` in
  `worker/src/index.ts`; local proxy in `vite.config.ts`; model setting in
  `worker/wrangler.toml`.
- **Functionality/format:** Worker validates conversation/context JSON, injects
  scientific honesty constraints and calls the OpenRouter chat completion API.
- **Authentication:** `OPENROUTER_API_KEY` is a Worker secret; never a `VITE_*` value.
  `OPENROUTER_MODEL` is a non-secret Worker variable.
- **Limitations:** Worker has no authentication or rate limiting and is local-development
  oriented until deployment protections are added. AI output is not a verified science
  source and cannot inspect map pixels.
- **Attribution/license:** Follow the configured model provider terms; no AI output
  replaces source data or scientific provenance.

### Cloudflare Workers / Wrangler

- **Status:** Integrated for Copilot, MEDA, and Perseverance image proxy routes.
- **Official URLs:** [Cloudflare Workers](https://developers.cloudflare.com/workers/),
  [Wrangler](https://developers.cloudflare.com/workers/wrangler/).
- **Provider:** Cloudflare.
- **SOLARA use:** `worker/src/index.ts`, `worker/src/roverImages.ts`,
  `worker/src/meda.ts`, `worker/wrangler.toml`, `vite.config.ts`.
- **Functionality/format:** HTTP proxy/cache endpoints and local development server.
- **Authentication:** Application-specific upstream secrets are server-side only.
- **Limitations:** Local Worker routes are not public-ready without auth/rate limiting
  where appropriate. The Mars globe does not proxy Cesium ion requests.
- **Attribution:** Cloudflare service terms apply to deployment.

## Third-party libraries and frameworks

These packages implement SOLARA but are not Mars data providers. Exact installed
versions are in `package-lock.json`; dependency declarations are in `package.json`.

| Name and official URL | Where used | Functionality / format | Auth, limits and attribution |
|---|---|---|---|
| [React](https://react.dev/) and [React DOM](https://react.dev/) | `src/App.tsx`, `src/main.tsx`, all feature components | React UI, lazy-loaded habitat/tablet/globe components | No auth; React licenses apply. |
| [OpenLayers](https://openlayers.org/) | `src/map/MarsMap.tsx`, `src/map/layers/`, `src/map/projections/` | 2D scientific raster/vector map, selection and routing presentation | No auth. Mars projection configuration remains in SOLARA's verified CRS registry. |
| [proj4](https://proj.org/) / [Proj4js](https://github.com/proj4js/proj4js) | `src/map/projections/ProjectionRegistry.ts` | Mars CRS registration and coordinate transforms | No auth; planetary CRS definitions must remain explicit and documented. |
| [CesiumJS](https://cesium.com/platform/cesiumjs/) | `src/features/mars-globe/MarsGlobe.tsx` | 3D Tiles/WebGL renderer | Apache-2.0 code; separate ion content terms above. |
| [Vite](https://vite.dev/) and [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | `vite.config.ts`, `package.json` | Dev server, code splitting, production build | No external data; `vite-plugin-static-copy` copies Cesium assets at build/dev. |
| [vite-plugin-static-copy](https://github.com/sapphi-red/vite-plugin-static-copy) | `vite.config.ts` | Serves/copies Cesium `Workers`, `ThirdParty`, `Assets` and `Widgets` | No data access or credentials. |
| [Tailwind CSS](https://tailwindcss.com/) and [@tailwindcss/vite](https://github.com/tailwindlabs/tailwindcss) | `src/index.css`, component class names, `vite.config.ts` | Utility styling with the repository's monochrome design tokens | No external font or image requests. |
| [IBM Plex Sans](https://github.com/IBM/plex) and [IBM Plex Mono](https://github.com/IBM/plex) via [Fontsource](https://fontsource.org/) | `src/index.css`, `package.json` | Locally bundled fonts | No Google Fonts request. IBM font licenses apply. |
| [Lucide](https://lucide.dev/) / `lucide-react` | Feature and UI components | UI icons | No auth; icons are bundled locally. |
| [class-variance-authority](https://cva.style/), [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) | `src/components/ui/`, `src/lib/utils.ts` | Component variants and class composition | No data services. |
| [TypeScript](https://www.typescriptlang.org/) | All `.ts` / `.tsx` files | Type checking/build-time language | No runtime data. |
| [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/) | `worker/wrangler.toml`, npm scripts | Worker development/deployment tooling | No client data source by itself. |

## Scientific references and documentation

### Mars coordinate reference systems

- **Status:** Integrated as policy and verified coordinate metadata.
- **Official URL:** [IAU/VESPA CRS registry — Mars](https://voparis-vespa-crs.obspm.fr/web/mars.html),
  [registry entries](https://voparis-vespa-crs.obspm.fr/web/all_ids.html).
- **Provider:** IAU Working Group on Cartographic Coordinates and Rotational Elements,
  hosted by VO Paris/VESPA.
- **SOLARA use:** `Architecture.md` §6.1; `src/lib/marsCrs.ts`;
  `src/map/projections/ProjectionRegistry.ts`; `src/map/trek/tileGrid.ts`;
  `src/features/mars-globe/MarsGlobe.tsx`.
- **Functionality:** Documents the IAU Mars CRS values and explicit handoff between
  Cesium's Mars ellipsoid representation and SOLARA's east-positive, planetocentric
  Mars sphere/equirectangular coordinates.
- **Format/API:** CRS registry WKT/registry pages; not a runtime API.
- **Authentication:** None.
- **Limitations:** Cesium Mars publishes IAU_2015:49901 (Mars 2015 Ographic), whereas
  SOLARA's internal map uses a spherical equirectangular projection. The globe hands
  off longitude/planetocentric latitude, converts the latitude for the ellipsoid, and
  computes map metres analytically; Cesium Cartesian coordinates are never passed to
  OpenLayers. Verify surface alignment when a live ion token is available.
- **Attribution:** IAU CRS registry; see the repository CRS audit in `Architecture.md`.

### NASA PDS and Mars archive documentation

- **Status:** Supports the implemented MEDA archive adapter.
- **Official URLs:** [PDS Atmospheres MEDA documentation](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html),
  [MEDA PDS data bundle](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/).
- **Provider:** NASA Planetary Data System nodes.
- **SOLARA use:** MEDA archive source in `worker/src/meda.ts`; this is not a general
  PDS search or download integration.
- **Format/API:** PDS product labels, archive documentation and data files.
- **Coverage/resolution:** Product-specific; see each dataset's entry above.
- **Authentication:** Public records; the current PDS sources used by SOLARA need no
  key.
- **Limitations:** Source-specific labels and product metadata take precedence over
  assumptions from a viewer or file extension.
- **Attribution:** NASA/PDS and contributing instrument teams.

## Licensing and attribution notes

- The repository code is licensed under Apache-2.0 (`LICENSE` and `package.json`).
  This does not grant rights to third-party data, hosted services, trademarks or
  dependencies. No blanket license is asserted for the listed scientific data.
- Dataset credits are stored in the catalog and displayed in dataset details; the
  globe keeps Cesium's credit display and its separate ion data attribution visible.
  Follow the upstream product and service terms when redistributing or deploying.
- The package manifest and lockfile identify dependencies, but the repository does
  not include a complete third-party dependency license report. Verify applicable
  notices/licenses for a distribution that bundles those dependencies.
- Before public deployment, confirm that the Cesium ion account/plan permits the
  intended use, retain its required credits, and restrict the browser token. The
  local Worker has no authentication or rate limiting and is not public-deployment
  ready.

## Adding or updating a source

1. Verify the official product/service documentation, real response, metadata, CRS,
   extent, resolution and authentication from the intended browser/Worker environment.
2. Add the source behind a dedicated adapter or dataset catalog record; retain the
   original endpoint, product ID, provenance, timestamp and source-defined limits.
3. Record whether SOLARA integrates, derives from, or only investigates the source.
   Never list a candidate as an active layer until its data path has been validated.
4. Add a section here with every item in the source template (provider, format,
   coverage/resolution, auth, limitations and attribution), and update `.env.example`
   only for non-secret configuration names. Never commit real credentials.
