# SOLARA — Project Context

> **Purpose of this document:** Give every developer and coding agent the same understanding of what SOLARA is, what problem it solves, what we are building for the hackathon, and what is explicitly out of scope.

## 1. Project identity

- **Project:** SOLARA
- **Event:** NASA International Space Apps Challenge 2026
- **Challenge:** *Interplanetary Survival Guide: Martian Map*
- **Team:** Three members
- **Hackathon target:** A working, demonstrable MVP built in three days
- **Primary world:** Mars
- **Initial detailed exploration region:** Jezero Crater, subject to a source-coverage and data-quality audit before we treat it as final
- **Primary interfaces:** Habitat Mode and Field Tablet Mode

SOLARA is an integrated Martian surface-intelligence and mission-planning application. It combines relevant scientific observations from multiple NASA and other authoritative planetary-science sources into a map-centred experience that helps a human explorer understand a selected area, investigate scientific targets, and plan a preliminary surface traverse.

The long-term vision can expand to other Martian regions and eventually other planetary bodies. The hackathon product must stay focused on the Mars surface exploration challenge.

## 2. The problem

NASA missions have collected extensive Mars imagery, topography, geological information, rover observations, and environmental measurements. These data are distributed across different missions, archives, instruments, file formats, coordinate systems, spatial resolutions, and time periods.

A person trying to understand one local exploration area may have to locate separate datasets, inspect their metadata, understand their projections, process them, align them, and compare them manually. Global mapping tools are useful, but a human surface excursion requires a more localized view that brings the relevant information together around a specific destination and route.

The challenge asks for a layered, integrated Martian surface map that could help an astronaut plan and carry out a Marswalk while conducting science.

## 3. SOLARA's solution

SOLARA brings selected planetary datasets into one coherent exploration workspace. It does more than display independent map layers: it helps users interpret how imagery, terrain, geology, rover observations, and environmental measurements relate to a proposed excursion.

The core value is:

**Turn distributed Martian science data into understandable, location-specific exploration intelligence.**

SOLARA is a planning and situational-awareness prototype. It is not a certified astronaut navigation system, an operational NASA tool, or a guarantee of a safe route.

## 4. Primary users and operating modes

### 4.1 Habitat Mode — plan before leaving

A desktop-oriented mission-planning workspace used in a habitat or spacecraft.

The user should be able to:

1. Browse Mars and select an area with adequate data coverage.
2. Inspect imagery, topography, geology, rover observations, and available environmental context.
3. Identify scientific targets and add them as waypoints.
4. Choose a start point and destination.
5. Generate and inspect a preliminary terrain-cost route.
6. Review route distance, ascent/descent, elevation profile, known terrain concerns, and data gaps.
7. Save or export a mission plan for use in Field Tablet Mode.

Habitat Mode may expose dense metadata, layer controls, source provenance, and detailed analysis panels because the user is preparing and reviewing a mission.

### 4.2 Field Tablet Mode — use during the excursion

A touch-first, simplified interface for a rugged tablet carried on the Martian surface.

The user should be able to:

1. Open a prepared mission plan.
2. See the selected area, route, waypoints, and current/selected position when position data is available.
3. Inspect the next waypoint and distance.
4. View relevant surface imagery and scientific target notes.
5. Review known terrain concerns and timestamped environmental observations.
6. Access the prepared data when external connectivity is unavailable, to the extent supported by the MVP.

Field Tablet Mode must reduce clutter and prioritize immediate decisions. The MVP may simulate or manually select the astronaut's position. Do not imply that real Mars GPS or live astronaut tracking exists.

### 4.3 One application, shared mission data

Habitat Mode and Field Tablet Mode are two interfaces over the same application logic, data catalog, map layers, and mission-plan model. They are not two separate products.

Do not promise automatic synchronization between two physical devices without implementing and testing a synchronization mechanism. For the initial no-backend MVP, use the same browser session or an explicit mission-plan export/import workflow.

A spacesuit HUD is a possible future concept, not an MVP interface.

## 5. Geographic scope

SOLARA should be designed so it is not permanently hard-coded to Jezero Crater.

Use two levels of geographic capability:

- **Global context:** A Mars-wide overview using genuinely global datasets where their resolution and coverage support the displayed purpose. This helps users discover regions and understand broad context.
- **Detailed local planning:** High-resolution, data-rich coverage for a selected exploration area. Jezero Crater is the initial candidate because the project research has identified relevant CTX, Mars 2020 / PLACES, MOLA, and geological resources. Its final suitability must be confirmed by checking actual spatial footprints, coordinate metadata, resolution, access, and alignment.

Do not display global low-resolution data as if it supports local hazard avoidance. Do not claim detailed operational coverage outside the verified high-resolution region.

Future regions, such as Gale Crater, should be added only after their source coverage and processing requirements are evaluated.

