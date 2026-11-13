# SOLARA — Architecture and Technical Workflow

> **Purpose of this document:** Define the proposed technical architecture, scientific data pipeline, internal application interfaces, and end-to-end workflows. This is a design contract, not evidence that any integration has already been implemented.

## 1. Architecture status

The stack below is the agreed starting direction for the MVP. The repository must be inspected before dependencies are installed or existing files are changed.

### Agreed stack

| Concern | Technology | Responsibility |
|---|---|---|
| UI | React 19 | Application interface |
| Language | TypeScript | Typed application and scientific data contracts |
| Build/dev server | Vite | Local development and production build |
| Styling | Tailwind CSS 4 | Layout and design tokens |
| UI primitives | shadcn/ui | Accessible, customizable components |
| Icons | Lucide React | Interface icons |
| Map renderer | OpenLayers | Raster/vector map, pan/zoom, map interactions |
| Coordinate transforms | Proj4js | Custom Mars projection definitions and transforms |
| Scientific preprocessing | Python + GDAL | Inspect, crop, reproject, derive, and prepare raster/vector data |
| Route search | A* (A-star) | Search a DEM-derived terrain-cost grid |
| Background work | Web Workers | Route search and other CPU-heavy browser work |
| Initial deployment | Cloudflare Pages | Static frontend and prepared assets |
| Source control | GitHub | Version history and collaboration |

### Deliberately excluded initially

Do not add Next.js, TanStack Start, Three.js, React Three Fiber, Drei, Cesium, Redux, Supabase, or a database unless repository inspection or a demonstrated requirement gives a concrete reason.

The MVP is primarily a client-side scientific mapping application. A backend is not required by default.

A Cloudflare Worker or other server component may be considered later only if a real issue requires proxying, caching, controlled access, or server-side processing. Do not create one pre-emptively.

## 2. High-level architecture

```text
                  NASA / USGS / PDS DATA SOURCES
       CTX | HiRISE | MOLA | PLACES | USGS GEOLOGY
               MEDA | MARCI | MCS | THEMIS
                            |
                            v
               DATA DISCOVERY & VALIDATION
          capabilities | files | metadata | coverage
                CRS | resolution | timestamps
                            |
                            v
               OFFLINE PREPROCESSING PIPELINE
          Python / GDAL / format-specific inspection
           crop | reproject | derive | validate | tile
                            |
                            v
                PREPARED DATA CATALOG / ASSETS
            static JSON + raster/vector/tile resources
                            |
             +--------------+--------------+
             |                             |
             v                             v
      HABITAT MODE                  FIELD TABLET MODE
      desktop planning              touch-first execution
             |                             |
             +--------------+--------------+
                            |
                            v
                   SHARED REACT APP
       mission model | map state | layer catalog | panels
                            |
              +-------------+-------------+
              |                           |
              v                           v
        OPENLAYERS MAP              SCIENTIFIC ENGINE
        raster/vector layers        elevation / slope
        source overlays             route cost / A*
        map interactions            route profile / metrics
              |                           |
              +-------------+-------------+
                            |
                            v
                 MISSION PLAN / SUMMARY
            provenance | route | waypoints | caveats
```

The browser should normally consume prepared, appropriately sized data. Large raw scientific archives should not be downloaded or decoded in the user's browser.

## 3. Application module boundaries

Adapt this structure to the actual repository rather than forcing a rewrite.

```text
src/
  app/
    App.tsx
    router/
    providers/
  components/
    layout/
    controls/
    data-status/
    charts/
  features/
    mars-explorer/
      components/
      hooks/
    habitat-mode/
      components/
    field-tablet-mode/
      components/
    surface-intelligence/
      layer-catalog/
      provenance/
    mission-planner/
      components/
      mission-model/
  map/
    MarsMap.tsx
    layers/
    sources/
    interactions/
    projections/
  science/
    elevation/
    slope/
    terrain-cost/
    routing/
    rover/
    environment/
    imagery/
  data/
    catalog/
    adapters/
    schemas/
  workers/
    route.worker.ts
  lib/
    geometry/
    units/
    validation/
  styles/
```

Suggested static data locations, if the repo uses public assets:

