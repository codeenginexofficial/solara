# SOLARA

SOLARA is a Mars surface exploration and preliminary mission-planning prototype created for the NASA International Space Apps Challenge 2026. It combines global planetary context with detailed Jezero mapping, scientific dataset provenance, rover observations, and a terrain-cost route candidate.

SOLARA is not an official NASA product, an operational navigation system, or a safety assessment. Route candidates are not validated or guaranteed safe.

## What is implemented

- **3D Mars globe:** CesiumJS displays Cesium ion's Mars 3D Tiles asset when a configured ion token can access it. The globe is optional and requires network access; without a token the app explains the setup requirement instead of drawing a substitute planet.
- **2D Mars map:** OpenLayers shows a global Viking mosaic and optional MOLA + HRSC color hillshade, with detailed NASA Trek Jezero CTX imagery and prepared scientific overlays. Layer provenance, coverage, coordinate reference and limitations are available in the interface.
- **Jezero datasets:** USGS SIM 3292 geology, the Perseverance landing ellipse and historical traverse, Mars 2020 science waypoints, IAU Jezero nomenclature, and prepared OMEGA/CRISM hydrous-mineral detections.
- **Elevation and routing:** Point elevations can be queried from NASA Trek's MOLA + HRSC DEM service. A prepared Jezero DEM grid supports a prototype A* terrain-cost candidate and elevation profile. It is regional context at roughly 200 m/pixel, not hazard-grade terrain.
- **Environmental context:** MEDA archive observations are fetched through the Worker and shown with their measurement times and status. A separate NASA weather RSS record is a static, stale snapshot; Mars solar time and season values are calculated with a Mars24-derived model.
- **Rover media:** Perseverance raw images are browsed through a Worker proxy and associated with the historical traverse by Sol, not by exact image coordinates. NASA's Image and Video Library provides a separate Mars video search.
- **Habitat and Field Tablet modes:** Both use the same in-memory mission state. Plans can be exported and imported as JSON; there is no account or automatic cross-device synchronization. Field Tablet position is simulated/manual, not live tracking.
- **Mission Copilot:** An optional Worker endpoint sends chat requests to the configured OpenRouter model. It receives limited app context, is not a verified scientific data source, and cannot see map pixels.

See [SOURCES.md](SOURCES.md) for exact endpoints, data attribution, software references and known source limitations. The app only presents sources actually used by its code; a source appearing there does not guarantee upstream availability.

## Requirements

- Node.js and npm.
- Network access for external map tiles and data services.
- A Cesium ion account and restricted, asset-scoped browser token to use the 3D globe.
- An OpenRouter API key to use Mission Copilot. The map, rover-media routes, and MEDA Worker route do not require this key.

## Local setup

Install the dependencies from the npm lockfile:

```powershell
npm ci
```

In the repository root, optionally copy `.env.example` to `.env` and set `VITE_CESIUM_ION_TOKEN` to a Cesium ion token restricted to Mars asset `3644333`, the `assets:read` scope, and the intended application origin. This is a public browser token embedded in the frontend build; never put private scopes, account credentials, or the OpenRouter key in a `VITE_*` variable.

For Mission Copilot, create `worker/.dev.vars` with:

```text
OPENROUTER_API_KEY=your_openrouter_api_key
```

This local Worker file is git-ignored. The Worker uses `OPENROUTER_MODEL` from `worker/wrangler.toml` by default (`openrouter/free`). Do not commit keys. The Worker currently has no authentication or rate limiting and is for local development, not unreviewed public deployment.

Start the frontend and Worker in separate terminals from the repository root:

```powershell
npm run dev
```

```powershell
npm run dev:copilot
```

Open the Vite URL printed in the first terminal (normally `http://localhost:5173`). The Vite `/api` proxy expects the Worker on `127.0.0.1:8787`. Without the Worker, Worker-backed requests return errors; Copilot also requires its key. The 3D globe remains unavailable until its optional ion token is configured.

## Demonstration path

1. In Habitat mode, open **3D Globe** if a valid ion token is configured. Rotate and zoom to orient globally; optionally display the historical Perseverance traverse.
2. Switch to the **2D Map** and inspect the Jezero region. Toggle imagery, topographic context, geology, rover and science overlays. Open dataset details to review provenance, coverage and limitations.
3. Select a location to inspect available elevation and environmental context. MEDA values are historical, instrument-specific observations; the static weather snapshot is from Gale Crater and is not current Jezero weather.
4. Choose a start and target within the prepared Jezero planning area and compute a proposed terrain-cost route. Inspect its distance, elevation profile and caveats; do not describe it as safe or validated.
5. Export the mission plan, switch to Field Tablet mode, and import the file if needed. The simulated position is clearly labeled; it does not represent a real astronaut or rover location.

Rover image browsing and NASA video search are available from the rover/media panels when their upstream services are reachable. Images are historical, and the raw-image feed does not supply a validated map location for each image.

## Validation commands

```powershell
npm run typecheck
npm run typecheck:copilot
npm run build
```

## Data, licensing and attribution

The repository's application code is licensed under Apache-2.0; see [LICENSE](LICENSE). That license does not grant rights to hosted data, third-party services, trademarks, or third-party software. Follow each provider's terms and attribution requirements before redistribution or deployment. In particular, Cesium ion content has separate account, usage and attribution terms; retain the globe's Cesium credit display and use a suitably restricted token.

Dataset attribution and provenance are shown in the application where available and catalogued in [SOURCES.md](SOURCES.md). NASA/USGS/ESA or mission names identify source material and do not imply NASA endorsement.

## Known limitations

- Jezero CTX coverage is bounded; locations outside verified coverage do not become local high-resolution coverage.
- The route model uses a prepared, approximately 200 m/pixel MOLA + HRSC elevation grid. It does not account for all surface hazards and is not operationally validated.
- The rover traverse is historical. Rover images are not assigned to a clicked point without validated geolocation.
- Environmental data are sparse and historical; there is no live Mars weather forecast, radiation feed, astronaut GPS or live rover tracking.
- Mission state is in-memory. Use plan export/import for a file handoff; automatic synchronization is not implemented.
- External services, browser connectivity, provider quotas and credentials can affect availability.
