# AGENTS.md — guidance for coding agents in SOLARA

## Read before coding (non-negotiable)

1. `Context.md` — product scope, MVP feature list, scientific-honesty rules (§7).
2. `Architecture.md` — module boundaries, CRS policy (§6.1), map/data semantics (§7.1–7.2), agent discipline (§15).
3. `Design.md` — layout and visual system.

These are the source of truth. If code and docs disagree, the docs describe the intent — fix the code, or flag the drift. Never invent data coverage, coordinates, or scientific values that these docs don't support.

## Commands

```powershell
npm run dev               # Vite dev server, port 5173
npm run dev:copilot       # Copilot Worker (wrangler) on 127.0.0.1:8787 — Vite proxies /api/copilot to it
npm run typecheck         # tsc --noEmit
npm run typecheck:copilot # tsc --noEmit -p worker
npm run build             # typecheck + production build (run after meaningful changes)
```

There is no test framework and no linter. The verification loop is: `typecheck` → `build` → manual browser checks via playwright-cli (see the quirks section below; a session supports `reload`, `eval`, `route`, `network-state-set`, `console`, `screenshot`).

Copilot development needs **both** processes running. Without the Worker, copilot sends fail with honest errors (`copilot-unconfigured` / `offline` / `invalid-response`) — that is correct behavior, not a bug to fix.

## Environment gotchas (Windows / PowerShell 5.1)

- Editing files via PowerShell string commands (`Get-Content`/`Set-Content`/`.Replace`) silently corrupts UTF-8 characters (`°`, `λ`, `§`, `—`) and `Set-Content -Encoding UTF8` adds a BOM. Use the Read/Edit file tools instead; if a BOM slips into a file, repair bytes only with `[IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))` (a decode→re-encode round-trip, safe for UTF-8).
- `curl` is aliased to `Invoke-WebRequest` here; use `curl.exe` for real curl syntax.
- Screenshots and probe scripts are disposable: delete them when done. Validation PNGs have accidentally been committed before — never stage them.
- The Vite dev server watches the project root: writing any file into the repo while it runs (playwright snapshots, console logs, downloads) can trigger a full page reload, which resets in-memory module state (mission store: start/target/route). Keep validation artifacts OUTSIDE the repo (use `C:\Users\aas03\AppData\Local\Temp\opencode`), or expect reloads mid-test. Mission state is intentionally in-memory only — a browser reload discards the current route; plans survive only via export/import files.

## Playwright-cli quirks (browser verification, learned the hard way)

- Invoke with the full path: `& (Join-Path (npm config get prefix) 'playwright-cli.cmd') …` (not on PATH). Run from the temp dir so `.playwright-cli` artifacts stay out of the repo.
- The bash tool often reports `Unknown: ChildProcess.kill` even when the command succeeded — verify through a redirect log (`… *> <temp-log>`), never trust that error.
- NEVER redirect to `NUL` (`*> NUL`) in PowerShell 5.1: the device-open failure prevents execution and can swallow the preceding action in the chain (cost a lost map click once).
- Viewport: `resize <w> <h>` (`--viewport-size` is not valid for `open`). `screenshot` needs `--filename <name>` — a bare argument is parsed as a selector. `status` is not a command.
- `click` takes a selector, not x/y — coordinate taps need `mousemove` → `mousedown` → `mouseup`.
- The .cmd shim mangles quoted args: in `eval` use PowerShell single-quoted strings with doubled `''` for literal quotes; avoid double quotes, backticks and `${}`. `[data-testid=value]` unquoted attribute selectors work; role selectors containing spaces lose their inner quotes and fail — click such buttons via `eval` + `querySelectorAll('button').find(…)` instead.
- Do React state updates and dependent button clicks in separate evals with sleeps between — a same-tick click hits the still-disabled button.

## CRS facts (do not re-derive or "fix" these)