```text
public/
  data/
    catalog/
    mars/
      jezero/
        vectors/
        rasters/
        imagery/
        rover/
        environment/
```

Do not place large raw archives in Git. Store small, prepared MVP assets or use documented external services. If large files are needed, determine a suitable hosting strategy before committing them.

## 4. Scientific data pipeline

Every dataset must pass through a documented pipeline.

### Step 1 — Discover and inspect

For each source, record:

- Exact source URL and responsible provider.
- Mission and instrument, if applicable.
- Dataset/product identifier and version/release.
- Data type and intended use.
- Spatial footprint and coordinate reference metadata.
- Pixel size / spatial resolution and units.
- Acquisition or observation time range.
- File format and access method.
- Known limitations, missing data, and quality notes.
- Attribution and usage terms.
- Verification status and date checked.

Do not infer these fields from a dataset name. Inspect the product metadata or service capabilities.

### Step 2 — Validate geographic coverage

Before choosing a source for a route, check that the dataset actually covers the selected area. A global product and a local high-resolution product serve different purposes.

The initial detailed target is Jezero Crater, but it remains subject to a data audit. Verify that the imagery, DEM, geology, rover data, and any environmental observations overlap the intended demonstration area.

### Step 3 — Prepare data outside the browser

Use Python/GDAL and format-appropriate tools to:

- Inspect raster metadata.
- Verify dimensions, data type, NoData values, units, and georeferencing.
- Crop large rasters to the actual area of interest.
- Reproject only when necessary and document the transformation.
- Generate derived slope or other terrain products from a validated DEM.
- Convert vector data into a browser-suitable format where appropriate.
- Produce overviews/tiles or cloud-optimized outputs where they improve delivery.
- Compare known control points and visually verify alignment.

Do not assume every GeoTIFF should be converted to the same format. Select an output format based on the source, browser requirements, deployment support, and size.

### Step 4 — Publish a source catalog

The application should read a catalog that describes datasets. Do not hard-code source details throughout map components.

A proposed catalog record:

```ts
export type DatasetKind =
  | "optical"
  | "topography"
  | "geology"
  | "rover"
  | "thermal"
  | "spectral"
  | "atmospheric"
  | "radiation"
  | "other";

export type VerificationStatus =
  | "unverified"
  | "inspected"
  | "tested"
  | "integrated";

export interface SpatialReference {
  body: "Mars";
  authority?: string;
  proj4?: string;
  wkt?: string;
  datum?: string;
  coordinateSystem?: string;
  latitudeType?: "planetocentric" | "planetographic" | "not-applicable";
  longitudeDirection?: "east" | "west" | "not-applicable";
  units?: string;
  sourceDefinition: string;
}

export interface DatasetRecord {
  id: string;
  title: string;
  provider: string;
  mission?: string;
  instrument?: string;
  productId?: string;
  kind: DatasetKind;
  description: string;
  sourceUrl: string;
  accessMethod: "wmts" | "wms" | "xyz" | "geotiff" | "geojson" | "csv" | "api" | "download" | "other";
  assetUrl?: string;
  spatialReference: SpatialReference;
  coverageDescription: string;
  spatialResolution?: number;
  resolutionUnit?: string;
  observationStart?: string;
  observationEnd?: string;
  units?: string;
  attribution: string;
  limitations: string[];
  verification: VerificationStatus;
  lastVerifiedAt?: string;
}
```

The catalog schema can be adjusted after inspecting actual source metadata. Keep the source's original CRS description even if a normalized working projection is also used.

## 5. Candidate scientific sources

These are candidate sources identified during project research. Listing a source here does **not** mean it has already been downloaded, tested, aligned, or integrated.

