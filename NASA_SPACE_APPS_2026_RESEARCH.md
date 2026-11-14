# SOLARA — Free NASA / planetary data resources & winning plan

> **Implementation status (2026-11-14):** P0-A science waypoints, P0-B Mars24
> environment panel + weather freshness, P1-D hydrous-mineral overlay, P1-E IAU
> nomenclature label, and P1-F Copilot verified-facts/context refresh are
> implemented and browser-verified. See `AGENTS.md` module map for as-built
> locations.

Research pass: **2026-11-14** (hackathon weekend). Submission closes **Sun 15 Nov 2026, 23:59 local time**.
Everything marked **verified** below was exercised live on 2026-11-14 (commands + outputs in §8).
Anything not verified is explicitly flagged. No coverage, coordinates or scientific values are invented here.

---

## 0. TL;DR

1. We already satisfy the challenge's core ask (layered Martian map + route + destinations + provenance). The gap judges will notice is **"updates on current conditions"** and **named science stops**.
2. **New, verified, free, CORS-enabled, no-key data that fits in hours:**
   - `mars2020_waypoints` — 8 named Jezero waypoints (Jezero Crater, Western/Northern Delta Deposit, Western Breach, inflow/outflow channels). 6 fall inside our exploration bbox.
   - `outreach_nomenclature` — IAU feature names as GeoJSON (labels).
   - Trek ArcGIS `exportImage` — render CRISM/OMEGA hydrous-mineral and THEMIS chloride maps for any bbox as PNG.
3. **Do not build "live weather" on the public feeds.** Verified: the MSL/REMS feed's newest sol is **4995 / 2026-08-25** (≈81 days stale); the Perseverance (MEDA) feed has **7 sols, April 2024**, temperatures missing; the InSight API returns 2020 data. Ship a *data-freshness-aware environmental panel* instead — it is both honest and a judging strength.
4. Ship in this order: science stops → environmental context (season / local solar time, derived) → demo + disclosure artifacts. Everything else is post-submission.

---

## 1. Judging frame (verified)

- Event: NASA Space Apps Challenge 2026, "The Next Frontier", **14–15 Nov 2026**; submission opens Sat 09:00 and closes Sun 23:59 **local time**.
  - https://spaceappschallenge.org/about · https://spaceappschallenge.org/resources/participant-faqs
- Criteria (1–5 holistic): **Impact, Creativity, Validity, Relevance, Presentation**; local events 25% each per organiser summaries.
  - 2025 Judging Guidelines (still the published rubric PDF): https://spaceapps-v2-staging.s3.amazonaws.com/media/documents/Final_Space_Apps_2025_Judging_Guidelines_for_web.pdf
- Minimums: English; responds to the chosen challenge; **at least one NASA data source/resource**; demo ≤7 slides **or** ≤30 s video; all links public; AI use declared (AI-generated images/video watermarked); no NASA logo/branding in generated content.
- Global awards (10): Best Use of Science, Best Use of Data, Best Use of Technology, Galactic Impact, Best Concept, Most Inspirational, Best Storytelling, Global Connection, Art & Technology, Local Impact.
  - https://spaceappschallenge.org/ (2025 winners + award names)
- 2026-specific judging guide was due 2026-11-13; award list carried from 2025 pending that document. Re-check before submitting.

**Note on rules:** pre-event research is allowed; building features/UI before the start is not. Our repo work predates the event in part — the submission must present the *current* app honestly and the demo must reflect work product, not a claim of 48-hour authorship. Do not advertise pre-built code as hackathon-built.

---

## 2. Challenge fit (verbatim brief + where we stand)

> "create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions and could help a human explorer plan and carry out a successful Marswalk while conducting new and exciting science along the way."
> — https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map

| Brief element | SOLARA today | Gap |
| --- | --- | --- |
| Layered, integrated view | CTX mosaic + MOLA/HRSC topography + geology + traverse + landing ellipse | mineral/salt layers |
| Location or route | click-to-select, A* terrain-cost candidate, elevation profile | — |
| Multiple NASA missions | MRO/CTX, MGS/MEX (MOLA/HRSC), Mars 2020, USGS SIM 3292 | named science stops |
| Details of routes/destinations | route stats, warnings, nearest-route-point | destinations are anonymous points |
| Updates on current conditions | none | **biggest gap** |
| Conducting new/ exciting science | geology unit at selected point | no science-target rationale |

