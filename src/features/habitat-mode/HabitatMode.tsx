/**
 * HabitatMode — desktop mission-operations workstation (Context.md §4.1).
 *
 * Layout (Design.md §5): top bar / [Mission Operations | map | Inspector +
 * Copilot workspace] / status bar. The map is the primary workspace. All map
 * state flows through plain serializable values; OpenLayers objects stay
 * inside MarsMap. The Copilot conversation is in-memory component state —
 * lost on reload, consistent with the mission store philosophy.
 *
 * The right workspace (ContextWorkspace) is tabbed, resizable and
 * collapsible; its `open` state is shared between the overlay drawer (< lg)
 * and the docked desktop panel, and initializes open on desktop widths.
 *
 * MarsMap (which pulls in OpenLayers, the largest dependency) is loaded
 * lazily via React.lazy so the initial application shell stays lightweight
 * (Architecture.md §12: lazy-load major workspaces). The Suspense fallback
 * is the deliberate empty-map presentation shown while the map engine
 * chunk loads; the map lifecycle itself is unchanged.
 */

import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import type { MarsMapHandle } from '../../map/MarsMap';
import type { MapLocation, OverlayStatusMap, SourceStatus, ViewInfo } from '../../map/mapTypes';
import { getAllDatasets, getAllRegions, getDatasetById } from '../../data/catalog/datasets';
import type { LayerUiState } from './components/MissionOperationsPanel';
import { MissionOperationsPanel } from './components/MissionOperationsPanel';
import { CopilotPanel, type CopilotContextPayload } from './components/CopilotPanel';
import {
  ContextWorkspace,
  WORKSPACE_DEFAULT_WIDTH,
  type ContextWorkspaceTab,
} from './components/ContextWorkspace';
import { InspectorPanel } from './components/InspectorPanel';
import type { ElevationState } from './components/LocationPanel';
import { buildPlanFile, computeRoute, importPlanFile, useMissionState } from '../mission/store';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { formatDistance, formatLat, formatLon, formatUtcTime } from '../../lib/format';
import { isInsideBoundingBox } from '../../lib/bbox';
import { cn } from '../../lib/utils';

const MarsMap = lazy(() => import('../../map/MarsMap'));

const DATASETS = getAllDatasets();
const REGIONS = getAllRegions();
const REGION = REGIONS[0]!;

/** WMTS base layers, bottom-first rendering order (topography under imagery). */
const BASE_LAYER_IDS = ['mola-hrsc-blend-200m-colorshade', 'jezero-ctx-mosaic-soc-008'] as const;
/** Prepared GeoJSON overlay datasets, bottom-first rendering order. */
const OVERLAY_IDS = [
  'usgs-sim3292-jezero-geology',
  'mars2020-landing-ellipse',
  'mars2020-perseverance-traverse',
] as const;

const INITIAL_DATASET_ID = REGION.datasetIds[0] ?? '';

const OVERLAY_ID_SET: ReadonlySet<string> = new Set(OVERLAY_IDS);

/** Fixed honesty statement attached to every Copilot request. */
const DATA_NOT_AVAILABLE_CONTEXT =
  'Not available in SOLARA data: weather, temperature, pressure, wind, dust, and radiation ' +
  'observations; real-time rover position (historical track through sol 1176 only); site-scale ' +
  'slope, hazards, or rock abundance; route safety validation; image content (the Copilot cannot ' +
  'see map imagery). Environmental values are unknown unless a dataset is integrated.';

/** Copilot context sections stay compact (each ≤ ~600 chars). */
const clamp600 = (value: string): string => (value.length <= 600 ? value : value.slice(0, 600));

/** Deliberate empty-map presentation while the map engine chunk loads. */
function MapWorkspaceFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div
        className="flex items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-ink-muted"
        data-testid="map-workspace-loading"
      >
        <span className="inline-block size-2 rounded-full bg-accent opacity-40" aria-hidden="true" />
        Loading map engine…
      </div>
    </div>
  );
}