- NASA Trek declares `urn:ogc:def:crs:EPSG::104905`, but that URN does **not** resolve under EPSG (registry has no 104905; under ESRI it is `GCS_Mars_2000`, a geographic CRS). The projection Trek actually serves was verified equivalent to **IAU:2015:49910** (Mars sphere R = 3,396,190 m, equirectangular, lat_ts 0, clon 0, metres). Full evidence trail: `Architecture.md` §6.1.
- SOLARA uses its own internal ids `SOLARA:MARS_EQC_IAU2015` / `SOLARA:MARS_2000_SPHERE_LONLAT` (defined in `src/lib/marsCrs.ts`, re-exported by `ProjectionRegistry.ts`). They make no authority claim — never display `EPSG:104905` as the working projection; the declared URN is kept verbatim only as source metadata.
- proj4 quirk (verified on 2.22.0): the eqc forward transform flips y's sign at exactly ±90° latitude. Pole coordinates (tile-grid origin, world extent) must be computed analytically (±πR/2) as done in `src/map/trek/tileGrid.ts`; never take them from proj4 output.
- The WMTS tile matrix is a degree-based plate carrée pyramid, inconsistent with its metre CRS and with its declared `ScaleDenominator`s. Resolutions are derived analytically from matrix geometry in `tileGrid.ts`.

## OpenLayers quirks in this codebase

- ol `Tile` extends `EventTarget`, **not** `BaseObject` — there is no `tile.get()/set()`. Per-tile failure causes live in the `WeakMap` in `src/map/layers/createWmtsLayer.ts`.
- Trek answers 404 for out-of-footprint tiles **without** an `Access-Control-Allow-Origin` header, so each such request is CORS-rejected by the browser and logged as console errors. The tile loader therefore marks tiles fully outside the advertised footprint as `TileState.EMPTY` before fetching — out-of-footprint tiles must never be requested.
- Tile counters reset on `change:resolution` (a new pyramid level means new tiles); panning within a level keeps accumulating.
- `ol.css` is not imported; control positioning (`position: absolute`, attribution, scale line) is hand-declared in `src/index.css`. Add positioning rules there when adding controls.
- No ol object (`Map`, `Layer`, `Source`) may live in React state — ol stays inside `src/map/MarsMap.tsx`. `MarsMap` is `React.lazy`-loaded; do not import ol in shell code or the code-split is lost. Same for constants: shell components import CRS ids/metadata from `src/lib/marsCrs.ts` (ol-free), **never** from `ProjectionRegistry.ts` — importing even constants from the registry pulls proj4 + ol/proj into the shell chunk (measured regression: index chunk 492 → 342 kB when fixed, 2026-11-13). The MarsMap chunk may exceed Vite's 500 kB chunk warning — that is the intended split, do not "fix" it by un-splitting.
- ol quirk (verified 2026-11-13, fixed in `ProjectionRegistry.ts`): with a proj4-registered projection, ol's default `getPointResolution` estimates scale by transforming a pixel window to EPSG:4326 and measuring it on the **Earth** sphere (`node_modules/ol/proj.js` estimation path). For the Mars sphere this inflates the estimate by ≈ (R⊕/R♂)·(1+cos φ)/2 — ×1.83 at 18.5°N — so the ol `ScaleLine` control drew bars ~1.8–3.6× too short (a "20 km" bar actually spanned ~36.6 km). Fixed by `setGetPointResolution((r) => r)` on the eqc projection — exact, because eqc at lat_ts 0 is equidistant in x and y. Never remove that call; verify with a screenshot or pixel measure (a 5 km bar spans 5000/res pixels, e.g. 120 px at ~42 m/px, 90 px at 55.44 m/px).
- ol `View.fit()` does NOT snap resolution to a custom `resolutions` list (`constrainResolution` defaults to false) — fitted views land at fractional zooms between tile levels (e.g. zoom 9.554 → 55.44 m/px). Expected, not a bug.
- GeoJSON overlay layers stack above the route layer in default render order; the route layer is pinned on top with `routeLayer.setZIndex(100)` in `MarsMap.tsx`. Any new layer needs an explicit zIndex or stacking will surprise you.

## UI design system ("Minimal Monochrome Dark", as-built 2026-11-14)

