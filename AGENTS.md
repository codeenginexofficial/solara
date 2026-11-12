# AGENTS.md — guidance for coding agents in SOLARA

## Read before coding (non-negotiable)

1. `Context.md` — product scope, MVP feature list, scientific-honesty rules (§7).
2. `Architecture.md` — module boundaries, CRS policy (§6.1), map/data semantics (§7.1–7.2), agent discipline (§15).
3. `Design.md` — layout and visual system.

These are the source of truth. If code and docs disagree, the docs describe the intent — fix the code, or flag the drift. Never invent data coverage, coordinates, or scientific values that these docs don't support.

## Commands

```powershell
npm run dev        # Vite dev server, port 5173
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (run after meaningful changes)
```

There is no test framework and no linter. The verification loop is: `typecheck` → `build` → manual browser checks (`npx playwright-cli open http://localhost:5173 --browser msedge`; session supports `reload`, `eval`, `route`, `network-state-set`, `console`, `screenshot`).

## Environment gotchas (Windows / PowerShell 5.1)

- Editing files via PowerShell string commands (`Get-Content`/`Set-Content`/`.Replace`) silently corrupts UTF-8 characters (`°`, `λ`). Use the Read/Edit file tools instead.
- `curl` is aliased to `Invoke-WebRequest` here; use `curl.exe` for real curl syntax.
- Screenshots and probe scripts are disposable: delete them when done. Validation PNGs have accidentally been committed before — never stage them.

## CRS facts (do not re-derive or "fix" these)

- NASA Trek declares `urn:ogc:def:crs:EPSG::104905`, but that URN does **not** resolve under EPSG (registry has no 104905; under ESRI it is `GCS_Mars_2000`, a geographic CRS). The projection Trek actually serves was verified equivalent to **IAU:2015:49910** (Mars sphere R = 3,396,190 m, equirectangular, lat_ts 0, clon 0, metres). Full evidence trail: `Architecture.md` §6.1.
- SOLARA uses its own internal ids `SOLARA:MARS_EQC_IAU2015` / `SOLARA:MARS_2000_SPHERE_LONLAT` (defined in `src/map/projections/ProjectionRegistry.ts`). They make no authority claim — never display `EPSG:104905` as the working projection; the declared URN is kept verbatim only as source metadata.
- proj4 quirk (verified on 2.22.0): the eqc forward transform flips y's sign at exactly ±90° latitude. Pole coordinates (tile-grid origin, world extent) must be computed analytically (±πR/2) as done in `src/map/trek/tileGrid.ts`; never take them from proj4 output.
- The WMTS tile matrix is a degree-based plate carrée pyramid, inconsistent with its metre CRS and with its declared `ScaleDenominator`s. Resolutions are derived analytically from matrix geometry in `tileGrid.ts`.

## OpenLayers quirks in this codebase

- ol `Tile` extends `EventTarget`, **not** `BaseObject` — there is no `tile.get()/set()`. Per-tile failure causes live in the `WeakMap` in `src/map/layers/createWmtsLayer.ts`.
- Trek answers 404 for out-of-footprint tiles **without** an `Access-Control-Allow-Origin` header, so each such request is CORS-rejected by the browser and logged as console errors. The tile loader therefore marks tiles fully outside the advertised footprint as `TileState.EMPTY` before fetching — out-of-footprint tiles must never be requested.
- Tile counters reset on `change:resolution` (a new pyramid level means new tiles); panning within a level keeps accumulating.
- `ol.css` is not imported; control positioning (`position: absolute`, attribution, scale line) is hand-declared in `src/index.css`. Add positioning rules there when adding controls.
- No ol object (`Map`, `Layer`, `Source`) may live in React state — ol stays inside `src/map/MarsMap.tsx`. `MarsMap` is `React.lazy`-loaded; do not import ol in shell code or the code-split is lost.

## Capabilities / data semantics

- The map always builds from the embedded verified capabilities snapshot; the live Trek fetch only re-verifies via grid fingerprint. Do not wire map construction to live-fetch results, and do not present "live" status unless the fingerprint matched (states: `checking | live | schema-changed | unavailable`).
- Every displayed scientific value must be labeled observed / derived / modelled / historical / unavailable (Context.md §7). "Unknown" must be visible as unknown. Routes are "proposed terrain-cost candidates", never "safest". Delayed observations are never "live weather".

## Reference values for validation (Jezero CTX, verified)

- Mosaic footprint: 77.1604655–77.6991776°E, 18.2110274–18.7211945°N (~30.3 × 30.2 km).
- View-centre check: 77.42982°E, 18.46611°N ↔ easting 4,589,629 m, northing 1,094,573 m.
- Perseverance landing site (Octavia E. Butler): 18.4447°N, 77.4508°E (inside footprint).
- Level 13 resolution ≈ 5.087 m/px (finest served).

## Git discipline

- Never commit unless explicitly asked. Work in small increments; leave commits to the user unless instructed.
- Keep scope: Mars/Jezero only, MVP features from Context.md §6. Don't install dependencies or swap frameworks without a concrete, stated reason.
