/**
 * FieldTabletMode — touch-first surface-operations layout (Context.md §4.2,
 * Design.md §6).
 *
 * The map dominates; secondary information lives in a collapsible bottom
 * sheet. The astronaut position is a manually selected (SIMULATED) point —
 * no Mars positioning system exists in SOLARA, and the UI never implies one.
 * Large touch targets (>= 44 px), no hover-dependent interactions.
 *
 * FieldTabletMode shares the exact mission store, catalog, and MarsMap
 * engine with Habitat Mode — one application, two interfaces. The header
 * carries its own mode navigation (this mode is active; Habitat is one tap
 * away), so no floating control overlaps the map or sheet.
 */

import { Suspense, lazy, useCallback, useRef, useState } from 'react';
import { ChevronDown, Download, Play, RotateCcw, Upload } from 'lucide-react';
import type { RouteResult } from '../../workers/routeClient';
import { getAllDatasets, getAllRegions } from '../../data/catalog/datasets';
import type { LayerUiState } from '../habitat-mode/components/MissionOperationsPanel';
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
import { Section } from '../../components/ui/section';
import { Switch } from '../../components/ui/switch';
import { ElevationProfile } from '../mission/components/ElevationProfile';
import { RouteSummary } from '../mission/components/RouteSummary';
import { cn } from '../../lib/utils';

const MarsMap = lazy(() => import('../../map/MarsMap'));

const DATASETS = getAllDatasets();
const REGIONS = getAllRegions();
const REGION = REGIONS[0]!;

const BASE_LAYER_IDS = ['mola-hrsc-blend-200m-colorshade', 'jezero-ctx-mosaic-soc-008'] as const;
const OVERLAY_IDS = ['usgs-sim3292-jezero-geology', 'mars2020-landing-ellipse', 'mars2020-perseverance-traverse'] as const;

function MapWorkspaceFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="flex items-center gap-2 rounded border border-edge bg-panel px-3 py-2 text-sm text-ink-muted">
        <span className="inline-block size-2.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
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
      initial[id] = { visible: id === BASE_LAYER_IDS[0] || id === 'mars2020-perseverance-traverse', opacity: 1 };
    }
    return initial;
  });
  const [sheetOpen, setSheetOpen] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggleVisibility = useCallback((id: string, visible: boolean) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { opacity: 1 }), visible } }));
  }, []);

  const baseLayers = BASE_LAYER_IDS.map((datasetId) => ({
    datasetId,
    ...(layerStates[datasetId] ?? { visible: false, opacity: 1 }),
  }));
  const overlays = OVERLAY_IDS.map((datasetId) => ({
    datasetId,
    visible: layerStates[datasetId]?.visible ?? false,
  }));

  const route = mission.route;
  const nextWaypoint =
    mission.position && route ? nextWaypointInfo(route, mission.position) : null;

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
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact header with this mode's navigation */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
        <img src="/solara.svg" alt="" aria-hidden="true" className="size-5 shrink-0" />
        <span className="shrink-0 text-sm font-semibold tracking-[0.14em] text-ink">SOLARA</span>
        <span className="shrink-0 rounded border border-accent/40 bg-accent-subtle px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
          Field Tablet
        </span>
        <span
          className="ml-auto min-w-0 truncate rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10.5px] font-medium text-warn"
          data-testid="position-status"
          title={mission.position ? 'Simulated position — manually set by tapping the map' : 'No simulated position set yet'}
        >
          {/* Short label on narrow headers so "SIMULATED" never truncates. */}
          <span className="sm:hidden">{mission.position ? 'SIMULATED (manual)' : 'No position'}</span>
          <span className="hidden sm:inline">
            {mission.position ? 'Position: SIMULATED (manually set)' : 'Position: not set — tap the map'}
          </span>
        </span>
        <Button variant="outline" size="sm" className="ml-1.5 min-h-9 shrink-0" onClick={onExit}>
          Habitat
        </Button>
      </header>

      {/* Map — dominant area */}
      <main className="relative min-h-0 flex-1">
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
            onPointerLocationChange={() => {}}
            onLocationSelect={(loc) => setPosition({ lon: loc.lon, lat: loc.lat })}
            onViewChange={() => {}}
            onSourceStatusChange={() => {}}
          />
        </Suspense>
      </main>

      {/* Bottom sheet — collapsible, touch-first */}
      <div
        className={cn(
          'shrink-0 overflow-y-auto border-t border-edge bg-panel transition-[max-height] duration-200',
          sheetOpen ? 'max-h-[52vh]' : 'max-h-14',
        )}
        data-testid="tablet-sheet"
      >
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-edge bg-panel px-4">
          <button
            type="button"
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
            onClick={toggleSheet}
            aria-expanded={sheetOpen}
          >
            <span className="shrink-0 text-sm font-medium text-ink">Mission</span>
            {route && (
              <span className="min-w-0 truncate font-mono text-xs text-accent">
                {formatDistance(route.totalGroundDistanceM)} candidate
              </span>
            )}
          </button>
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            onClick={toggleSheet}
            aria-label={sheetOpen ? 'Collapse mission sheet' : 'Expand mission sheet'}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-5 transition-transform duration-150', !sheetOpen && 'rotate-180')}
            />
          </button>
        </header>

        {sheetOpen && (
          <div className="px-4 pb-5">
            {/* Position + next waypoint */}
            <Section title="Your position" hint="simulated — tap the map to set" className="px-0">
              {mission.position ? (
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[13px] text-ink">
                    {formatLon(mission.position.lon)} {formatLat(mission.position.lat)}
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setPosition(null)}
                  >
                    <RotateCcw aria-hidden="true" />
                    Clear position
                  </Button>
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-ink-muted">
                  Tap the map to set a simulated position. There is no Mars GPS — the marker is
                  labelled SIMULATED everywhere.
                </p>
              )}

              {mission.position && !route && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="outline" className="min-h-11" onClick={() => mission.position && setStart(mission.position)}>
                    Set start here
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => mission.position && setTarget(mission.position)}>
                    Set target here
                  </Button>
                </div>
              )}

              {nextWaypoint && (
                <div className="mt-2 rounded-md border border-edge bg-panel-raised px-3 py-2.5" data-testid="next-waypoint">
                  <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">Nearest route point</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xl text-accent">
                      {formatDistance(nextWaypoint.distanceToWaypointM)}
                    </span>
                    <span className="text-[11px] text-ink-muted">to this point</span>
                  </div>
                  <div className="mt-1 text-[11.5px] text-ink-muted">
                    {formatDistance(nextWaypoint.remainingAlongRouteM)} remaining along the route ·
                    elevation {Math.round(nextWaypoint.elevM)} m
                  </div>
                </div>
              )}
            </Section>

            {route && (
              <Section title="Route progress" className="px-0">
                <ElevationProfile route={route} height={80} />
              </Section>
            )}

            <RouteSummary
              route={route}
              computing={mission.routeStatus === 'computing'}
              error={mission.routeError?.message ?? null}
            />

            {route && route.warnings.length > 0 && (
              <Section title="Known terrain concerns" hint="prototype model" className="px-0">
                <ul className="flex flex-col gap-1.5">
                  {route.warnings.map((warning, i) => (
                    <li key={i} className="text-[12.5px] leading-snug text-warn">
                      {warning}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Actions — primary row + grouped secondary grid (no misaligned
                free-wrap). */}
            <Section title="Actions" className="px-0">
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="accent"
                    className="min-h-11 flex-1"
                    disabled={!canCompute}
                    onClick={() => computeRoute()}
                  >
                    <Play aria-hidden="true" />
                    {mission.routeStatus === 'computing' ? 'Computing…' : 'Compute route'}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => clearRoute()}
                    disabled={!route && mission.routeStatus === 'idle'}
                  >
                    <RotateCcw aria-hidden="true" />
                    Clear route
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={handleExport}
                    disabled={!route && !mission.start && !mission.target}
                  >
                    <Download aria-hidden="true" />
                    Export plan
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!route && !mission.start && !mission.target}
                  >
                    <Upload aria-hidden="true" />
                    Import plan
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
                  <p className="text-[11.5px] leading-snug text-danger">Import failed: {importError}</p>
                )}
                {mission.importedAt && (
                  <p className="text-[10.5px] leading-snug text-ink-subtle">
                    Plan imported {mission.importedAt.slice(0, 10)} — displayed as loaded from the plan
                    file; not re-verified against current terrain data.
                  </p>
                )}
              </div>
            </Section>

            {/* Layers — touch-sized toggle rows */}
            <Section title="Map layers" className="px-0">
              <div className="flex flex-col gap-0.5">
                {[...BASE_LAYER_IDS, ...OVERLAY_IDS].map((id) => {
                  const dataset = DATASETS.find((d) => d.id === id);
                  if (!dataset) return null;
                  const state = layerStates[id] ?? { visible: false, opacity: 1 };
                  return (
                    <div
                      key={id}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-md px-1 transition-colors duration-150 hover:bg-panel-raised/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={dataset.title}>
                        {dataset.title}
                      </span>
                      <Switch
                        checked={state.visible}
                        onCheckedChange={(v) => handleToggleVisibility(id, v)}
                        label={`Show ${dataset.title}`}
                      />
                    </div>
                  );
                })}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