- All colors/radii/fonts flow from the `@theme` block in `src/index.css`; components style exclusively through Tailwind tokens — never hardcode hex in components. The identity is grayscale: the `accent` token is **white** (primary actions are contrast, not color); the only non-grays are muted semantic status tones (ok/warn/danger/info), always paired with a text label. Do not reintroduce decorative color accents — three themed passes already happened (teal → crimson → monochrome); don't start a fourth.
- Fonts: IBM Plex Sans / IBM Plex Mono, locally bundled via `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono` (sans 400/500/600, mono 400/500), imported at the top of `src/index.css`. Coordinates and technical values use `font-mono`. Never add an external (Google Fonts) request.
- Radius tokens: 8px badges, 12px buttons/inputs, 16px cards/panels, 20px drawers + bottom sheets (Tailwind `rounded-sm/md/lg/xl` remapped in `@theme`).
- Motion: hover 150ms, buttons 160ms, tabs 180ms, drawers/sheets 220ms, ease-out; flat surfaces — no shadows on ordinary buttons/panels, no glass/blur/gradients; no pulse/bounce/infinite animations (loading dots are static); `prefers-reduced-motion` is honored by the block at the end of `index.css`.
- Map overlays (UI chrome only, not data): route = solid white over a dark casing (a PROPOSED terrain-cost candidate); rover traverse + landing ellipse = dashed gray (historical); markers carry mono labels (`START`/`TARGET`/`SELECTED`/`YOU·SIM`) — identity comes from the label, not color. Geology unit fills are USGS data colors — never recolor scientific data layers.
- Copy: short labels and descriptions; technical metadata and provenance live behind `Disclosure` (`src/components/ui/disclosure.tsx`). Honesty statements (hypothesis labels, "not a validated or safe route", SIMULATED markers, Unknown-with-reason rows) are Context.md §7 compliance — wording may be shortened but they must never be deleted from the UI.

## Capabilities / data semantics

- The map always builds from the embedded verified capabilities snapshot; the live Trek fetch only re-verifies via grid fingerprint. Do not wire map construction to live-fetch results, and do not present "live" status unless the fingerprint matched (states: `checking | live | schema-changed | unavailable`).
- Every displayed scientific value must be labeled observed / derived / modelled / historical / unavailable (Context.md §7). "Unknown" must be visible as unknown. Routes are "proposed terrain-cost candidates", never "safest". Delayed observations are never "live weather".

## Mission Copilot contract (verified 2026-11-13)

- `MAX_CONVERSATION_MESSAGES = 24` (`src/features/copilot/copilotClient.ts`) is a shared contract with the Worker's `MAX_MESSAGES` (`worker/src/index.ts`): the client trims history before sending; the Worker 400-rejects over-limit payloads. Change both sides together or sends brick on `invalid-request`.
- `CopilotPanel` guards the clear-during-pending race with `sendSequenceRef` (in-flight resolutions whose sequence is stale are dropped; a failed send reverts the optimistic user message and restores the draft). Removing the guard resurrects cleared conversations.
- Client `CopilotClientError` codes are the UI's honest-error mapping (`network-error`/`invalid-response` added client-side; the rest come from the Worker). Keep `worker/src/index.ts` and `copilotClient.ts` error vocabularies in sync.
- The Worker has no auth or rate limiting — local dev only; add both before any public deployment. No OpenRouter credentials may ever reach the client (no `VITE_*` vars).

## Selection / coordinate semantics (verified 2026-11-13)

- Clicks outside the exploration region are legitimate user input (global-view pan). Do **not** clamp them: the selected-location card shows an "Inside / Outside exploration region" row via the shared `isInsideBoundingBox` (`src/lib/bbox.ts`) and states the consequences honestly (route planning unavailable outside).
- LocationPanel elevation states carry a `locationKey` (lon/lat at 6 dp); the reporting effect only pairs a state with the location it was fetched for, otherwise it reports loading. Never render an elevation value under a different point.

## Reference values for validation (Jezero CTX, verified)

