# SOLARA — Design System and Interface Direction

> **Purpose of this document:** Establish a restrained, credible scientific-interface design for Habitat Mode and Field Tablet Mode. Avoid generic AI-generated dashboard aesthetics. The map and scientific information are the product.

## 1. Product design direction

SOLARA should feel like a serious planetary field-science and mission-planning instrument.

Desired qualities:
- Scientific and credible.
- Calm, precise, and information-rich.
- Premium but restrained.
- Built around the map and the task.
- Readable in both a habitat workstation and a field tablet.
- Clear about uncertainty, source, time, and data quality.

The interface should resemble a practical geospatial/scientific instrument, not a futuristic movie prop or a generic SaaS dashboard.

## 2. Explicitly avoid “AI slop”

Do not use:
- Purple, violet, or blue/purple gradient backgrounds.
- Neon glows, glowing borders, or excessive bloom.
- Random glassmorphism.
- Decorative starfields, floating particles, or space-themed wallpaper behind every screen.
- Huge rounded cards for every piece of information.
- Oversized hero headings that waste map space.
- Random abstract 3D objects or decorative planets.
- Unnecessary animated orbital paths.
- Excessive badges, pills, and status chips.
- Decorative charts with fake values.
- Fake live telemetry, fake weather, or invented NASA statistics.
- Generic stock images where real scientific source imagery should be shown.
- Emoji as primary interface icons.
- Animations that make map interactions feel slower.
- Repetitive cards nested inside other cards.

Do not add visual effects merely because they look “futuristic”. Every element must improve navigation, understanding, or trust.

## 3. Visual language

Use a dark, neutral, instrument-like interface with restrained accent colors. Let real Mars imagery and scientific map layers provide the strongest visual color.

Suggested starting design tokens (adjust only when there is a clear reason):

```css
:root {
  --solara-bg: #0d1114;
  --solara-panel: #141a1e;
  --solara-panel-raised: #1a2227;
  --solara-border: #2a343a;

  --solara-text: #edf1f2;
  --solara-text-muted: #a2adb3;
  --solara-text-subtle: #748188;

  --solara-accent: #d49a58;
  --solara-accent-soft: #8f673c;

  --solara-info: #82aeb5;
  --solara-success: #83a98c;
  --solara-warning: #d1a15c;
  --solara-danger: #cc7770;

  --solara-map-planned-route: #e0a85f;
  --solara-map-rover-track: #7eb2bd;
  --solara-map-waypoint: #f0e7d8;
}
```

Color rules:
- Charcoal and neutral surfaces establish the workspace.
- Amber is the restrained primary interaction accent and may identify a planned route.
- Muted teal/cyan may distinguish rover observations or informational overlays.
- Red is reserved for a genuine, source-supported hazard or error. It must not be used to dramatize uncertain terrain.
- Green indicates a verified positive state, not general decoration.
- Geological layer colors must follow a readable legend and, where relevant, the source map's geological conventions.
- Always pair color with a label, symbol, line style, or other cue. Do not encode meaning by color alone.

## 4. Typography and data presentation

- Use a clean UI sans-serif such as Inter or a high-quality system sans-serif.
- Use a monospaced face for coordinates, timestamps, dataset IDs, and technical measurements.
- Keep body text compact but comfortably readable.
- Use consistent numeric formatting and units.
- Distinguish a parameter label from its value.
- Align numeric columns and use tabular numerals where supported.
- Do not show unexplained abbreviations. Provide a tooltip or short explanation for scientific terms.
- Every measurement should expose its unit and, where relevant, time and source.

Suggested hierarchy:
- Page/workspace title: restrained, not oversized.
- Panel title: medium emphasis.
- Section label: small uppercase or muted.
- Measurement: prominent enough to scan, not oversized.
- Metadata: compact and muted, but never illegible.

## 5. Habitat Mode — desktop mission planning

### Primary layout

The map is the central workspace and should receive the majority of screen area.

Suggested desktop composition:

