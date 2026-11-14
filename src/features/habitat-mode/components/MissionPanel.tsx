/**
 * MissionPanel — mission planning controls (Habitat Mode, left panel).
 *
 * Start/target selection from the map-selected point, prototype cost
 * parameters, compute action, and plan export/import. Route RESULTS
 * (summary, elevation profile, warnings, provenance) render in the
 * workspace Inspector tab (InspectorPanel), which reads the same store.
 *
 * Honesty (Context.md §7): the route is always labelled a PROPOSED
 * TERRAIN-COST CANDIDATE; the cost model is slope-only and parameters are
 * prototype thresholds, not operational limits. Imported plans are marked
 * as imported and are not re-verified.
 */

import { useRef, useState } from 'react';
import { ChevronDown, Download, MapPin, Play, RotateCcw, Upload } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/ui/section';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon } from '../../../lib/format';
import type { MapLocation } from '../../../map/mapTypes';
import {
  buildPlanFile,
  clearRoute,
  computeRoute,
  importPlanFile,
  setRouteParams,
  setStart,
  setTarget,
  useMissionState,
} from '../../mission/store';

export interface MissionPanelProps {
  selectedLocation: MapLocation | null;
}

function PointRow({
  label,
  point,
  selectedLabel,
  onUseSelected,
  onClear,
  selectedDisabled,
}: {
  label: 'Start' | 'Target';
  point: { lon: number; lat: number } | null;
  selectedLabel: string | null;
  onUseSelected: () => void;
  onClear: () => void;
  selectedDisabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel-raised/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          <MapPin
            className={cn('size-3.5', label === 'Start' ? 'text-accent' : 'text-warn')}
            aria-hidden="true"
          />
          {label}
        </span>
        {point && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-ink-subtle transition-colors hover:text-danger"
            aria-label={`Clear ${label.toLowerCase()} point`}
          >
            clear
          </button>
        )}
      </div>
      <div className="mt-1 font-mono text-[12.5px] leading-snug text-ink" data-testid={`mission-${label.toLowerCase()}`}>
        {point ? `${formatLon(point.lon)}  ${formatLat(point.lat)}` : <span className="text-ink-subtle">not set</span>}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        disabled={selectedDisabled}
        onClick={onUseSelected}
      >
        Use selected point{selectedLabel ? '' : ' (none)'}
      </Button>
    </div>
  );
}

export function MissionPanel({ selectedLocation }: MissionPanelProps) {
  const mission = useMissionState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const useSelectedAsStart = () => {
    if (!selectedLocation) return;
    setStart({ lon: selectedLocation.lon, lat: selectedLocation.lat });
  };
  const useSelectedAsTarget = () => {
    if (!selectedLocation) return;
    setTarget({ lon: selectedLocation.lon, lat: selectedLocation.lat });
  };

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
        const parsed: unknown = JSON.parse(text);
        importPlanFile(parsed);
      })
      .catch((e: unknown) => {
        setImportError(e instanceof Error ? e.message : String(e));
      });
  };

  const canCompute = mission.start !== null && mission.target !== null && mission.routeStatus !== 'computing';
  const route = mission.route;
  const hasRoute = route !== null;

  return (
    <div data-testid="mission-panel">
      <Section title="Mission planning (prototype)">
        <div className="flex flex-col gap-2">
          <PointRow
            label="Start"
            point={mission.start}
            selectedLabel={selectedLocation ? 'selected' : null}
            onUseSelected={useSelectedAsStart}
            onClear={() => setStart(null)}
            selectedDisabled={!selectedLocation}
          />
          <PointRow
            label="Target"
            point={mission.target}
            selectedLabel={selectedLocation ? 'selected' : null}
            onUseSelected={useSelectedAsTarget}
            onClear={() => setTarget(null)}
            selectedDisabled={!selectedLocation}
          />

          {/* Prototype cost parameters — collapsed by default. */}
          <div className="rounded-lg border border-edge bg-surface/40">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-subtle/50"
              aria-expanded={advancedOpen}
              aria-controls="mission-advanced-params"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
                Advanced (prototype parameters)
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn('size-3.5 shrink-0 text-ink-subtle transition-transform duration-150', advancedOpen && 'rotate-180')}
              />
            </button>
            {advancedOpen && (
              <div id="mission-advanced-params" className="border-t border-edge px-2.5 py-2">
                <label className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[11px] text-ink-muted">Slope cost / degree</span>
                  <input
                    type="range"
                    min={0}
                    max={0.3}
                    step={0.005}
                    value={mission.params.slopeCostPerDeg}
                    onChange={(e) => setRouteParams({ slopeCostPerDeg: Number(e.target.value) })}
                    className="solara-range min-w-0 flex-1"
                    aria-label="Slope cost per degree"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ink">
                    {mission.params.slopeCostPerDeg.toFixed(3)}
                  </span>
                </label>
                <label className="mt-1.5 flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[11px] text-ink-muted">Max slope (block)</span>
                  <input
                    type="range"
                    min={10}
                    max={60}
                    step={1}
                    value={mission.params.maxSlopeDeg}
                    onChange={(e) => setRouteParams({ maxSlopeDeg: Number(e.target.value) })}
                    className="solara-range min-w-0 flex-1"
                    aria-label="Maximum slope in degrees before blocking"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-ink">
                    {mission.params.maxSlopeDeg}°
                  </span>
                </label>
                <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
                  Prototype thresholds — not operational safety limits.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="accent" className="flex-1" disabled={!canCompute} onClick={() => computeRoute()}>
              <Play aria-hidden="true" />
              {mission.routeStatus === 'computing' ? 'Computing…' : 'Compute route'}
            </Button>
            <Button variant="ghost" onClick={() => clearRoute()} disabled={!hasRoute && mission.routeStatus === 'idle'} aria-label="Clear route">
              <RotateCcw aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Mission plan">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleExport} disabled={!hasRoute && !mission.start && !mission.target}>
              <Download aria-hidden="true" />
              Export plan
            </Button>
            <Button className="flex-1" onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" />
              Import plan
            </Button>
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
          {importError && (
            <p className="text-[11px] leading-snug text-danger" data-testid="plan-import-error">
              Import failed: {importError}
            </p>
          )}
          {mission.importedAt && (
            <p className="text-[10.5px] leading-snug text-ink-subtle" data-testid="plan-imported-note">
              Plan imported {mission.importedAt.slice(0, 10)} — loaded from file, not re-verified.
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
