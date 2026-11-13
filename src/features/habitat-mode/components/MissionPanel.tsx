/**
 * MissionPanel — right-panel mission planning (Habitat Mode).
 *
 * Start/target selection from the map-selected point, prototype cost
 * parameters, compute action, route summary, elevation profile, warnings,
 * provenance, and plan export/import.
 *
 * Honesty (Context.md §7): the route is always labelled a PROPOSED
 * TERRAIN-COST CANDIDATE; the cost model is slope-only and parameters are
 * prototype thresholds, not operational limits. Imported plans are marked
 * as imported and are not re-verified.
 */

import { useRef, useState } from 'react';
import { ChevronDown, Download, Flag, Play, RotateCcw, Upload, MapPin } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Section } from '../../../components/ui/section';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon } from '../../../lib/format';
import type { MapLocation } from '../../../map/mapTypes';
import { ElevationProfile } from '../../mission/components/ElevationProfile';
import { RouteSummary } from '../../mission/components/RouteSummary';
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
    <div className="rounded-md border border-edge px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
          <MapPin className="size-3.5 text-info" aria-hidden="true" />
          {label}
        </span>
        {point && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-ink-subtle hover:text-danger"
            aria-label={`Clear ${label.toLowerCase()} point`}
          >
            clear
          </button>
        )}
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink-muted" data-testid={`mission-${label.toLowerCase()}`}>
        {point ? `${formatLon(point.lon)}  ${formatLat(point.lat)}` : 'not set'}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-1.5 w-full"
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
          <div className="rounded-md border border-edge">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
              aria-expanded={advancedOpen}
              aria-controls="mission-advanced-params"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">
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
                  <span className="w-28 shrink-0 text-[10.5px] text-ink-muted">Slope cost / degree</span>
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
                  <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-ink">
                    {mission.params.slopeCostPerDeg.toFixed(3)}
                  </span>
                </label>
                <label className="mt-1.5 flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[10.5px] text-ink-muted">Max slope (block)</span>
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
                  <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-ink">
                    {mission.params.maxSlopeDeg}°
                  </span>
                </label>
                <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
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

      {(hasRoute || mission.routeStatus === 'computing' || mission.routeError) && (
        <RouteSummary
          route={route}
          computing={mission.routeStatus === 'computing'}
          error={mission.routeError?.message ?? null}
        />
      )}

      {route && (
        <Section title="Elevation profile">
          <ElevationProfile route={route} />
        </Section>
      )}

      {route && route.warnings.length > 0 && (
        <Section title="Terrain-derived concerns" hint="prototype model">
          <ul className="flex flex-col gap-1.5" data-testid="route-warnings">
            {route.warnings.map((warning, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-warn">
                <Flag className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mission.gridMeta && (
        <Section title="Route data provenance">
          <div className="flex flex-col gap-1 text-[10.5px] leading-snug text-ink-muted">
            <span>
              Grid prepared <span className="font-mono">{mission.gridMeta.preparedAt.slice(0, 10)}</span> from{' '}
              <span className="break-all">{mission.gridMeta.sourceService}</span>
            </span>
            <span>{mission.gridMeta.sourceMethod}</span>
            {mission.gridMeta.centreValidation && (
              <span>
                Centre cross-check: live identify {mission.gridMeta.centreValidation.identifyValueM} m vs grid{' '}
                {mission.gridMeta.centreValidation.gridBilinearM} m (diff{' '}
                {mission.gridMeta.centreValidation.diffM} m)
              </span>
            )}
            <span className="text-ink-subtle">{mission.gridMeta.verticalReference}</span>
          </div>
        </Section>
      )}

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
            <p className="text-[10px] leading-snug text-ink-subtle" data-testid="plan-imported-note">
              Plan imported {mission.importedAt.slice(0, 10)} — displayed as loaded from the plan file;
              not re-verified against current terrain data.
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