```text
+--------------------------------------------------------------------+
| SOLARA | Region / Mission | Data status | Habitat / Field | Menu    |
+----------------+----------------------------------+----------------+
| LEFT PANEL     |                                  | RIGHT PANEL    |
|                |                                  |                |
| Layer catalog  |          MAIN MARS MAP           | Selected item  |
| Data sources   |                                  | Dataset info   |
| Search region  |     imagery / terrain / geology  | Route details  |
| Mission items  |     rover / waypoints / route    | Elevation      |
|                |                                  | Observations   |
+----------------+----------------------------------+----------------+
| Coordinate readout | Scale | Projection / CRS | Attribution       |
+--------------------------------------------------------------------+
```

The left panel is for navigation, datasets, and mission contents. The right panel is contextual: it changes based on the selected layer, location, target, waypoint, or route.

Avoid filling the screen with unrelated metric cards. The user should always understand which geographic area is being inspected.

### Habitat Mode interactions

- Search or choose a region.
- Toggle layers and adjust opacity.
- Inspect source metadata from a layer.
- Click the map to inspect a coordinate.
- Add/remove waypoints.
- Select start and destination.
- Generate a route only when the required DEM and metadata are valid.
- Inspect route profile and warnings.
- Compare source layers without losing geographic context.

Use concise, clear labels such as:
- `Optical imagery`
- `Elevation`
- `Slope`
- `Geology`
- `Rover traverse`
- `Surface images`
- `Environmental observations`

Do not use vague labels such as `AI terrain intelligence` unless there is a real, documented analytical method behind the feature.

## 6. Field Tablet Mode — touch-first surface operations

Field Tablet Mode is not simply the desktop page squeezed onto a smaller screen.

It must prioritize:
1. The map and planned route.
2. Current or manually selected position, clearly identified.
3. Next waypoint and distance.
4. Known terrain concerns and unknown-data areas.
5. Essential destination information.
6. Timestamped environmental observations when available.

### Tablet layout

- Map occupies most of the screen.
- Use a compact top status bar.
- Put secondary information in a bottom sheet or collapsible side panel.
- Use large, clearly separated touch controls.
- Keep the number of visible controls small.
- Make the next waypoint and route direction easy to identify.
- Avoid dense tables and multi-column metadata views.
- Provide an obvious way to return to the full map.
- Ensure controls work with large touch targets and do not rely on hover.

Touch targets should generally be at least 44–48 CSS pixels, with generous spacing. Use strong contrast and readable text. Do not assume the astronaut has a mouse or keyboard.

### Field mode information hierarchy

Most important:
- Mission / route name.
- Position status (actual, manually selected, or simulated).
- Next waypoint.
- Distance to waypoint.
- Route line and known concerns.
- Data availability / offline status.

Secondary:
- Geological notes.
- Surface photograph preview.
- Environmental observations.
- Full dataset provenance.

Never claim actual astronaut location unless a real positioning source is integrated and validated. A demo cursor or simulated position must be labelled.

## 7. Surface imagery and rover photographs

Rover images should be presented as scientific observations, not generic decorative photographs.

Whenever available, show:
- Rover and instrument/camera.
- Capture date/time or Martian sol.
- Image/product identifier.
- Capture coordinates or location description.
- Direction/field-of-view information if supported.
- Source link and attribution.
- Whether the photo is historical and how far its capture location is from the selected target.

If the image location is not known accurately, do not imply that it is the exact view from the selected waypoint.

Use thumbnails in contextual panels and allow an expanded inspection view. Do not let a gallery obscure the map by default.

## 8. Map layer visual rules

- Keep the base imagery legible.
- Use subtle, distinguishable overlays.
- Planned route: restrained amber line with a clear outline/contrast.
- Historical rover traverse: a different line style and color from the proposed route.
- Waypoints: numbered or labelled symbols with a consistent visual system.
- Selected destination: visible selection ring or boundary; avoid neon glow.
- Unknown/no-data areas: explicit hatch, neutral overlay, or a clear unknown indicator. Never make them appear safe.
- Slope: use a documented legend and units.
- Geology: use source-aligned categories and a readable legend.
- Every overlay must have a legend and an explanation.
- Layer opacity controls should not create unreadable combinations.