---

## 3. Verified data resources

All endpoints below answered **HTTP 200** on 2026-11-14 unless flagged. CORS checked with `Origin: http://localhost:5173`.

### 3.1 Already integrated (no action)

| Dataset | Endpoint | Status |
| --- | --- | --- |
| Jezero CTX mosaic (6 m) | `https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml` | integrated, CORS `*` |
| MOLA/HRSC blended color hillshade (200 m) | `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml` | integrated, CORS `*` |
| MOLA/HRSC DEM (S16, global) | `https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer` | integrated (identify + prepared grid) |
| SIM 3292 global geology | `https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer` | integrated |
| Perseverance traverse (332 segments, sols 14–1176) | `.../Perseverance_Traverse_Path/MapServer` | integrated |
| Perseverance landing ellipse | `.../perseverance_landing_ellipse/MapServer` | integrated |

### 3.2 New — high value, verified (recommended)

**A. `mars2020_waypoints` — named science waypoints (GeoJSON, CORS OK, no key)**
`https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020_waypoints/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`

Verified payload: 8 Point features with `name`, `template` (Trek bookmark page), `elevation`:

| Name | lon, lat | Inside our bbox (77.1604655–77.6991776 E, 18.2110274–18.7211945 N) |
| --- | --- | --- |
| Jezero Crater | 77.68735, 18.40820 | yes |
| Perseverance Landing Ellipse | 77.45666, 18.44627 | yes |
| Western Delta Deposit | 77.36500, 18.50500 | yes |
| Northern Delta Deposit | 77.54600, 18.63000 | yes |
| Western Breach | 77.28800, 18.49500 | yes |
| Western Inflow Channel | 77.20300, 18.58000 | yes |
| Northern Inflow Channel | 77.48000, 18.87000 | no (N of mosaic) |
| Outflow Channel | 78.71300, 18.70700 | no (E of mosaic) |

Label: **"Compiled waypoint bookmarks from NASA Trek; locations of geological interest, not a hazard or safety assessment."**
This is the single cheapest, highest-impact addition: it turns anonymous map clicks into a science itinerary.

**B. `outreach_nomenclature` — IAU feature names (GeoJSON, CORS OK)**
`.../outreach_nomenclature/MapServer/0/query?where=1%3D1&geometry=77.16,18.21,77.70,18.72&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=geojson`
Returns e.g. `clean_name: Jezero`, `type: Crater`, `link: http://planetarynames.wr.usgs.gov/Feature/14300`, `approval: Adopted by IAU`. Good for the place-name toggle and for provenance links.

**C. Hydrous-mineral detections (OMEGA/CRISM, compiled global map)**
`.../Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer` — global extent −179.9…179.8 E, −60.1…81.5 N; capabilities `Map,Query,Data`, formats incl. PNG32, max 2048².
Raster read path (verified): `.../MapServer/export?bbox=77.16,18.21,77.70,18.72&bboxSR=4326&imageSR=4326&size=256,256&format=png32&transparent=true&f=image` → 200 `image/png` (RGBA).
**Cold renders are slow** (needed a 90 s curl timeout; warm renders are fast) — prefetch once per region, never per frame.
Label: **"Compiled global mineral-detection map (OMEGA/CRISM-derived), coarse; indicative only."** Do not recolor or reclassify.

**D. Chloride / salt-bearing material (THEMIS)**
`.../Chloride_Salt_bearing_Material_THEMIS_clon0/MapServer` — global, −56…+23 N (covers Jezero). Same `exportImage` path.

**E. Aqueous mineral distribution options**
`.../Aquieous_Mineral_Distribution_Options_clon0/MapServer` — global, −66…+68 N.

**F. DEM / hillshade raster export (for cross-checks or a slope-shaded base)**
`.../Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?...&format=png&f=image` → 200 `image/png` (2.6 kB at 256²).
Also available: `Mars_MOLA_blend200ppx_HRSC_Shade_clon0dd_200mpp_lzw/ImageServer`.