- Mosaic footprint: 77.1604655–77.6991776°E, 18.2110274–18.7211945°N (~30.3 × 30.2 km).
- View-centre check: 77.42982°E, 18.46611°N ↔ easting 4,589,629 m, northing 1,094,573 m.
- Perseverance landing site (Octavia E. Butler): 18.4447°N, 77.4508°E (inside footprint).
- Level 13 resolution ≈ 5.087 m/px (finest served).

## Git discipline

- Never commit unless explicitly asked. Work in small increments; leave commits to the user unless instructed.
- Keep scope: Mars/Jezero only, MVP features from Context.md §6. Don't install dependencies or swap frameworks without a concrete, stated reason.

## Implemented module map (Milestone 2, as-built 2026-11-14)

- `src/data/catalog/` — `types.ts` + `datasets.ts` (8 verified records: CTX, MOLA colorshade, MOLA blend DEM api-record, SIM 3292 geology, Perseverance traverse, landing ellipse, Mars 2020 science waypoints, IAU Jezero nomenclature + hydrous-mineral detections raster; per-record verification evidence; `verifiedServedLevels`; `preparedAssetUrl`/`queryEndpoint` for non-WMTS data). `src/map/trek/trekCapabilities.ts` holds the embedded verified capabilities XML snapshots keyed by dataset id (`VERIFIED_CAPABILITIES_XML_BY_ID`) and parses them once.
- `src/map/layers/` — `createWmtsLayer.ts` (truncates declared levels to `verifiedServedLevels`, analytic footprint via `marsBboxToMetresExtent`), `createGeojsonLayer.ts` (kind-based styles for geology/rover/science overlays incl. decluttered waypoint and IAU labels; throws on non-FeatureCollection), `createRasterOverlayLayer.ts` (prepared georeferenced PNG via `ImageStatic` in `SOLARA:MARS_2000_SPHERE_LONLAT`, nearest-neighbour for categorical mineral detections).
- `src/data/adapters/` — `elevationGrid.ts` + `demService.ts`: prepared-grid loader/sampler (ol-free) and live Trek ImageServer identify (5-decimal cache; NoData → unknown). Main-thread fallback identify uses the same prepared grid asset.
- `src/science/terrain/` — `geometry.ts` (haversine on the Mars sphere R = 3,396,190 m) + `cost.ts` (prototype cost model: `cost = groundM × (1 + slopeCostPerDeg × slopeDeg)`, documented as prototype; no operational safety claim).
- `src/science/environment/` — `marsTime.ts` (direct TS port of the NASA GISS Mars24 algorithm incl. leap-second TT conversion; Ls/LMST/LTST/EOT/declination/RM; worked examples reproduced to 1e-5; validated against 4,745 MSL sols: median |ΔLs| 0.51°, max 1.29°) + `weatherContext.ts` (verified static snapshot: MSL sol 4995 / 2026-08-25, Gale; MEDA 7 sols 2024-04-21…27 with no temperatures). Values are modelled/historical — never "live weather".
- `src/workers/` — `route.worker.ts` (A*, 8-connected, no corner cutting, unknown cells impassable, snapping + warnings + provenance) + `routeClient.ts` (module singleton; typed `RouteClientError` codes: grid-not-loaded/start-outside/target-outside/start-unknown/target-unknown/no-path/invalid-params).
- `src/features/mission/` — `store.ts` (module singleton via `useSyncExternalStore`; start/target/route/params/position/gridMeta; plan export/import `solara-plan/1`), `components/ElevationProfile.tsx`, `components/RouteSummary.tsx`, `components/MissionPanel.tsx` (habitat).
- `src/features/field-tablet/FieldTabletMode.tsx` — map-dominant, bottom mission sheet, simulated position (always labelled SIMULATED), nearest-route-point card, plan import.
- `src/features/habitat-mode/` — `HabitatMode.tsx` orchestrates `MissionOperationsPanel` (mission area, grouped map layers with runtime state chips, query-only datasets, selected location with region-membership row, mission planning with an "Advanced (prototype parameters)" disclosure), `ContextWorkspace` (tabbed Inspector/Copilot right panel; resizable 320–640 px via pointer/keyboard handle, drawer below `lg`), `InspectorPanel` (location + selected science stop → environment card (modelled Ls/LMST + stale weather snapshot) → selected-dataset summary card with details/provenance disclosure → route candidate/profile/warnings → provenance), `CopilotPanel` (right-panel Mission Copilot; expanded mode is width-only and preserves history), `LocationPanel`, `MissionPanel`, `DatasetPanel` (details renderer). `LayerPanel.tsx` was superseded by `MissionOperationsPanel` and removed.
- `src/components/ui/` — token-styled primitives: `button.tsx` (cva: default/accent/ghost/outline; sizes default h-9 / sm h-8 / icon size-9), `badge.tsx` (neutral/info/ok/warn/danger/accent tones), `switch.tsx`, `section.tsx`, `disclosure.tsx`.
- `src/features/copilot/` — `copilotClient.ts`: typed client for `POST /api/copilot/chat`; see "Mission Copilot contract" above for the shared limits/error codes; no credentials client-side.
- `worker/` — Cloudflare Worker copilot proxy (`POST /api/copilot/chat`): validates/clamps the payload, injects server-side honesty guardrails + verified dataset facts, forwards to OpenRouter (`OPENROUTER_MODEL` var, default `openrouter/free`); secrets `OPENROUTER_API_KEY` via `wrangler secret put` (`.dev.vars` git-ignored, never committed). Dev: `npm run dev:copilot` + Vite proxy `/api/copilot` → 127.0.0.1:8787.
- `src/lib/marsCrs.ts` — ol-free CRS ids/sphere constants/display metadata (re-exported by ProjectionRegistry); shell components import from here so proj4/ol stay out of the shell bundle. `src/lib/bbox.ts` — shared `isInsideBoundingBox`.
- `public/data/mars/jezero/` — prepared verified assets (geology 2 units, traverse 332 sol-tagged segments, landing ellipse, 8 science waypoints, 1 IAU nomenclature feature, hydrous-mineral 1400² PNG, DEM grid 160×151) from `scripts/prepare-jezero-assets.mjs`. Builders are selectable: `node scripts/prepare-jezero-assets.mjs <geology|rover|science|nomenclature|minerals|dem>`.
- Base layer order (bottom-first): `['mola-hrsc-blend-200m-colorshade', 'jezero-ctx-mosaic-soc-008']` — topography under imagery, in both modes.
- Overlay order (bottom→top, both modes): geology, landing ellipse, rover traverse, science waypoints, IAU nomenclature, hydrous-mineral raster. Science-waypoint/IAU clicks are hit-tested only on those two layers (`MarsMap.onFeatureSelect` → `MapFeatureSelection`) and surface in the Inspector; the route layer stays on top (`zIndex 100`).