## 6. MVP feature priorities

### Critical

- Mars map with zoom, pan, coordinates, and a clear selected area.
- Layered scientific visualization with source attribution.
- At least three genuinely integrated data categories where available:
  - Optical imagery.
  - Topographic elevation and derived slope.
  - Geological information.
- Clear dataset metadata: source, instrument/mission, spatial coverage, resolution, coordinate reference system, and observation/acquisition time where applicable.
- Start point, destination, and waypoint selection.
- Preliminary terrain-aware route planning from a verified DEM-derived cost surface.
- Route distance and elevation profile.
- A mission summary that describes the route and its known data limitations.
- Habitat and Field Tablet layouts sharing the same mission data.

### High-value additions, only when verified and feasible

- Rover traverse and localization.
- Rover surface imagery associated with capture locations.
- Environmental observations such as MEDA measurements.
- Regional dust or atmospheric context from suitable orbital observations.
- Thermal, spectral, radiation, or illumination information when relevant data is available for the selected area and time.

### Not required for the MVP

- Full Solar System / eight-planet simulator.
- Detailed exploration maps for every planet.
- Authentication, user profiles, social features, chatbots, or a dashboard unrelated to mission planning.
- Live spacecraft telemetry.
- Live Mars weather forecasting unless a verified forecast product is actually available and correctly interpreted.
- Certified astronaut safety calculations.
- A fully autonomous mission-control system.
- Spacesuit HUD hardware integration.
- A complicated backend or database without a demonstrated need.
- Full global, high-resolution, hazard-grade mapping of Mars.

## 7. Scientific honesty and data terminology

Every displayed scientific value must be distinguishable as one of the following:

- **Observed:** Direct measurement or image from a named instrument, with location and time metadata.
- **Derived:** Calculated from source data, such as slope calculated from a DEM. Show the method and source dataset.
- **Modelled / predicted:** Output from a named, verified model with its time horizon and limitations.
- **Historical:** Valid measurement from an earlier time. It must not be presented as current conditions.
- **Unavailable / unknown:** No suitable value or reliable coverage. Unknown must never be interpreted as safe.

Specific rules:

- Never call delayed or historical observations “live weather”.
- Do not issue a “storm warning” unless a suitable, verified observation or forecast supports it. Label dust observations with their timestamps and spatial coverage.
- Do not describe a terrain-cost route as the “safest route”. Use terms such as **proposed route**, **lowest estimated terrain-cost route**, or **terrain-aware candidate route**.
- A DEM-derived slope layer does not reveal every rock, hole, unstable surface, or subsurface hazard.
- A rover photograph is historical imagery from a known camera and capture location, not a guaranteed view of what an astronaut will see now.
- Never fabricate sample readings, coordinates, image times, rover positions, or data coverage.

## 8. Product principles

1. Scientific credibility before feature count.
2. The map is the primary workspace, not a decorative background.
3. Every layer must have a purpose and source.
4. Unknown data must be visible as unknown.
5. Global context and local detail must not be confused.
6. Habitat planning and field execution should share one mission model.
7. Keep the MVP small enough to finish and validate in three days.
8. Prefer a working, measured capability over an impressive but simulated feature.

## 9. MVP demonstration story

A user opens Habitat Mode, selects the verified Jezero exploration area, enables optical, topographic, and geological layers, inspects a scientific target, reviews available rover observations, selects a start point and destination, and generates a preliminary terrain-cost route.

SOLARA displays the proposed path, distance, elevation profile, terrain-derived concerns, source timestamps, and areas where data is missing or too coarse. The user prepares a mission plan and opens it in Field Tablet Mode, where the route and scientific waypoints are presented in a simplified touch-first layout.

The demonstration must use real, validated data for every claim it makes. Any simulated user location or placeholder data must be clearly labelled.

## 10. Development collaboration

The intended workflow is:

- **OpenCode + GLM 5.3 Flash:** Primary implementation agent. It must inspect the repository and read these project documents before modifying code.
- **Codex CLI:** Later code review, debugging, correctness checks, and finishing work.
- **Agy:** Small, isolated tasks where useful.

Do not let multiple coding agents modify the same files simultaneously. Use Git commits between meaningful stages. Preserve existing code and inspect before replacing architecture.

## 11. Definition of done

The MVP is not done merely because the interface looks polished.

A credible MVP must demonstrate:

- A map that loads real, attributable source data.
- Correct coordinate handling and alignment for the integrated layers.
- At least three useful scientific data categories, where source availability permits.
- A route generated from actual terrain data rather than a decorative line.
- Correct route distance and an elevation profile.
- Visible timestamps, provenance, resolution, and data limitations.
- A usable Habitat Mode and Field Tablet Mode.
- No fabricated live conditions or unsupported safety claims.