**G. Full Trek ArcGIS service catalog (76 services, discoverability)**
`https://trek.nasa.gov/mars/trekarcgis/rest/services?f=pjson` (CORS reflects origin, `Access-Control-Allow-Credentials: true`).
Relevant others found: `mars2020_2` (`M2020_LSW4_ellipses_GCS_MARS`), `mars2020_waypoints`, `major_features`, `Mars_Fans_Glaciers_Gullies`, `RSLs_Gullies_New_IcyCraters_clon0`, `InSight_2018_ellipses`, `curiosity_hirise_mosaic` (Gale only — **no Jezero HiRISE mosaic** in Trek).

### 3.3 Weather / "current conditions" — verified but **stale** (read the labels!)

| Source | Endpoint | Verified 2026-11-14 | Honest label |
| --- | --- | --- | --- |
| MSL / REMS per-sol summary (CAB) | `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` | 4 745 sols, sols 1–4995; **newest = sol 4995, terrestrial 2026-08-25**, `ls: 341`, `season: Month 12`; temps/pressure present, wind fields `--` for latest; `disclaimer_en` says outreach-only | "Latest available in-situ weather (archive): sol 4995, 2026-08-25 — not current" |
| Perseverance / MEDA per-sol | `...&category=mars2020&feedtype=json` | **7 sols only, 2024-04-21…2024-04-27**, temps `--` | "Archive sample, April 2024 — no current MEDA feed via this API" |
| InSight weather | `https://api.nasa.gov/insight_weather/?api_key=…&feedtype=json&ver=1.0` | 200, but data is 2020 (sol 675 seen); lander ended Dec 2022 | "Mission ended 2022 — historical only" |
| MAAS2 mirror | `https://api.maas2.apollorion.com/` | not fetched this pass | Do not adopt without a live check; third-party mirror |
| MEDA derived dataset (HF) | `https://huggingface.co/api/datasets/juliensimon/mars-perseverance-weather` | exists, **CC-BY-4.0**, modified 2026-09-20, tabular/time-series | Post-event; verify provenance chain to PDS Atmospheres before use |

**Implication:** there is **no public endpoint that gives current Mars surface weather**. Anything that claims "live weather" in this app would be dishonest. Show latest-available sol + acquisition date + latency + the reason, and state that no current feed is published.

### 3.4 Other free resources (documented; not yet exercised this pass)

| Resource | Endpoint / entry | Use | Status |
| --- | --- | --- | --- |
| JPL Horizons | `https://ssd.jpl.nasa.gov/api/horizons.api` | Sun/planet ephemerides, solar distance, observer geometry | **verified 200** for Mars observer, 2026-11-14…16 |
| PDS ODE REST (Geosciences) | `https://oderest.rsl.wustl.edu/live2?query=…` (manual V2.1.6) | product search by bbox/instrument, observation angles, **incidence/emission/phase**, solar longitude | documented; my ad-hoc query returned empty → parameter names need the manual |
| PDS GDS REST | `https://oderest.rsl.wustl.edu/livegds` | MOLA PEDR points, LOLA, Diviner | documented |
| PDS Search API | `https://nasa-pds.github.io/pds-api/` (`/api/search/…`) | archive-wide discovery / DOI resolution | documented |
| USGS Astrogeology | `https://astrogeology.usgs.gov/search/map/…` (per-record URLs in our catalog) | source GeoTIFFs, geology publications | download-based; root `astrowebmaps.wr.usgs.gov` did not expose ArcGIS REST at the paths tried |
| NASA Open APIs | `https://api.nasa.gov/` (DEMO_KEY) | APOD (verified 200), images library, techport | low relevance |
| Mars24 algorithm (GISS) | `https://www.giss.nasa.gov/tools/mars24/help/algorithm.html` | Mars Sol Date, Ls, local mean solar time | reference algorithm — must be validated, not guessed |

---

## 4. Ranked integration plan

### P0 — ship before submission (hours)