## Specialist subagent workflow (project config in `.opencode/agent/`)

Four project subagents are defined in `.opencode/agent/` (verified against opencode 1.19.5):

| Agent | Focus | Writes |
| --- | --- | --- |
| `solara-ui-specialist` | React 19 / TS / Tailwind v4, layout, accessibility | Yes — only on explicit assignment |
| `solara-gis-specialist` | OpenLayers, proj4, CRS, WMTS tile grids | No — read-only analysis |
| `solara-science-researcher` | Mars/Jezero science, provenance, validation | No — read-only research |
| `solara-code-reviewer` | TS correctness, architecture, regressions, security | No — strictly read-only |

Orchestration rules for the main agent (the project lead):

- The main agent owns task assignment, sequencing, integration, and final approval. Subagents never commit; only the lead integrates.
- Delegate independent research/inspection in parallel (e.g. GIS + science questions on the same change), but never give two write-capable agents overlapping files at the same time.
- Subagents cannot talk to each other. Pass relevant findings between them yourself, through the main agent's context.
- Every subagent task must end with a report: findings, files inspected, assumptions, risks, recommendations. Research agents must add source URLs and how each claim was verified. The reviewer must cite the actual diff commands and test results it ran.
- Review all subagent outputs before acting on them; verify claims against the repo docs (this file, Architecture.md, Context.md) rather than trusting the summary.
