/**
 * FieldTabletMode — touch-first surface-operations layout (Context.md §4.2,
 * Design.md §6, Solara UI visual reference).
 *
 * The map dominates; secondary information lives in a collapsible bottom
 * sheet. The astronaut position is a manually selected (SIMULATED) point.
 * Large touch targets (>= 44 px), consistent corner radii and monochrome styling.
 */

import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import { ChevronDown, Download, Play, RotateCcw, Upload } from 'lucide-react';
import type { RouteResult } from '../../workers/routeClient';
import { getAllDatasets, getAllRegions, getDatasetById } from '../../data/catalog/datasets';
import type { MapFeatureSelection, MapLocation, OverlayStatusMap } from '../../map/mapTypes';
import type { LayerUiState } from '../habitat-mode/components/MissionOperationsPanel';
import { DATASET_SHORT_NAMES } from '../habitat-mode/components/MissionOperationsPanel';
import { RoverPovPanel } from '../rover-pov/RoverPovPanel';
import {
  buildPlanFile,
  clearRoute,
  computeRoute,
  importPlanFile,
  setStart,
  setTarget,
  setPosition,
  useMissionState,
} from '../mission/store';
import { groundDistanceMeters } from '../../science/terrain/geometry';
import { formatDistance, formatLat, formatLon } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { ElevationProfile } from '../mission/components/ElevationProfile';
import { RouteSummary } from '../mission/components/RouteSummary';
import { cn } from '../../lib/utils';

const MarsMap = lazy(() => import('../../map/MarsMap'));
const MarsGlobe = lazy(() => import('../mars-globe/MarsGlobe'));

const DATASETS = getAllDatasets();
const REGIONS = getAllRegions();
const REGION = REGIONS[0]!;

/**
 * Base layers, bottom-first: global topography, global Viking optical context.
 * The Jezero CTX WMTS layer is intentionally not rendered — its ~30 × 30 km
 * footprint showed as a grayscale square over the global layers (verified
 * 2026-11-15). Catalog record and service code are preserved for reuse.
 */
const BASE_LAYER_IDS = [
  'mola-hrsc-blend-200m-colorshade',
  'mars-viking-mdim21-colorized-global',
] as const;
const OVERLAY_IDS = ['usgs-sim3292-jezero-geology', 'mars2020-landing-ellipse', 'mars2020-perseverance-traverse', 'mars2020-science-stops', 'jezero-iau-nomenclature', 'jezero-hydrous-minerals-omega-crism'] as const;

function MapWorkspaceFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="flex items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-ink-muted">
        <span className="inline-block size-2.5 rounded-full bg-accent opacity-40" aria-hidden="true" />
        Loading map engine…
      </div>
    </div>
  );
}

/** Next-waypoint info for the simulated position. */
interface NextWaypointInfo {
  lon: number;
  lat: number;
  elevM: number;
  distanceToWaypointM: number;
  remainingAlongRouteM: number;
}

function nextWaypointInfo(
  route: RouteResult,
  position: { lon: number; lat: number },
): NextWaypointInfo | null {
  if (route.points.length === 0) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  route.points.forEach((p, i) => {
    const d = groundDistanceMeters(position.lon, position.lat, p.lon, p.lat);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  });
  const p = route.points[bestIndex]!;
  return {
    lon: p.lon,
    lat: p.lat,
    elevM: p.elevM,
    distanceToWaypointM: bestDistance,
    remainingAlongRouteM: route.totalGroundDistanceM - p.cumulativeGroundM,
  };
}