Do not use one color for both historical rover paths and proposed astronaut routes.

## 9. Data provenance and trust UI

Scientific trust is a major part of the design.

A selected layer or measurement should make it easy to inspect:
- Dataset name and ID.
- Provider / mission / instrument.
- Source link.
- Spatial resolution.
- Spatial coverage.
- Coordinate reference system.
- Observation/acquisition date or range.
- Units.
- Verification status.
- Known limitations.

Use clear status text:
- `Verified source`
- `Tested in map`
- `Historical observation`
- `Derived from DEM`
- `Outside coverage`
- `No data`
- `Source unavailable`
- `Unverified`

Do not rely on color badges alone. Include meaningful text.

## 10. Loading, error, and uncertainty states

Design these states deliberately:

- Loading layer: identify which layer is loading; do not freeze the whole interface.
- No coverage: explain that the selected dataset does not cover the area.
- NoData: show unknown/NoData distinctly from zero.
- Stale observation: show the observation timestamp and that it is historical.
- Source failure: preserve other functioning layers and offer retry where appropriate.
- CRS mismatch: block or clearly disable the layer rather than showing a misleading overlay.
- Route unavailable: explain whether the DEM is missing, the destination is outside coverage, or no path exists under the chosen cost model.
- Partial route: mark the incomplete segment and explain why it is unknown.

Never fill missing values with fabricated defaults.

## 11. Motion and interaction feedback

- Use subtle transitions, generally around 120–180 ms.
- Use motion to confirm a panel opening, selection, or state change.
- Do not animate the map unnecessarily.
- Do not animate every card on initial load.
- Avoid parallax and continuous background motion.
- Respect `prefers-reduced-motion`.
- Keep map pan, zoom, selection, and route actions responsive.

## 12. Accessibility and usability

- Maintain strong text/background contrast.
- Do not rely on color alone.
- Provide visible focus states and keyboard access in Habitat Mode.
- Provide labels for icon-only buttons.
- Use adequate touch target size in Field Tablet Mode.
- Ensure map controls do not cover important map content.
- Use plain language for warnings and scientific limitations.
- Keep critical route and data-status information readable at a glance.
- Support zoomed text without breaking the layout.

## 13. Responsive behavior

Habitat Mode is desktop-first. Field Tablet Mode is tablet-first.

Do not automatically assume that every narrow viewport means Field Tablet Mode. Provide a deliberate mode switch. The layout may adapt to viewport width, but the information hierarchy should follow the selected operating mode.

For a phone-sized viewport, treat the application as a limited review experience unless the team explicitly chooses to support full field operation on phones.

## 14. Content and microcopy rules

Use direct, scientific wording.

Good:
- `Observed 2025-06-14`
- `Elevation: 1,842 m`
- `Slope: 12.4°`
- `No DEM coverage`
- `Historical rover image`
- `Proposed route`
- `Terrain cost: elevated`
- `Unknown surface conditions`

Bad:
- `Live Mars weather` when showing old data.
- `Safe route` for an unvalidated cost-surface path.
- `Danger detected` when only slope is known.
- `AI-powered planetary intelligence` without a real AI capability.
- `Mission-ready` unless all required checks are genuinely satisfied.

Use the correct source timestamp and units. If a value is illustrative in a design mock, mark it as sample data and never ship it as a scientific reading.

## 15. Final design test

Before accepting a screen, ask:

1. Does the map remain the primary workspace?
2. Can the user understand what each layer represents?
3. Can the user find the data source and timestamp?
4. Is unknown information clearly different from a measured safe condition?
5. Does the interface support the actual task of preparing or executing a Marswalk?
6. Is this element useful, or is it decoration?
7. Does Field Tablet Mode remain usable with touch and limited attention?
8. Does the screen still look credible without gradients, glows, and decorative animation?

If a visual element does not improve understanding or task completion, remove it.