| Source | Candidate use | Required verification |
|---|---|---|
| NASA MRO CTX Jezero mosaic / Trek WMTS | Optical surface context | Inspect WMTS capabilities, matrix set, CRS, extent, resolution, attribution, CORS, and actual tile responses |
| Mars 2020 PLACES | Perseverance localization / traverse and local products | Inspect archive files, schemas, release notes, coordinate conventions, missing records, and file integrity |
| HiRISE products | Higher-resolution local terrain and imagery, if available for target area | Verify exact product footprints, DEM/image pairing, resolution, and metadata |
| MOLA / USGS MOLA DEM | Global topographic context | Verify version, grid definition, units, CRS, and resolution; do not use as local hazard-scale terrain |
| USGS Jezero geological map | Geological formations and science targets | Verify georeferencing, legend, vector/raster availability, and licensing/attribution |
| THEMIS | Thermal context | Verify exact product, spatial coverage, temporal meaning, units, and whether it supports the chosen region |
| MEDA | Local Perseverance environmental observations | Verify instrument products, time coverage, location metadata, data access, and interpretation |
| MARCI / MCS | Regional or global atmospheric/dust context | Verify product dates, spatial/temporal resolution, coverage, and whether data is historical or modelled |

Known research references to inspect, not blindly assume:

- NASA Trek CTX capabilities document: `https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml`
- Mars 2020 PLACES archive: `https://pds-geosciences.wustl.edu/missions/mars2020/places.htm`
- MOLA archive: `https://pds-geosciences.wustl.edu/missions/mgs/megdr.html`
- USGS MOLA DEM: `https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m`
- USGS Jezero geological map: `https://www.usgs.gov/maps/geologic-map-jezero-crater-and-nili-planum-region-mars`
- THEMIS global daytime infrared mosaic: `https://astrogeology.usgs.gov/search/map/mars_odyssey_themis_ir_day_global_mosaic_100m_v12`

The challenge-specific resource list may contain additional or preferred sources. Add those after inspecting the official challenge resources. Do not delay basic architecture work while waiting for them.

## 6. Coordinate reference system policy — critical

Mars data does not automatically use Earth's WGS84 / EPSG:4326 coordinate system.

Datasets may differ in:

- Planetary datum or reference sphere/ellipsoid.
- Planetocentric versus planetographic latitude.
- East-positive versus west-positive longitude.
- Longitude domain and axis order.
- Projection type and central meridian.
- Units and pixel registration conventions.

Rules:

1. Never assign EPSG:4326 to Mars coordinates simply to make a library accept them.
2. Preserve original source CRS metadata.
3. Inspect each source's PDS label, map projection metadata, service capabilities, or authoritative documentation.
4. Define a Mars projection only from verified parameters.
5. Transform data into a common working projection only when the transformation is understood and documented.
6. Verify imagery, DEM, geology, rover tracks, and landmarks against known control points.
7. Record transformation method and resampling method.
8. If CRS metadata is missing or ambiguous, do not silently align or display the dataset as accurate.

Use Proj4js for coordinate transformations where appropriate and OpenLayers custom projections for mapping. The exact working projection must be selected after auditing the chosen source products, not guessed in advance.

### 6.1 Verified CRS resolution — Jezero CTX Trek layer (Milestone 0.1)

The NASA Trek WMTS document for the Jezero CTX mosaic declares `urn:ogc:def:crs:EPSG::104905` (as TileMatrixSet `SupportedCRS` and as the Layer `BoundingBox` crs attribute). Investigation on 2026-11-12 found that this URN does **not** resolve to the projected CRS the service actually serves:

