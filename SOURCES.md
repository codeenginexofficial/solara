# SOLARA — Sources and Attribution

SOLARA uses the public Mars data and software resources below; displayed values remain labelled observed, derived, modelled, historical, or unavailable.

## NASA Data and Resources

- **NASA Trek — MOLA + HRSC color hillshade WMTS (global and polar)** — Supplies visual topographic context in the 2D map and the 3D globe from the global product at `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/WMTSCapabilities.xml` and the native polar products at `https://trek.nasa.gov/tiles/Mars/NP/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw_np/1.0.0/WMTSCapabilities.xml` and `https://trek.nasa.gov/tiles/Mars/SP/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw_sp/1.0.0/WMTSCapabilities.xml`, credited to NASA MGS MOLA and ESA Mars Express HRSC.
- **NASA Trek — THEMIS Day and Night infrared mosaics** — Supply optional thermal context in the 2D map from `https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml` and `https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml`, credited to NASA/JPL-Caltech/Arizona State University; these are rendered infrared mosaics, not temperature measurements.
- **NASA Trek — MOLA + HRSC DEM ImageServer** — Supplies point elevation `identify` queries and bounded `exportImage` route windows at `https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer`, with a prepared Jezero grid derived from the same service.
- **NASA Trek — Perseverance traverse** — Supplies the historical 332-segment, Sols 14–1176 traversed path at `https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer`, prepared locally for the 2D map, 3D globe, and Sol-based rover-image lookup; this is not a current rover position.
- **NASA Trek — Perseverance landing ellipse** — Supplies the historical mission-planning ellipse at `https://trek.nasa.gov/mars/trekarcgis/rest/services/perseverance_landing_ellipse/MapServer`, prepared locally as a context overlay.
- **NASA Trek — Mars 2020 science waypoints** — Supplies eight mission bookmark points through `https://trek.nasa.gov/mars/trekarcgis/rest/services/mars2020_waypoints/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`, prepared locally with their per-feature Trek bookmark links.
- **NASA Trek — IAU nomenclature** — Supplies the prepared Jezero label and live place-name search through `https://trek.nasa.gov/mars/trekarcgis/rest/services/outreach_nomenclature/MapServer` and its `/0/query` endpoint; the Gazetteer itself is credited below.
- **NASA Trek — Hydrous mineral detections** — Supplies the prepared Jezero detection raster exported from `https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer`, compiled from ESA OMEGA and NASA CRISM observations.
- **NASA — Viking MDIM 2.1 colorized global mosaic** — Supplies global historical optical context in the 2D map through Esri-hosted tiles at `https://tiles.arcgis.com/tiles/lqRTrQp2HrfnJt8U/arcgis/rest/services/mars_viking_mosaic/MapServer`, sourced from NASA Ames and USGS Astrogeology.
- **NASA — Perseverance raw-image feed** — Supplies historical NASA/JPL-Caltech/MSSS image metadata and files through the Worker proxy at `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json`, with the public gallery at `https://mars.nasa.gov/mars2020/multimedia/raw-images/`; images are not geolocated to map points.
- **NASA — Mars weather RSS** — Supplies the verified static MSL/REMS snapshot at `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` and the sparse Mars 2020/MEDA check at `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json`; SOLARA does not poll either feed at runtime and never labels the values live.
- **NASA PDS Atmospheres Node — MEDA** — Supplies archived NASA/JPL-Caltech/INTA-CAB calibrated air temperature (ATS), derived pressure (PS), relative humidity (RHS), and wind (WS) products through `https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html` and `https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda`, with Rodriguez-Manfredi et al. (2021) at `https://doi.org/10.1007/s11214-021-00816-9`; the latest valid wind record is Sol 313, before the Sol 315 sensor damage.
- **NASA GISS Mars24** — The algorithm at `https://www.giss.nasa.gov/tools/mars24/help/algorithm.html`, based on Allison & McEwen (2000) and the embedded IERS leap-second table, is ported into SOLARA for modelled Ls, LMST, and LTST and validated against the MSL/REMS feed listed above; it is not an observation source.
- **NASA Image and Video Library** — Supplies archived Mars video search and manifests through `https://images-api.nasa.gov` (assets on `images-assets.nasa.gov`, item pages on `https://images.nasa.gov/`); playback is not live and is not linked to a map point.
- **NASA mission landing-site references (Perseverance, Curiosity, MER, InSight)** — JPL's Mars 2020 page (`https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/landing_site/`), NASA NTRS (`https://ntrs.nasa.gov/citations/20120016764`), and NASA Science pages (`https://science.nasa.gov/mission/mer-opportunity/`, `https://science.nasa.gov/mission/mer-spirit/`, `https://science.nasa.gov/mission/insight/`) supply the historical marker coordinates.
- **NASA NSSDC and GISS landing references (Viking and historical landers)** — NSSDC's Viking page (`https://nssdc.gsfc.nasa.gov/planetary/viking.html`) supplies the Viking marker coordinates, and the GISS Mars24 landers page (`https://www.giss.nasa.gov/tools/mars24/help/landers.html`) is the catalogued historical-lander reference.
- **NASA Trek Mars WMTS documentation** — `https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars` is the service reference linked from the 3D globe.

## Space Agency Partners and Other Resources