export default function FieldTabletMode({ onExit }: { onExit: () => void }) {
  const mission = useMissionState();
  const [layerStates, setLayerStates] = useState<Record<string, LayerUiState>>(() => {
    const initial: Record<string, LayerUiState> = {};
    for (const id of [...BASE_LAYER_IDS, ...OVERLAY_IDS]) {
      initial[id] = {
        visible: id === 'mars-viking-mdim21-colorized-global' ||
          id === 'mars2020-perseverance-traverse',
        opacity: 1,
      };
    }
    return initial;
  });
  const [sheetOpen, setSheetOpen] = useState(true);
  const [sheetTab, setSheetTab] = useState<'mission' | 'rover'>('mission');
  const [importError, setImportError] = useState<string | null>(null);
  const [overlayStatus, setOverlayStatus] = useState<OverlayStatusMap>({});
  const [selectedFeature, setSelectedFeature] = useState<MapFeatureSelection | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null);
  const [globeActive, setGlobeActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggleVisibility = useCallback((id: string, visible: boolean) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { opacity: 1 }), visible } }));
  }, []);

  const handleOpacityChange = useCallback((id: string, opacity: number) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { visible: true }), opacity } }));
  }, []);

  const baseLayers = BASE_LAYER_IDS.map((datasetId) => ({
    datasetId,
    ...(layerStates[datasetId] ?? { visible: false, opacity: 1 }),
  }));
  const overlays = OVERLAY_IDS.map((datasetId) => ({
    datasetId,
    visible: layerStates[datasetId]?.visible ?? false,
    opacity: layerStates[datasetId]?.opacity ?? 1,
  }));

  const route = mission.route;
  const nextWaypoint =
    mission.position && route ? nextWaypointInfo(route, mission.position) : null;
  const selectedFeatureDataset = selectedFeature
    ? getDatasetById(selectedFeature.datasetId)
    : undefined;

  const handleExport = () => {
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
  };

  const handleImportFile = (file: File) => {
    setImportError(null);
    void file
      .text()
      .then((text) => {
        importPlanFile(JSON.parse(text) as unknown);
      })
      .catch((e: unknown) => {
        setImportError(e instanceof Error ? e.message : String(e));
      });
  };

  const canCompute = mission.start !== null && mission.target !== null && mission.routeStatus !== 'computing';
  const toggleSheet = () => setSheetOpen((v) => !v);

  return (
    <div className="flex h-screen w-screen min-h-0 flex-col gap-2 p-2 sm:gap-3 sm:p-3 bg-surface overflow-hidden">
      {/* Header bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 rounded-xl border border-edge bg-panel px-3">
        <div className="flex items-center gap-2">
          <img src="/solara.svg" alt="" aria-hidden="true" className="size-5 shrink-0" />
          <span className="shrink-0 text-sm font-medium tracking-[0.2em] text-ink">SOLARA</span>
        </div>

        <span className="shrink-0 rounded-sm bg-elevated border border-edge/60 px-2 py-0.5 text-xs font-medium text-ink">
          Field Tablet
        </span>

        {/* Position status chip */}
        <div
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-edge/60 bg-surface/50 px-2 py-1 text-xs text-ink-muted whitespace-nowrap"
          data-testid="position-status"
          title={mission.position ? 'Simulated position (manually set)' : 'No simulated position set yet'}
        >
          <span
            className={cn('size-2 shrink-0 rounded-full', mission.position ? 'bg-warn' : 'bg-ink-subtle')}
            aria-hidden="true"
          />
          <span className="text-[11px] font-medium leading-none">
            {mission.position ? 'SIMULATED' : 'No position'}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 rounded-sm text-xs shrink-0"
          aria-pressed={globeActive}
          onClick={() => setGlobeActive((active) => !active)}
        >
          {globeActive ? '2D Map' : '3D Globe'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 rounded-sm text-xs shrink-0"
          onClick={onExit}
        >
          Habitat
        </Button>
      </header>

      {/* Map — dominant instrument workspace */}
      <main className="relative min-h-0 flex-1 rounded-lg border border-edge bg-surface overflow-hidden shadow-sm">
        {globeActive ? (
          <Suspense fallback={<MapWorkspaceFallback />}>
            <MarsGlobe
              selectedLocation={selectedLocation}
              onLocationSelect={(loc) => {
                setSelectedFeature(null);
                setSelectedLocation(loc);
                setPosition({ lon: loc.lon, lat: loc.lat });
                setSheetTab('mission');
                setSheetOpen(true);
              }}
              onSelectTraverse={() => {
                setSheetTab('rover');
                setSheetOpen(true);
              }}
              onSwitchToMap={() => setGlobeActive(false)}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<MapWorkspaceFallback />}>
            <MarsMap
              baseLayers={baseLayers}
              overlays={overlays}
              regionBoundingBox={REGION.boundingBox}
              routeVisible
              start={mission.start}
              target={mission.target}
              route={route}
              positionMarker={mission.position}
              selectedMarker={selectedLocation}
              initialFocusLocation={selectedLocation}
              onPointerLocationChange={() => {}}
              onLocationSelect={(loc) => {
                setSelectedFeature(null);
                setSelectedLocation(loc);
                setPosition({ lon: loc.lon, lat: loc.lat });
              }}
              onFeatureSelect={setSelectedFeature}
              onViewChange={() => {}}
              onSourceStatusChange={() => {}}
              onOverlayStatusChange={setOverlayStatus}
            />
          </Suspense>
        )}
      </main>

      {/* Bottom sheet — collapsible, touch-first */}
      <div
        className={cn(
          'shrink-0 overflow-y-auto rounded-t-2xl border-t border-x border-edge bg-panel transition-[max-height] duration-[220ms] ease-out',
          globeActive && 'hidden',
          sheetOpen ? 'max-h-[52vh]' : 'max-h-13',
        )}
        data-testid="tablet-sheet"
      >
        <header className="sticky top-0 z-10 flex h-13 items-center justify-between border-b border-edge/60 bg-panel px-4 rounded-t-2xl">
          <button
            type="button"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={toggleSheet}
            aria-expanded={sheetOpen}
          >
            <span className="shrink-0 text-sm font-semibold text-ink">
              {sheetTab === 'mission' ? 'Mission' : 'Rover POV'}
            </span>
            {route && sheetTab === 'mission' && (
              <span className="min-w-0 truncate rounded-sm border border-edge bg-elevated px-2 py-0.5 font-mono text-xs text-ink">
                {formatDistance(route.totalGroundDistanceM)} candidate
              </span>
            )}
          </button>
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={toggleSheet}
            aria-label={sheetOpen ? 'Collapse mission sheet' : 'Expand mission sheet'}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 transition-transform duration-150', !sheetOpen && 'rotate-180')}
            />
          </button>
        </header>

        {sheetOpen && (
          <>
          <div role="tablist" aria-label="Field tablet sheet" className="flex shrink-0 gap-2 border-b border-edge/60 bg-panel px-3 py-2">
            <button
              type="button"
              role="tab"
              aria-selected={sheetTab === 'mission'}
              aria-controls="tablet-tabpanel-mission"
              onClick={() => setSheetTab('mission')}
              className={cn(
                'min-h-11 flex-1 rounded-sm px-3 text-xs font-medium transition-colors duration-150',
                sheetTab === 'mission' ? 'bg-elevated text-ink' : 'text-ink-muted hover:bg-subtle',
              )}
            >
              Mission
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sheetTab === 'rover'}
              aria-controls="tablet-tabpanel-rover"
              onClick={() => setSheetTab('rover')}
              className={cn(
                'min-h-11 flex-1 rounded-sm px-3 text-xs font-medium transition-colors duration-150',
                sheetTab === 'rover' ? 'bg-elevated text-ink' : 'text-ink-muted hover:bg-subtle',
              )}
            >
              Rover POV
            </button>
          </div>

          {sheetTab === 'mission' ? (
          <div id="tablet-tabpanel-mission" role="tabpanel" className="flex flex-col gap-3 p-4">
            {selectedFeature && (
              <section className="rounded-lg border border-edge bg-panel-raised/50 p-3" data-testid="tablet-selected-feature">
                <div className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
                  {selectedFeature.datasetId === 'jezero-iau-nomenclature' ? 'IAU feature' : 'Science waypoint'}
                </div>
                <h3 className="mt-0.5 text-sm font-semibold text-ink">{selectedFeature.name}</h3>
                <p className="mt-1 font-mono text-[11px] text-ink-muted">
                  {formatLat(selectedFeature.lat)}, {formatLon(selectedFeature.lon)}
                </p>
                {selectedFeatureDataset && (
                  <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                    Source: {selectedFeatureDataset.title} · {selectedFeatureDataset.provider}
                  </p>
                )}
                {Object.entries(selectedFeature.sourceProperties).some(
                  ([key]) => key !== 'name' && key !== 'template' && key !== 'gazetteerUrl',
                ) && (
                  <details className="mt-2 border-t border-edge/50 pt-2 text-[11px]">
                    <summary className="min-h-9 cursor-pointer py-2 text-ink-muted">Source properties</summary>
                    <dl className="space-y-1.5">
                      {Object.entries(selectedFeature.sourceProperties)
                        .filter(([key]) => key !== 'name' && key !== 'template' && key !== 'gazetteerUrl')
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt className="text-[10px] uppercase tracking-[0.04em] text-ink-subtle">
                              {key === 'elevationDeclared'
                                ? 'Published elevation field'
                                : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())}
                            </dt>
                            <dd className="break-words text-ink-muted">
                              {key === 'elevationDeclared' && value === 0
                                ? '0 — Trek publishes this field as 0; it is not a measured elevation.'
                                : value === null ? 'Unknown (source field is null)' : String(value)}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {selectedFeatureDataset && (
                    <a href={selectedFeatureDataset.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-info hover:underline">
                      Dataset source
                    </a>
                  )}
                  {selectedFeature.detailUrl && (
                    <a href={selectedFeature.detailUrl} target="_blank" rel="noreferrer noopener" className="text-info hover:underline">
                      Feature record
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* Position card */}
            <div className="rounded-lg border border-edge bg-panel-raised/50 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  Your Position (Simulated)
                </span>
                {mission.position && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs rounded-sm"
                    onClick={() => setPosition(null)}
                    aria-label="Clear position"
                  >
                    <RotateCcw className="size-3 mr-1" aria-hidden="true" />
                    Clear
                  </Button>
                )}
              </div>

              {mission.position ? (
                <div className="space-y-1.5">
                  <div className="font-mono text-sm font-medium text-ink">
                    {formatLat(mission.position.lat)}, {formatLon(mission.position.lon)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone="warn" className="text-[10px]">SIMULATED</Badge>
                    <span className="text-xs text-ink-subtle">
                      manually set by tapping the map
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-ink-muted">
                  Tap the map to set a simulated position — there is no Mars GPS.
                </p>
              )}

              {selectedLocation && (
                <p className="mt-2 text-[11px] leading-snug text-ink-subtle" data-testid="imagery-availability-note">
                  The 2D map has no verified detailed optical imagery layer active here; its available
                  optical context is the historical global Viking mosaic.
                </p>
              )}

              {mission.position && !route && (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-sm"
                    onClick={() => mission.position && setStart(mission.position)}
                  >
                    Set start here
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-sm"
                    onClick={() => mission.position && setTarget(mission.position)}
                  >
                    Set target here
                  </Button>
                </div>
              )}

              {nextWaypoint && (
                <div
                  className="mt-2.5 rounded-md border border-edge/60 bg-surface/50 p-2.5"
                  data-testid="next-waypoint"
                >
                  <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">
                    Nearest route point
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-lg font-medium text-ink">
                      {formatDistance(nextWaypoint.distanceToWaypointM)}
                    </span>
                    <span className="text-xs text-ink-subtle">to this point</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {formatDistance(nextWaypoint.remainingAlongRouteM)} remaining along route ·
                    elevation {Math.round(nextWaypoint.elevM)} m
                  </div>
                </div>
              )}
            </div>

            {/* Route summary & elevation profile */}
            {route && (
              <div className="rounded-lg border border-edge bg-panel-raised/50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  Route Progress
                </div>
                <ElevationProfile route={route} height={80} />
              </div>
            )}

            <RouteSummary
              route={route}
              computing={mission.routeStatus === 'computing'}
              error={mission.routeError?.message ?? null}
            />

            {/* Actions Grid */}
            <div className="rounded-lg border border-edge bg-panel-raised/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Mission Actions
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="accent"
                  className="h-9 text-xs rounded-md"
                  disabled={!canCompute}
                  onClick={() => computeRoute()}
                >
                  <Play className="size-3.5 fill-current" aria-hidden="true" />
                  {mission.routeStatus === 'computing' ? 'Computing…' : 'Compute Route'}
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-xs rounded-md"
                  onClick={() => clearRoute()}
                  disabled={!route && mission.routeStatus === 'idle'}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Clear Route
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-xs rounded-md"
                  onClick={handleExport}
                  disabled={!route && !mission.start && !mission.target}
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  Export Plan
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-xs rounded-md"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  Import Plan
                </Button>
              </div>

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

              {importError && (
                <p className="mt-2 text-xs leading-snug text-danger">Import failed: {importError}</p>
              )}
            </div>

            {/* Layers */}
            <div className="rounded-lg border border-edge bg-panel-raised/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Map Layers
              </div>
              <div className="flex flex-col gap-1.5">
                {[...BASE_LAYER_IDS, ...OVERLAY_IDS].map((id) => {
                  const dataset = DATASETS.find((d) => d.id === id);
                  if (!dataset) return null;
                  const state = layerStates[id] ?? { visible: false, opacity: 1 };
                  const shortTitle = DATASET_SHORT_NAMES[id] ?? dataset.title;
                  const isOverlay = dataset.accessMethod === 'geojson' || dataset.accessMethod === 'raster';
                  const loadState = overlayStatus[id];
                  const statusLabel = !state.visible
                    ? 'OFF'
                    : !isOverlay
                      ? 'ACTIVE'
                      : loadState === 'failed'
                        ? 'FAILED'
                        : loadState === 'active'
                          ? 'ACTIVE'
                          : 'LOADING';
                  const statusTone: 'neutral' | 'info' | 'ok' | 'danger' =
                    statusLabel === 'FAILED' ? 'danger'
                      : statusLabel === 'ACTIVE' ? 'ok'
                        : statusLabel === 'LOADING' ? 'info' : 'neutral';
                  return (
                    <div
                      key={id}
                      className={cn('rounded-md border transition-colors duration-150', state.visible ? 'border-edge bg-surface/70' : 'border-transparent hover:border-edge/50 hover:bg-subtle/40')}
                    >
                      <div className="flex min-h-11 items-center justify-between gap-2 p-2.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={dataset.title}>
                          {shortTitle}
                        </span>
                        <Badge tone={statusTone} className="shrink-0 px-1.5 py-0 text-[9px]">{statusLabel}</Badge>
                        <Switch
                          checked={state.visible}
                          onCheckedChange={(v) => handleToggleVisibility(id, v)}
                          label={`Show ${dataset.title}`}
                        />
                      </div>
                      {state.visible && (
                        <label className="flex items-center gap-2 border-t border-edge/50 px-2.5 py-2 text-[10px] uppercase tracking-[0.04em] text-ink-subtle">
                          Opacity
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={Math.round(state.opacity * 100)}
                            onChange={(event) => handleOpacityChange(id, Number(event.target.value) / 100)}
                            className="solara-range min-w-0 flex-1"
                            aria-label={`${dataset.title} opacity`}
                          />
                          <span className="w-9 text-right font-mono text-[10px] text-ink-muted">
                            {Math.round(state.opacity * 100)}%
                          </span>
                        </label>
                      )}
                      <details className="border-t border-edge/50 px-2.5">
                        <summary className="min-h-10 cursor-pointer py-2 text-[10px] text-ink-muted">Source & meaning</summary>
                        <div className="space-y-1 pb-2 text-[10px] leading-snug text-ink-subtle">
                          <p>{dataset.description}</p>
                          <p>Provider: {dataset.provider}</p>
                          <p>{dataset.coverageDescription}</p>
                          {dataset.resolutionUnit && <p>Resolution: {dataset.resolutionUnit}</p>}
                          <a href={dataset.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-block text-info hover:underline">
                            Open dataset source
                          </a>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          ) : (
            <div id="tablet-tabpanel-rover" role="tabpanel" className="h-[calc(52vh-7rem)] min-h-[220px] overflow-hidden">
              <RoverPovPanel
                active={!globeActive && sheetOpen && sheetTab === 'rover'}
                location={selectedLocation}
              />
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