- The official EPSG registry (apps.epsg.org) has **no** CRS 104905 (API returns 404). EPSG has not adopted planetary CRS definitions (LPSC 2025 abstract #1659).
- Under the **ESRI** authority, code 104905 is `ESRI:104905 "Mars 2000"` (`GCS_Mars_2000`) — a **geographic** CRS on the Mars 2000 ellipsoid (a = 3,396,190 m, 1/f = 169.894…), not a projected equirectangular CRS.

What the service actually serves was verified numerically (Milestone 0): an equirectangular (plate carrée) projection on the **Mars sphere**, R = 3,396,190 m, standard parallel 0°, natural origin 0°, false easting/northing 0, metre units. This matches the parameters of **IAU:2015:49910** ("Mars (2015) - Sphere / Equirectangular, clon = 0", official WKT2 from the IAU 2015 CRS registry; base geographic CRS IAU:2015:49900, anchor: Viking 1 lander at 47.95137°W). PROJ's own export of IAU:2015:49910 is exactly `+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs`, and the mosaic footprint matched this sphere math at all four advertised bounding-box edges.

Consequently:

- SOLARA uses **internal identifiers**, which make no authority claim:
  - `SOLARA:MARS_EQC_IAU2015` — the working projected CRS (metres).
  - `SOLARA:MARS_2000_SPHERE_LONLAT` — geographic lon/lat helper (degrees).
- The declared URN is preserved verbatim as **source metadata** in the catalog and capabilities parser, but SOLARA never presents its working projection as "EPSG:104905".
- On the IAU 2015 sphere, latitudes are planetocentric; planetocentric and planetographic latitudes are numerically identical on a sphere. Longitudes are east-positive.

The WMTS **tile matrix** itself is a degree-based plate carrée pyramid (TopLeftCorner −180°, 90°; 256×256 tiles; matrix sizes 2^(L+1) × 2^L), which is inconsistent with its metre-based declared CRS. The declared `ScaleDenominator` values are also inconsistent with the Mars sphere (they imply ~111,268 m per degree). SOLARA therefore derives tile resolutions from the verified matrix geometry (`resolutionMetres(L) = (360 / (matrixWidth(L) × tileWidth)) × 2πR/360` → level 13 ≈ 5.087 m/px) and converts the degree-based grid to working-projection metres analytically. A further implementation note: proj4's eqc forward transform flips the sign of y at exactly ±90° latitude (verified on proj4 2.22.0), so pole coordinates (grid origin, world extent) are computed analytically as ±πR/2.

## 7. Map and layer architecture

OpenLayers owns map rendering and map interactions. React owns the surrounding application UI.

Recommended responsibilities:

- `MarsMap`: creates and owns the OpenLayers map instance.
- `ProjectionRegistry`: registers verified Mars projections.
- `DatasetCatalog`: reads validated dataset metadata.
- `LayerFactory`: converts a catalog record into the correct OpenLayers layer/source.
- `LayerManager`: controls visibility, order, opacity, and status.
- `MapSelection`: handles coordinate readout, clicked points, selected targets, and waypoints.
- `ProvenancePanel`: shows the selected layer's source and limitations.

Do not put a live OpenLayers `Map`, `Layer`, `Source`, or other mutable OpenLayers object into React state. Keep those objects in refs or a dedicated map controller. Store only serializable UI state in React.

Layer types should be selected according to the real service or prepared asset:

- WMTS/WMS/XYZ for verified map services.
- GeoTIFF/COG or tile outputs for prepared raster products.
- GeoJSON or another suitable vector tile format for geology, rover traverses, and waypoints.

Do not claim a NASA endpoint is usable until a real request has been tested from the application environment.

### 7.1 Tile loading and failure semantics (Milestone 0.1)

Trek CTX tiles use a fetch-based tile loader (the pattern documented by OpenLayers) so that HTTP status and response content type can be recorded per tile before the tile enters the error state. Failure kinds are classified as `http-404`, `http-server`, `http-other`, `network-error`, `invalid-response`, or `unknown`. Successful responses are decoded from blob URLs (fetch satisfies CORS; blob URLs keep the map canvas untainted) and revoked after load.

The map combines the per-tile failure kind with the advertised mosaic footprint:

- A tile whose extent lies fully **outside** the advertised footprint (the verified service behaviour: HTTP 404) is **expected no-data**. It is counted separately and must not make the map look broken or trigger error styling.
- Any failure **inside** the footprint (404 where imagery should exist, 5xx, network failure, non-image response) is a **genuine failure** and is always surfaced to the user with its cause.

Tile counters are per view state: they reset on resolution change (a different tile-pyramid level is requested) and keep accumulating while panning within a level. While the first tiles are still loading, an explicit loading presentation is shown instead of an empty map.

### 7.2 Live verification vs verified snapshot (Milestone 0.1)

The map is always built from the **verified snapshot configuration** embedded in the code — never from the live capabilities document at runtime. A separate, non-blocking live check re-fetches the Trek capabilities document and compares a grid fingerprint against the snapshot:

- `checking` — re-verification in progress; map already displays.
- `live` — live document matches the verified configuration.
- `schema-changed` — live document differs; snapshot remains in use and the discrepancy is reported.
- `unavailable` — live check failed (network, non-200, invalid content); snapshot remains in use and tile requests still go to the live service, so outages surface as classified tile errors.

The UI must never claim reachability that has not been confirmed, and a temporary capabilities outage must never prevent the map from displaying.

## 8. Terrain analysis and route planning

### 8.1 Inputs

The route engine requires:

- A validated DEM covering the selected area.
- Correct horizontal coordinate reference and horizontal units.
- Correct elevation units and vertical reference.
- Known pixel spacing / georeferencing.
- NoData handling.
- Start and destination points transformed into the DEM grid.
- Explicit route-cost settings.

### 8.2 Derived terrain

Slope may be calculated from local elevation gradients:

```text
slopeRadians = atan(sqrt((dz/dx)^2 + (dz/dy)^2))
slopeDegrees = slopeRadians * 180 / PI
```

This is valid only when `dx`, `dy`, and elevation units are understood and compatible. Use appropriate edge handling and mark invalid/NoData cells.

Other derived measures, such as roughness, may be calculated only when the source resolution and method justify them. Do not label a simple slope calculation as a complete hazard detector.

### 8.3 Cost surface

A preliminary cost model may combine distance with terrain penalties:

```text
stepCost = distanceCost
         + slopePenalty
         + roughnessPenalty
         + knownHazardPenalty
```

The exact formula, weights, and any hard slope limits must be documented, configurable, and validated against authoritative references or clearly stated prototype assumptions. Do not invent astronaut mobility thresholds and present them as NASA-approved constraints.

NoData or insufficiently mapped cells must be treated as **unknown**, not automatically safe or traversable. Depending on the selected planning policy, the algorithm may avoid them or mark routes through them as unknown-risk segments.

### 8.4 A* route search

Use A* on a grid derived from the validated DEM/cost surface.

- Nodes represent raster cells or another explicitly defined terrain discretization.
- Edges represent allowed neighboring movements.
- Edge costs combine movement distance and terrain penalties.
- The heuristic estimates remaining ground distance to the destination.
- Use a heuristic consistent with the cost units; if all edge costs are at least ground distance, a straight-line ground-distance heuristic can remain admissible.
- Diagonal movement must not allow corner-cutting through blocked cells.
- Enforce a documented neighborhood policy (for example, 8-connected grid).
- Keep route search in a Web Worker to avoid freezing the UI.
- Return the route geometry plus metrics and limitations.

Distance must be calculated using a Mars-appropriate ground-distance method or a verified local projection scale. Do not treat arbitrary projected map units as metres.

### 8.5 Route output

```ts
export interface Coordinate {
  x: number;
  y: number;
  crsId: string;
}

export interface RouteWaypoint {
  id: string;
  coordinate: Coordinate;
  label: string;
  purpose?: string;
}

export interface RouteMetrics {
  distanceMeters: number;
  ascentMeters?: number;
  descentMeters?: number;
  minElevationMeters?: number;
  maxElevationMeters?: number;
  estimatedDurationMinutes?: number;
}

export interface RouteResult {
  id: string;
  algorithm: "astar";
  status: "complete" | "partial" | "no-path" | "invalid-input";
  coordinates: Coordinate[];
  metrics?: RouteMetrics;
  warnings: string[];
  unknownDataSegments: number;
  sourceDatasetIds: string[];
  costModelVersion: string;
  assumptions: string[];
  generatedAt: string;
}
```

Do not display an estimated duration unless the movement-speed assumptions are explicit and configurable. Never label the route “safe” or “NASA approved”. Use “proposed route” or “lowest estimated terrain-cost route”.

## 9. Internal application interfaces

The MVP does not require a public HTTP API. The phrase “API” here means internal TypeScript service contracts between the UI, map, data adapters, and scientific engine.

Proposed service responsibilities:

```ts
export interface DatasetCatalogService {
  getAll(): Promise<DatasetRecord[]>;
  getById(id: string): Promise<DatasetRecord | undefined>;
  getForArea(areaId: string): Promise<DatasetRecord[]>;
}

export interface EnvironmentalObservation {
  id: string;
  datasetId: string;
  parameter: string;
  value: number;
  unit: string;
  observedAt: string;
  latitude?: number;
  longitude?: number;
  locationDescription?: string;
  qualityNote?: string;
}

export interface TerrainQueryService {
  getElevationAt(point: Coordinate): Promise<{
    elevationMeters: number | null;
    status: "available" | "nodata" | "outside-coverage" | "error";
    datasetId?: string;
  }>;
  getSlopeAt(point: Coordinate): Promise<{
    slopeDegrees: number | null;
    status: "available" | "nodata" | "outside-coverage" | "error";
    datasetId?: string;
  }>;
}

export interface RoutePlanningService {
  plan(input: {
    start: Coordinate;
    destination: Coordinate;
    waypoints?: RouteWaypoint[];
    demDatasetId: string;
    costModelId: string;
  }): Promise<RouteResult>;
}
```

Additional adapters can expose rover imagery and environmental observations. Keep each external source behind a dedicated adapter so the rest of the app does not depend on source-specific response formats.

Do not invent NASA REST endpoints. First inspect the source documentation, service capabilities, data labels, and example responses. Normalize the real response into internal types only after verification.

## 10. End-to-end user workflows

### 10.1 Habitat Mode workflow

1. Load the Mars overview and verified dataset catalog.
2. Select the detailed region.
3. Show only datasets whose coverage includes the selected area.
4. Enable imagery, geology, topography, rover, and environmental layers as available.
5. Inspect source provenance and timestamps.
6. Select a start point, destination, and optional science waypoints.
7. Validate that the route area is covered by a suitable DEM.
8. Generate the terrain cost surface and A* route in a Worker.
9. Display the route, distance, elevation profile, warnings, and unknown-data segments.
10. Save/export a mission plan.

### 10.2 Field Tablet Mode workflow

1. Open/import a prepared mission plan.
2. Load the matching local map area and selected data.
3. Display the route, next waypoint, and selected location.
4. Show concise target details, relevant surface images, and environmental observations.
5. Clearly show observation timestamps and data freshness.
6. Allow the user to view route alternatives or mark an observation only if that behavior is actually implemented.
7. Preserve mission access when remote data services are unavailable, using locally prepared data where supported.

The MVP may use manual position selection or a clearly labelled simulated position. Do not claim live Mars positioning.

### 10.3 Mission plan model

A mission plan should be serializable and independent of OpenLayers objects.

```ts
export interface MissionPlan {
  id: string;
  title: string;
  regionId: string;
  createdAt: string;
  start: Coordinate;
  destination: Coordinate;
  waypoints: RouteWaypoint[];
  route?: RouteResult;
  selectedDatasetIds: string[];
  notes?: string;
  dataSnapshot: {
    datasetIds: string[];
    preparedAt: string;
    limitations: string[];
  };
}
```

For a no-backend MVP, export/import JSON or another small, documented package. Do not promise cross-device automatic synchronization. A future backend may add that if required.

## 11. Data freshness and environmental information

Environmental data can be historical, delayed, modelled, or observed at a different location.

Every environmental display must include, when available:

- Instrument or source.
- Observation timestamp / Martian sol.
- Measurement location or coverage.
- Parameter and units.
- Whether it is measured, derived, or modelled.
- Data-quality notes.

Do not label a historical MEDA observation as the current weather at the astronaut's position. Do not create an alert from an arbitrary threshold without a justified threshold and suitable data. A regional dust observation is not automatically a local surface storm warning.

## 12. Performance rules

- Load only datasets and extents required for the current view.
- Use tiling, overviews, or cropped regional assets for large rasters.
- Do not fetch global high-resolution data for a local route.
- Use lazy loading for major application workspaces. (Implemented in Milestone 0.1: the OpenLayers-based map workspace is code-split via React.lazy + Suspense so the initial shell loads without the map engine chunk.)
- Keep OpenLayers objects outside React state.
- Use Web Workers for A* and expensive raster calculations.
- Avoid repeatedly parsing large rasters on the main thread.
- Debounce expensive map queries.
- Show loading, error, no-coverage, and stale-data states.
- Cache only data with clear size and invalidation rules.
- Measure performance with real prepared datasets; do not assume small sample data represents production behavior.

## 13. Testing and scientific validation

Minimum validation before claiming an integration works:

1. Source file or endpoint can be accessed from the intended environment.
2. Metadata and CRS are read and recorded.
3. Spatial extent is known.
4. Dataset displays at the correct location.
5. At least several known coordinates/control points are checked.
6. Layer alignment is visually and numerically inspected.
7. Units and NoData values are verified.
8. Any derived slope values are checked against a known sample or independent calculation.
9. Route output is checked for valid start/end, continuity, prohibited cells, and distance consistency.
10. Data provenance and limitations are visible in the UI.

Add unit tests for coordinate conversion, distance calculations, slope calculations, cost-surface behavior, and route search. Add a small fixed test raster with known values so algorithm changes can be checked reproducibly.

## 14. Deployment and external services

The initial build should be deployable as a static Vite application on Cloudflare Pages.

External NASA/USGS services may have CORS, request-rate, availability, or service-policy limitations. Test them from the browser before choosing direct client access.

If a required service cannot be accessed directly:

- Record the exact failure and evidence.
- Check whether its data can be downloaded and prepared for static hosting.
- Consider a minimal proxy/cache only if necessary and permitted.
- Do not silently replace the source with an unrelated dataset.

## 15. Implementation discipline for coding agents

Before coding:

1. Inspect the actual repository and Git status.
2. Read `Context.md`, `Architecture.md`, and `Design.md`.
3. Identify existing dependencies and implementation.
4. Propose a small implementation plan.
5. Do not replace the app framework or routing without a concrete reason.
6. Do not install dependencies until the need is clear.
7. Work in small, testable increments.
8. Run available type checks and production build after meaningful changes.
9. Do not claim tests passed unless they were actually run.
10. Summarize changed files, tests run, known gaps, and next steps.

## 16. Milestone 2 implementation record (as-built 2026-11-13)

This section records what was actually built for the Milestone 2 scope (multi-dataset layers, DEM elevation queries, terrain-cost routing, Field Tablet Mode, plan export/import). Where the as-built types differ from the earlier proposals in §8.5/§9/§10.3, this section is authoritative for the current code; §8/§9/§10 remain the design intent.

### 16.1 Data catalog and prepared assets

- `src/data/catalog/datasets.ts` holds 6 verified records: `jezero-ctx-mosaic-soc-008` (WMTS), `mola-hrsc-blend-200m-colorshade` (WMTS), `mola-hrsc-blend-200m-dem` (ArcGIS ImageServer query record — elevation **query only**, never drawn as a map layer), `usgs-sim3292-jezero` (GeoJSON geology), `perseverance-traverse-path` (GeoJSON, historical), `perseverance-landing-ellipse` (GeoJSON, historical). Each record carries per-dataset verification evidence, declared-vs-verified CRS text, and `verifiedServedLevels`.
- `src/map/trek/trekCapabilities.ts` embeds the verified WMTS capabilities XML snapshots (`VERIFIED_CAPABILITIES_XML_BY_ID`, keyed by dataset id) and parses them once. The map always builds from the snapshot; a live Trek fetch re-verifies by grid fingerprint only (§7.2 states: `checking | live | schema-changed | unavailable`).
- `public/data/mars/jezero/` contains prepared assets generated by `scripts/prepare-jezero-assets.mjs`: geology (2 units mNhm/HNt with USGS SIM 3292 attribution), traverse (332 sol-tagged segments), landing ellipse (1 polygon), and `rasters/mola-hrsc-dem-jezero-grid.json` — a 160×151 elevation grid (`solara-elevation-grid/1`) sampled from the live Trek ImageServer at 5-decimal precision, with `centreValidation` recording the live-vs-grid agreement (−2,520 m identify vs −2,509.5 m bilinear; diff 10.5 m) and `preparedAt` in UTC. The grid is the route worker's input and the main-thread elevation fallback; it is labelled "prepared <date>" wherever shown.
- WMTS level truncation: `createWmtsLayer` cuts the declared pyramid to `dataset.verifiedServedLevels` (CTX 14, MOLA colorshade 9) — levels beyond what Trek actually serves are never requested.

### 16.2 Elevation access (two paths, both honest)

- `src/data/adapters/demService.ts` — live identify against the Trek ImageServer (5-decimal coordinate cache; NoData → `unknown`). Used for the "Live DEM service query" readout with the query timestamp.
- `src/data/adapters/elevationGrid.ts` — parses the prepared grid asset (ol-free, reusable by worker and main thread). Used as the fallback readout, labelled with the prepared date and the centre-validation note. Every elevation display states which path produced it.

### 16.3 Terrain cost and routing

- `src/science/terrain/geometry.ts`: haversine on the Mars sphere R = 3,396,190 m. `src/science/terrain/cost.ts`: prototype model `cost = groundM × (1 + slopeCostPerDeg × slopeDeg)`, defaults `slopeCostPerDeg = 0.08`, `maxSlopeDeg = 35` (UI sliders). Explicitly labelled "Prototype thresholds — not operational safety limits".
- `src/workers/route.worker.ts`: A*, 8-connected, no corner cutting through blocked cells, unknown cells impassable, snapping of start/target to nearest valid cells (≤ 5 rings, snap distances become warnings). Slope per step from the 4-neighbour gradient (edge cells fall back to the available neighbours). Worker self-loads the prepared grid asset; `routeClient.ts` is a module singleton with typed error codes: `grid-not-loaded | start-outside | target-outside | start-unknown | target-unknown | no-path | invalid-params`.
- As-built `RouteResult` (in `src/science/terrain/cost.ts` / worker contract) differs from §8.5: it carries `points` (lon/lat/elevM/cumulativeGroundM/cumulativeCostM/slopeDeg), `snappedStart/snappedTarget`, `totalGroundDistanceM`, `totalCostM`, `costEquivalentDistanceM`, `directDistanceM`, `detourRatio`, `minMaxElevM`, `warnings[]`, and `provenance` (datasetId, gridResolutionNote, gridPreparedAt, costModelNote). Every summary surfaces the warnings and the "proposed terrain-cost candidate" wording; never "safe".

### 16.4 Mission state and plan files

- `src/features/mission/store.ts`: module singleton behind `useSyncExternalStore`; holds `start/target/route/params/position/gridMeta`. In-memory only — a page reload discards the route (documented; plans survive via export/import).
- Plan format `solara-plan/1`: `{ format, createdAt, start, target, params, route, note }`. Import validates format, restores params with defaults for missing numbers, and marks the state `importedAt` — the UI then shows "Plan imported <date> — displayed as loaded from the plan file; not re-verified against current terrain data."
- Field Tablet simulated position: tapping the map sets `position`, always displayed as SIMULATED (there is no Mars GPS). The nearest-route-point card (distance to nearest route point, remaining along route, elevation) recomputes on every position change.

### 16.5 Map composition

- Base layer order (bottom-first): MOLA colorshade under CTX mosaic, both modes. GeoJSON overlays (geology fills, traverse line, landing ellipse) load asynchronously with per-dataset error banners; the mission route layer is topmost.
- ol ScaleLine is made scale-correct by `setGetPointResolution((r) => r)` on the eqc projection (see AGENTS.md "OpenLayers quirks"): ol's default estimation measures Mars pixels on the Earth sphere (×(R⊕/R♂)·(1+cos φ)/2 error). Verified after fix: 5 km bar = 90 px at the fitted 55.44 m/px view; 10 km bar = 81 px at the tablet's 123.4 m/px fit.

### 16.6 Validation performed (2026-11-13)

- Browser (Playwright, msedge): route computed (13.34 km ground / 14.17 km cost-equivalent, warnings visible), elevation profile SVG, live elevation −2,642 m with timestamp, prepared-grid fallback labelled, all five layers toggled and pixel-verified (geology tint diff ≤ 63/255 on 8/35 sample points), plan export → import round-trip with "not re-verified" note, nearest-route-point card (167 m), tablet position chip SIMULATED, zero console errors at each step.
- Analytic: scale bar re-measured after the `getPointResolution` fix in both modes; view-centre check 77.42982°E/18.46611°N ↔ (4,589,629, 1,094,573) m reproduced after every MarsMap mount.
- `npm run typecheck` and `npm run build` pass; worker chunk built separately (`route.worker-*.js`, ~11 kB).