**A. Science Stops overlay (`mars2020_waypoints`)**
- Where: new catalog record in `src/data/catalog/datasets.ts` (`accessMethod: 'api'`, `kind: 'other'`, verification `tested` with the evidence line), rendered through `src/map/layers/createGeojsonLayer.ts`, toggle in `MissionOperationsPanel` overlay group, selection routed to `InspectorPanel`.
- Implementation: `fetch` the GeoJSON once, `ol/format/GeoJSON` with `dataProjection: 'EPSG:4326'`, `featureProjection: SOLARA:MARS_EQC_IAU2015`. Add `setZIndex(90)` (below the route layer's 100; see AGENTS.md stacking rule). Cache the payload in `public/data/mars/jezero/` if the demo machine's network is uncertain — but keep the live URL as the verified source and record the snapshot date.
- UX: mono labels `STOP`; card shows name, lon/lat, elevation (0 in the source), Trek bookmark link, and "Inside/Outside exploration region" via `isInsideBoundingBox` (2 of 8 are outside — do not clamp, explain).
- Copy: "Compiled from NASA Trek's Mars 2020 waypoint bookmarks. Scientific points of interest — not a hazard, safety, or landing assessment."
- Effort: 2–3 h including typecheck/build.

**B. Environmental context panel (honest "conditions")**
- Season: compute Solar Longitude (Ls) from UTC with the **Mars24 published algorithm**; label `DERIVED`. Validate against the 4 745 `ls` values in the MSL feed (tolerance ±1° — the feed rounds to integers) before showing it; if validation fails, show "Unknown".
- Local mean solar time (LMST) for the selected longitude, plus sun elevation if implemented: label `DERIVED`; state the model (Mars24) and that it ignores local topography/dust.
- In-situ observation block: newest MSL sol (4995, 2026-08-25) with temperature min/max, pressure and `ls` **verbatim**, plus explicit rows:
  - `Source: REMS/MSL via CAB feed (outreach-grade summary)`
  - `Age: 81 days at time of research`
  - `Current in-situ weather: Unavailable — no public current feed (InSight ended 2022; MEDA feed last updated Apr 2024)`
- Where: `LocationPanel` / `InspectorPanel` "Environmental context" section; keep technical detail behind `Disclosure`.
- Effort: 3–4 h (math + validation is the bulk). Ship without the Ls math if time runs out — the freshness block alone closes the gap.

**C. Submission artifacts (do not leave to the last hour)**
- 30-second demo (≤30 s video, or ≤7 slides) following §7.
- AI-use disclosure statement (§7.3) on the project page.
- Public URL + repo link + data-source list with the exact endpoints in §3.

### P1 — next few hours, only if P0 is stable

**D. Mineral / salt overlay (compiled maps)**
- `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` first (best science fit for Jezero's delta), then `Chloride_Salt_bearing_Material_THEMIS_clon0`.
- Raster path: ArcGIS `exportImage` for the region bbox at a fixed size, as an `ol/layer/Image` with `ImageStatic` (bypasses the WMTS metre/degree mismatch entirely). Register as `tested` with the `exportImage` evidence; label "compiled global detection map".
- Effort: 2–3 h. Risk: opacity/legibility over CTX; default OFF.

**E. Place-name toggle (`outreach_nomenclature`)**
- Point GeoJSON with `clean_name` + IAU link; mono labels; default OFF; cap label density by zoom.
- Effort: 1 h.

**F. Copilot verified-facts refresh**
- Add the new dataset facts (waypoints count, mineral layers, weather freshness) to the server-side facts in `worker/src/index.ts`; keep the honesty guardrails.

### P2 — after the event

- PDS ODE product search around the route (observation angles, solar longitude per product) — real "multi-mission integration" depth.
- SPICE/Horizons-based illumination and shadow modelling for the traverse.
- On-demand HiRISE where available (none in Trek for Jezero — would require PDS/HiRISE request flow).
- MEDA derived dataset after provenance verification.

---

## 5. Implementation notes & snippets

### 5.1 Fetch pattern (no key, CORS OK)

```ts
const WAYPOINTS_URL =
  'https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020_waypoints/MapServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=true&f=geojson';

const res = await fetch(WAYPOINTS_URL); // 200, application/geo+json
if (!res.ok) throw new Error(`waypoints ${res.status}`);
const fc = await res.json(); // FeatureCollection, EPSG:4326 points
```

Do **not** pass `resultRecordCount` — this service rejects pagination (`Pagination is not supported`).

### 5.2 Raster export pattern

```ts
const bbox = '77.1604655,18.2110274,77.6991776,18.7211945';
const url =
  `https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/export` +
  `?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=1024,1024&format=png&transparent=true&f=image`;
// bind as ImageStatic with the same extent (already in lon/lat), or ol/proj from 4326.
```

Use `ImageServer/exportImage` for DEM/hillshade; `MapServer/export` for vector-derived map services. Both return `f=image` PNGs directly (verified for the DEM and for the hydrous-mineral MapServer). Budget a long timeout on first render and cache the PNG.

### 5.3 Season / local time

- Follow the **Mars24 algorithm** (GISS technical notes, URL in §3.4). Do not hand-roll a "close enough" Ls formula — that is exactly the kind of inventing Context.md §7 forbids.
- Validation harness (do this before rendering anything): compute Ls for each of the 4 745 MSL sol dates, compare to the feed's `ls`; require max |Δ| ≤ 2° and report the residual in the provenance disclosure.
- Label every output: `DERIVED — Mars24 model; no local topography or dust correction`.
- If validation does not pass in time: show `Unknown (model not validated)`.

---

## 6. What not to do (honesty guardrails already encoded in the app)

- Never call the weather feeds "live" / "current" / "forecast". Evidence above: 81-day and 27-month staleness.
- Never call the route "safest" or "safe". It remains a **proposed terrain-cost candidate** with a prototype slope-only cost.
- Do not invent radiation, dust-storm, wind or thermal-hazard values. If a source lacks them, say `Unknown` with the reason.
- Do not recolor USGS/CRISM/THEMIS science fills.
- Do not add a client-side API key; Copilot stays behind the Worker.
- Do not imply a current MEDA stream, Perseverance support in the Mars Rover Photos API, or Jezero HiRISE availability — all three checked and negative/uncertain.
- Do not commit validation screenshots or downloaded tiles into the repo.

---

## 7. Submission plan mapped to the rubric

### 7.1 Criterion → evidence

| Criterion | What judges should see | Where in the app / submission |
| --- | --- | --- |
| Impact | A human Mars-walk planner that turns raw layers into a walkable plan with stops and honest unknowns | Field Tablet mode walkthrough |
| Creativity | Layered mission view + cost-candidate routing + science stops + explicit data-freshness accounting | map + inspector |
| Validity | Verified CRS investigation, verified served levels, validated Ls, every number labelled observed/derived/historical/unavailable | provenance disclosures; `Architecture.md` §6.1 |
| Relevance | Directly answers "map, routes, destinations, current conditions, multiple NASA missions" | §2 table |
| Presentation | 30 s demo, clear problem → solution → impact, no NASA branding | script below |

### 7.2 30-second demo script (also works as 7 slides)

1. **(0–4 s)** "First astronauts on Mars need one map that answers: where am I, where can I walk, what's there, and how old is the data." Open Habitat view over Jezero.
2. **(4–10 s)** Toggle topography → CTX → geology. "Every layer is a verified NASA product with provenance."
3. **(10–17 s)** Click the landing site → place a target at the western delta → run the route. "A terrain-cost candidate with slope profile and warnings — explicitly not a safety guarantee."
4. **(17–23 s)** Toggle science stops → click "Western Delta Deposit". "Named destinations so the walk does science on the way."
5. **(23–28 s)** Open the environmental panel → "Latest in-situ weather: sol 4995, collected 25 Aug 2026 — 81 days old. Current Mars weather is unavailable; we show it as unknown, not as a forecast."
6. **(28–30 s)** "SOLARA — an honest Mars map." Cut.

### 7.3 AI-use disclosure (paste into the project page)

> AI assistance was used for code review/refactoring and interface copy. All scientific data are NASA/USGS products fetched live from the documented endpoints; no imagery or video was AI-generated. Numeric claims in the app are labelled observed, derived, historical, or unavailable, and no AI output is presented as measured data.

---

## 8. Verification log (2026-11-14, macOS, `curl`)

```
# Trek ArcGIS catalog — 200, 76 services
GET https://trek.nasa.gov/mars/trekarcgis/rest/services?f=pjson

# Waypoints GeoJSON — 200, 8 features, EPSG:4326
GET https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020_waypoints/MapServer/0/query?where=1=1&outFields=*&returnGeometry=true&f=geojson

# Nomenclature bbox query — 200 (Jezero/IAU Feature/14300 present)
GET .../outreach_nomenclature/MapServer/0/query?where=1=1&geometry=77.16,18.21,77.70,18.72&...&f=geojson

# DEM ImageServer metadata — 200, S16, band 1, extent ±180, wkid 104905
GET .../Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer?f=pjson

# DEM exportImage — 200 image/png (2 624 bytes, 256×256, bbox 77.16,18.21,77.70,18.72)
GET .../Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?bbox=77.16,18.21,77.70,18.72&bboxSR=4326&imageSR=4326&size=256,256&format=png&f=image

# Mineral / salt / aqueous layers — 200, global extents confirmed
GET .../Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer?f=pjson
GET .../Chloride_Salt_bearing_Material_THEMIS_clon0/MapServer?f=pjson
GET .../Aquieous_Mineral_Distribution_Options_clon0/MapServer?f=pjson
# Mineral MapServer export — 200 image/png (RGBA 256×256, 970 bytes); slow cold render (>30 s)
GET .../Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/export?bbox=77.16,18.21,77.70,18.72&bboxSR=4326&imageSR=4326&size=256,256&format=png32&transparent=true&f=image

# MSL/REMS weather — 200, 4 745 sols, newest sol 4995 @ 2026-08-25 (ls 341)
GET https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
# MEDA — 200, 7 sols, 2024-04-21…27, temps "--"
GET https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json
# InSight — 200, payload from 2020
GET https://api.nasa.gov/insight_weather/?api_key=DEMO_KEY&feedtype=json&ver=1.0
# APOD — 200 (date 2026-11-14)
GET https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY

# CORS
mars.nasa.gov RSS:  access-control-allow-origin: *
trek ArcGIS:        access-control-allow-origin: http://localhost:5173
trek WMTS:          access-control-allow-origin: *

# Horizons — 200, Mars observer ephemeris 2026-11-14…16
GET https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='499'&CENTER='500@10'&MAKE_EPHEM=YES&EPHEM_TYPE=OBSERVER&START_TIME='2026-11-14'&STOP_TIME='2026-11-16'&STEP_SIZE='1 d'

# HuggingFace MEDA derived dataset — 200, CC-BY-4.0, modified 2026-09-20
GET https://huggingface.co/api/datasets/juliensimon/mars-perseverance-weather
```

Negative/uncertain results:

- `https://trek.nasa.gov/tiles/Mars/EQ/WMTSCapabilities.xml` → **404** (per-product capabilities only; use the product URLs in §3.1).
- `https://api.nasa.gov/mars-wmts/catalog/` → **404**.
- `https://astrowebmaps.wr.usgs.gov/arcgis/rest/services` → **404**; root page returns a bare redirect page. USGS delivery here is download-based.
- PDS ODE `live2` ad-hoc queries returned empty bodies — parameter names must come from the V2.1.6 manual; not verified.
- `planetarynames.wr.usgs.gov/SearchResults` → **500** (ASP error). Use the Trek nomenclature service instead.
- Mars Rover Photos API: not re-tested this pass; earlier reports say Perseverance support is absent/archived. Treat as unavailable.

---

## 9. Open questions before claiming anything publicly

1. Does the 2026 Judging & Awards guide (published 2026-11-13) change the criteria or award list? Re-read before submitting.
2. Is the MSL feed's newest sol *actually* the newest, or is `soles[]` capped/ordered? (Observed max `terrestrial_date` 2026-08-25, sol 4995 — consistent with a stopped update, but confirm on a second fetch on 2026-11-15.)
3. Which layer names are acceptable for §3.2 C–E? "Compiled map", "detection options" — do not upgrade to "mineral abundance".
4. Does the route layer remain above new overlays (zIndex ordering) after adding ImageStatic layers?
5. Deployment: `dist/` is already built; Cloudflare Pages (or any static host) works. Copilot needs the Worker deployed + `OPENROUTER_API_KEY` secret; otherwise it must degrade to the honest `copilot-unconfigured` state during the demo.