- **USGS Astrogeology Science Center — SIM 3292 Geologic Map of Mars** — The Trek service at `https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer` supplies the two-unit Jezero geology overlay, published by Tanaka et al. (2014) at `https://pubs.usgs.gov/sim/3292/` (DOI `https://doi.org/10.3133/sim3292`).
- **USGS Astrogeology Science Center — MOLA + HRSC product documentation** — `https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_shaded_relief_200m` and `https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m` document the blended color hillshade and DEM used above (Fergason, Hare & Laura, 2018).
- **IAU WGPSN / USGS Gazetteer of Planetary Nomenclature** — `https://planetarynames.wr.usgs.gov/` supplies the trusted feature-detail links returned by the IAU search; only links on this host are accepted.
- **Caltech Bruce Murray Laboratory — Global CTX Mosaic V01** — `https://murray-lab.caltech.edu/CTX/` documents the NASA/JPL-Caltech/MSSS mosaic served through Esri at `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}`, used as optional 2D and 3D optical context.
- **ESA Mars Express — HRSC and OMEGA** — HRSC contributes to the MOLA + HRSC blends and OMEGA to the hydrous-mineral compilation; ESA is credited in those dataset records, and SOLARA calls only the NASA-hosted services rather than an ESA endpoint.
- **OpenRouter** — `https://openrouter.ai/api/v1/chat/completions` is called server-side by the Worker for Mission Copilot using `OPENROUTER_API_KEY`, with `openrouter/free` as the default model.
- **Cloudflare Workers** — `https://developers.cloudflare.com/workers/` hosts the Worker routes for Copilot, MEDA, and Perseverance images in local development and deployment.

## Development Tools and Libraries

- **CesiumJS** — `https://cesium.com/platform/cesiumjs/` renders the lazy-loaded 3D Mars sphere and imagery in the globe.
- **OpenLayers** — `https://openlayers.org/` renders the 2D Mars raster and vector map.
- **Proj4js (proj4)** — `https://github.com/proj4js/proj4js` registers and transforms the Mars CRS definitions.
- **React and React DOM** — `https://react.dev/` build the application UI.
- **TypeScript** — `https://www.typescriptlang.org/` provides the typed build and type checking.
- **Vite and its React/static-copy plugins** — `https://vite.dev/`, `https://github.com/vitejs/vite-plugin-react`, and `https://github.com/sapphi-red/vite-plugin-static-copy` provide the dev server, production build, code splitting, and Cesium asset copying.
- **Tailwind CSS and @tailwindcss/vite** — `https://tailwindcss.com/` and `https://github.com/tailwindlabs/tailwindcss` provide the token-based styling system.
- **IBM Plex Sans and Mono via Fontsource** — `https://fontsource.org/` and `https://github.com/IBM/plex` supply the locally bundled fonts with no Google Fonts request.
- **Lucide React** — `https://lucide.dev/` supplies the locally bundled interface icons.
- **class-variance-authority, clsx, and tailwind-merge** — `https://cva.style/`, `https://github.com/lukeed/clsx`, and `https://github.com/dcastil/tailwind-merge` provide component variants and class composition.
- **react-markdown, remark-math, rehype-katex, and KaTeX** — `https://github.com/remarkjs/react-markdown`, the remark-math monorepo at `https://github.com/remarkjs/remark-math`, and `https://katex.org/` render Copilot math and Markdown.
- **Node.js** — `https://nodejs.org/` runs the build, asset-preparation, and test scripts.
- **Wrangler** — `https://developers.cloudflare.com/workers/wrangler/` develops and deploys the Cloudflare Worker.

## Attribution and Licensing Notes

- Repository code is licensed under Apache-2.0 (`LICENSE`); that license does not grant rights to NASA, USGS, ESA, IAU, Esri, Caltech, or other third-party data, imagery, services, or trademarks.
- Dataset credits are stored in the catalog and shown in the interface; NASA/JPL-Caltech/MSSS, NASA Ames, USGS Astrogeology, ESA Mars Express, ASU, Caltech, Esri, Rice University, IAU WGPSN, and MEDA team credits must remain with their data.
- The 3D globe uses CesiumJS with public NASA Trek MOLA and Esri-hosted Global CTX tiles on a Mars sphere; no Cesium ion content or `VITE_CESIUM_ION_TOKEN` is used by the current build.
- Source CRS declarations such as `urn:ogc:def:crs:EPSG::104905` are preserved as metadata only; SOLARA renders with its documented Mars-sphere projection, and Trek's scale denominators are not treated as verified ground resolution.
- Prepared GeoJSON, raster, DEM-grid, and capabilities assets are snapshots produced on the dates recorded in their catalog records and sidecars; upstream changes do not propagate automatically.
- All external data endpoints listed are public and documented; no private or undocumented endpoint is used, and upstream credentials exist only as server-side Worker secrets (`OPENROUTER_API_KEY`; the reserved `NASA_API_KEY` is currently unused).
- The Esri-hosted Global CTX V01 service is marked beta upstream and is presented as optional context; MEDA observations are historical in-situ measurements, never live weather, and route candidates are prototype terrain-cost results, not validated or safe routes.
- OpenRouter output is AI-generated and is not a verified scientific source; the Worker is intended for local development until authentication and rate limiting are added.
- IBM Plex fonts are distributed under the SIL Open Font License; all other libraries retain their upstream licenses, as recorded in `package.json` and the package lockfile.
- NASA, USGS, ESA, and IAU names identify source material and do not imply endorsement; SOLARA is not an official NASA product.