export default function HabitatMode({ onSwitchToTablet }: { onSwitchToTablet?: () => void }) {
  const mapApi = useRef<MarsMapHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mission = useMissionState();

  const [layerStates, setLayerStates] = useState<Record<string, LayerUiState>>(() => {
    const initial: Record<string, LayerUiState> = {};
    for (const id of [...BASE_LAYER_IDS, ...OVERLAY_IDS]) {
      // Initial presentation (Revision 2): CTX imagery is the default base;
      // the scientific colorshade raster stays off until asked for.
      initial[id] = { visible: id === 'jezero-ctx-mosaic-soc-008', opacity: 1 };
    }
    return initial;
  });
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(INITIAL_DATASET_ID);
  const [pointerLocation, setPointerLocation] = useState<MapLocation | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null);
  const [viewInfo, setViewInfo] = useState<ViewInfo | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>({
    capabilities: 'checking',
    lastCheckedAt: null,
    message: 'Checking source…',
  });
  const [overlayStatus, setOverlayStatus] = useState<OverlayStatusMap>({});
  const [locationElevation, setLocationElevation] = useState<ElevationState | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  /* One boolean drives both the desktop docked panel and the <lg overlay
   * drawer; initialize open on desktop widths. */
  const [workspaceOpen, setWorkspaceOpen] = useState(() => window.innerWidth >= 1024);
  const [workspaceTab, setWorkspaceTab] = useState<ContextWorkspaceTab>('inspector');
  const [workspaceWidth, setWorkspaceWidth] = useState(WORKSPACE_DEFAULT_WIDTH);

  const selectedDataset = getDatasetById(selectedDatasetId);

  const handleToggleVisibility = useCallback((id: string, visible: boolean) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { opacity: 1 }), visible } }));
  }, []);

  const handleOpacityChange = useCallback((id: string, opacity: number) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { visible: true }), opacity } }));
  }, []);

  const handleFitRegion = useCallback(() => {
    mapApi.current?.fitToRegion();
  }, []);

  const baseLayers = BASE_LAYER_IDS.map((datasetId) => ({
    datasetId,
    ...(layerStates[datasetId] ?? { visible: false, opacity: 1 }),
  }));
  const overlays = OVERLAY_IDS.map((datasetId) => ({
    datasetId,
    visible: layerStates[datasetId]?.visible ?? false,
  }));

  /* --- Copilot context (per-send payload, built from real app state) --- */
  const copilotContext = useMemo<CopilotContextPayload>(() => {
    const bbox = REGION.boundingBox;
    const explorationRegion = clamp600(
      `${REGION.name}. Exploration bounding box: ${formatLon(bbox.westLon)} – ${formatLon(bbox.eastLon)}, ` +
        `${formatLat(bbox.southLat)} – ${formatLat(bbox.northLat)} ` +
        '(≈ 30.3 × 30.2 km ground estimate). Verified against the live Trek capabilities documents 2026-11-13.',
    );

    let selectedLocationContext: string;
    if (!selectedLocation) {
      selectedLocationContext = 'none selected';
    } else {
      const inside = isInsideBoundingBox(selectedLocation, bbox);
      const parts = [
        `Selected point: ${formatLon(selectedLocation.lon)} ${formatLat(selectedLocation.lat)}`,
        `Working projection: X ${Math.round(selectedLocation.x)} m, Y ${Math.round(selectedLocation.y)} m`,
        inside
          ? 'Inside the exploration region.'
          : 'Outside the exploration region — global imagery and elevation products only; route planning unavailable here.',
      ];
      const elev = locationElevation;
      if (!elev || elev.kind === 'idle' || elev.kind === 'loading') {
        parts.push('Elevation: query pending.');
      } else if (elev.kind === 'live') {
        parts.push(
          `Elevation: ${elev.value.toLocaleString('en-US')} m (areoid-referenced; queried from the Trek DEM service — static MOLA+HRSC blend, 2018 v2; queried ${formatUtcTime(elev.fetchedAt)}).`,
        );
      } else if (elev.kind === 'no-data') {
        parts.push('Elevation: unknown (the DEM service reports NoData at this point).');
      } else {
        const fallback =
          elev.fallbackValue !== null
            ? ` Prepared-grid fallback: ${Math.round(elev.fallbackValue).toLocaleString('en-US')} m (derived, labelled).`
            : '';
        parts.push(`Elevation: unknown (live query failed).${fallback}`);
      }
      selectedLocationContext = clamp600(parts.join(' '));
    }

    const visibleLayers = clamp600(
      [...BASE_LAYER_IDS, ...OVERLAY_IDS]
        .map((id) => {
          if (!(layerStates[id]?.visible ?? false)) return `${id}: OFF`;
          if (OVERLAY_ID_SET.has(id)) return `${id}: ${(overlayStatus[id] ?? 'loading').toUpperCase()}`;
          return `${id}: ACTIVE`;
        })
        .join('; '),
    );

    const missionPlan = clamp600(
      [
        `Start: ${mission.start ? `${formatLon(mission.start.lon)} ${formatLat(mission.start.lat)}` : 'not set'}.`,
        `Target: ${mission.target ? `${formatLon(mission.target.lon)} ${formatLat(mission.target.lat)}` : 'not set'}.`,
        `Prototype cost params: slope cost ${mission.params.slopeCostPerDeg.toFixed(3)}/deg, block slope ${mission.params.maxSlopeDeg}° (prototype thresholds — not operational safety limits).`,
        mission.routeStatus === 'computing'
          ? 'Route: computing…'
          : mission.route
            ? `Route candidate: ground ${formatDistance(mission.route.totalGroundDistanceM)}, cost-equivalent ${formatDistance(mission.route.totalCostM)}, direct ${formatDistance(mission.route.directDistanceM)}, ${mission.route.warnings.length} warning(s)${mission.route.warnings.length > 0 ? `: ${mission.route.warnings.join(' ')}` : ''}. PROPOSED TERRAIN-COST CANDIDATE — not a validated or safe route.`
            : 'Route: none computed.',
      ].join(' '),
    );

    return {
      explorationRegion,
      selectedLocation: selectedLocationContext,
      visibleLayers,
      missionPlan,
      dataNotAvailable: DATA_NOT_AVAILABLE_CONTEXT,
    };
  }, [selectedLocation, locationElevation, layerStates, overlayStatus, mission]);

  const handleExportPlan = useCallback(() => {
    const plan = buildPlanFile();
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solara-plan-${plan.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback((file: File) => {
    void file
      .text()
      .then((text) => {
        const parsed: unknown = JSON.parse(text);
        importPlanFile(parsed);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen min-h-0 flex-col gap-3 p-3 bg-surface overflow-hidden">
      <TopBar
        regionLabel={REGION.name}
        sourceStatus={sourceStatus}
        onFitRegion={handleFitRegion}
        onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
        onToggleRightPanel={() => setWorkspaceOpen((v) => !v)}
        onSwitchToTablet={onSwitchToTablet}
      />

      <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* Left panel — mission operations */}
        <aside
          className={cn(
            'absolute inset-y-0 left-0 z-20 w-80 flex-col overflow-y-auto rounded-xl border border-edge bg-panel shadow-2xl lg:static lg:z-auto lg:flex lg:shadow-none',
            leftPanelOpen ? 'flex' : 'hidden lg:flex',
          )}
          aria-label="Mission operations"
        >
          <MissionOperationsPanel
            region={REGION}
            datasets={DATASETS}
            layerStates={layerStates}
            overlayStatus={overlayStatus}
            selectedLocation={selectedLocation}
            onSelectDataset={setSelectedDatasetId}
            onToggleVisibility={handleToggleVisibility}
            onOpacityChange={handleOpacityChange}
            onFitRegion={handleFitRegion}
          />
        </aside>

        {/* Main map workspace — rounded instrument card */}
        <main className="relative min-w-0 flex-1 rounded-lg border border-edge bg-surface overflow-hidden shadow-sm">
          <Suspense fallback={<MapWorkspaceFallback />}>
            <MarsMap
              ref={mapApi}
              baseLayers={baseLayers}
              overlays={overlays}
              regionBoundingBox={REGION.boundingBox}
              routeVisible
              start={mission.start}
              target={mission.target}
              route={mission.route}
              selectedMarker={selectedLocation}
              onPointerLocationChange={setPointerLocation}
              onLocationSelect={setSelectedLocation}
              onViewChange={setViewInfo}
              onSourceStatusChange={setSourceStatus}
              onOverlayStatusChange={setOverlayStatus}
            />
          </Suspense>
        </main>

        {/* Right workspace — tabbed Inspector | Copilot, resizable and
            collapsible (overlay drawer below lg). */}
        <ContextWorkspace
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          tab={workspaceTab}
          onTabChange={setWorkspaceTab}
          width={workspaceWidth}
          onWidthChange={setWorkspaceWidth}
          inspector={
            <InspectorPanel
              location={selectedLocation}
              region={REGION}
              dataset={selectedDataset}
              onElevationStateChange={setLocationElevation}
            />
          }
          copilot={<CopilotPanel context={copilotContext} />}
        />
      </div>

      <StatusBar
        pointerLocation={pointerLocation}
        selectedLocation={selectedLocation}
        elevationState={locationElevation}
        viewInfo={viewInfo}
        dataset={selectedDataset}
        sourceStatus={sourceStatus}
        canComputeRoute={mission.start !== null && mission.target !== null}
        computingRoute={mission.routeStatus === 'computing'}
        onComputeRoute={() => computeRoute()}
        onExportPlan={handleExportPlan}
        onImportPlan={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
