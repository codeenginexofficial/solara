/**
 * LocationPanel — the map location selected by clicking, shown in the
 * workspace Inspector tab (Context.md §4.1, Solara Mars Mission Dashboard reference).
 *
 * Coordinates lead (large mono pair), elevation with mountain icon,
 * region membership chip, and scientific unknown rows.
 * Deliberate empty state: "No location selected / Select a map location."
 */

import { useEffect, useRef, useState } from 'react';
import { Crosshair, Mountain } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import type { RegionRecord } from '../../../data/catalog/types';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon, formatMetreSigned, formatUtcTime } from '../../../lib/format';
import { isInsideBoundingBox } from '../../../lib/bbox';
import { identifyElevation } from '../../../data/adapters/demService';
import { fetchElevationGrid, sampleElevation, type ElevationGrid } from '../../../data/adapters/elevationGrid';
import { getDatasetById } from '../../../data/catalog/datasets';

export interface LocationPanelProps {
  location: MapLocation | null;
  /** Exploration region for the membership row (honest in/out compare). */
  region?: RegionRecord;
  /** Reports the current elevation state up (Copilot context building). */
  onElevationStateChange?: (state: ElevationState | null) => void;
}

export type ElevationState =
  | { kind: 'idle' }
  | { kind: 'loading'; locationKey?: string }
  | { kind: 'live'; value: number; fetchedAt: string; locationKey?: string }
  | { kind: 'no-data'; fetchedAt: string; locationKey?: string }
  | {
      kind: 'error';
      message: string;
      fallbackValue: number | null;
      fallbackLabel: string | null;
      locationKey?: string;
    };

function locationKeyOf(location: MapLocation): string {
  return `${location.lon.toFixed(6)},${location.lat.toFixed(6)}`;
}

let preparedGridPromise: Promise<ElevationGrid | null> | null = null;

function getPreparedGrid(): Promise<ElevationGrid | null> {
  if (!preparedGridPromise) {
    const url = getDatasetById('mola-hrsc-blend-200m-dem')?.preparedAssetUrl;
    preparedGridPromise = url
      ? fetchElevationGrid(url).catch(() => null)
      : Promise.resolve(null);
  }
  return preparedGridPromise;
}

function UnknownRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium text-warn">Unknown</span>
        <span className="min-w-0 max-w-full flex-1 text-[11px] leading-snug text-ink-subtle">
          {reason}
        </span>
      </span>
    </div>
  );
}

export function LocationPanel({ location, region, onElevationStateChange }: LocationPanelProps) {
  const [elevationState, setElevationState] = useState<ElevationState>({ kind: 'idle' });
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!location) {
      setElevationState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const lon = Number(location.lon.toFixed(6));
    const lat = Number(location.lat.toFixed(6));
    const key = locationKeyOf(location);
    setElevationState({ kind: 'loading', locationKey: key });

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await identifyElevation(lon, lat);
          if (cancelled) return;
          if (result.noData) {
            setElevationState({ kind: 'no-data', fetchedAt: result.fetchedAt, locationKey: key });
          } else {
            setElevationState({
              kind: 'live',
              value: result.elevationM ?? Number.NaN,
              fetchedAt: result.fetchedAt,
              locationKey: key,
            });
          }
        } catch (e) {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : String(e);
          let fallbackValue: number | null = null;
          let fallbackLabel: string | null = null;
          try {
            const grid = await getPreparedGrid();
            if (!cancelled && grid) {
              const sample = sampleElevation(grid, lon, lat);
              if (sample.elevationM !== null) {
                fallbackValue = sample.elevationM;
                fallbackLabel = `bilinear sample of the prepared grid (prepared ${grid.meta.preparedAt.slice(0, 10)})`;
              }
            }
          } catch {
            // Fallback stays unavailable
          }
          if (!cancelled) {
            setElevationState({ kind: 'error', message, fallbackValue, fallbackLabel, locationKey: key });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location]);

  useEffect(() => {
    if (!location) {
      onElevationStateChange?.(null);
      return;
    }
    const key = locationKeyOf(location);
    const stateKey = elevationState.kind === 'idle' ? undefined : elevationState.locationKey;
    onElevationStateChange?.(stateKey === key ? elevationState : { kind: 'loading', locationKey: key });
  }, [elevationState, location, onElevationStateChange]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  if (!location) {
    return (
      <div data-testid="location-panel" className="rounded-lg border border-edge bg-panel-raised/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Crosshair className="size-4 text-ink-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Location
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-edge/80 bg-surface/40 px-4 py-8 text-center">
          <Crosshair className="size-6 text-ink-subtle" aria-hidden="true" />
          <span className="text-[13px] font-medium text-ink">No location selected</span>
          <p className="text-xs text-ink-subtle">Select a map location.</p>
        </div>
      </div>
    );
  }

  const bbox = region?.boundingBox;
  const inside = bbox !== undefined && isInsideBoundingBox(location, bbox);

  const handleCopy = () => {
    const text = `${formatLat(location.lat)}, ${formatLon(location.lon)}`;
    const reset = (state: 'ok' | 'failed') => {
      setCopyState(state);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopyState('idle'), 1500);
    };
    if (!navigator.clipboard) {
      reset('failed');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => reset('ok'))
      .catch(() => reset('failed'));
  };

  // Elevation readout text
  let elevText = '…';
  if (elevationState.kind === 'live') {
    elevText = `${elevationState.value.toLocaleString('en-US')} m`;
  } else if (elevationState.kind === 'no-data') {
    elevText = 'Unknown (NoData)';
  } else if (elevationState.kind === 'error') {
    elevText = elevationState.fallbackValue !== null
      ? `~${Math.round(elevationState.fallbackValue).toLocaleString('en-US')} m`
      : 'Unknown';
  }

  return (
    <div data-testid="location-panel" className="rounded-lg border border-edge bg-panel-raised/50 p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Crosshair className="size-4 text-ink-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Location
          </h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label="Copy coordinates"
          className="h-7 px-2.5 text-xs rounded-sm"
        >
          {copyState === 'ok' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
        </Button>
      </div>

      {/* Primary Coordinates Readout */}
      <div className="mt-3">
        <div className="font-mono text-lg font-medium tracking-tight text-ink">
          {formatLat(location.lat)}, {formatLon(location.lon)}
        </div>

        {/* Elevation with Mountain icon */}
        <div className="mt-2 flex items-center gap-2">
          <Mountain className="size-4 text-ink-muted shrink-0" aria-hidden="true" />
          <span className="font-mono text-base font-semibold text-ink">
            {elevText}
          </span>
          {elevationState.kind === 'live' && (
            <span className="text-[11px] text-ink-subtle">
              (areoid · {formatUtcTime(elevationState.fetchedAt)})
            </span>
          )}
        </div>

        {/* Region membership badge */}
        <div className="mt-2.5 flex items-center gap-2">
          <div
            data-testid="region-membership"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              inside
                ? 'border-edge bg-surface text-ink-muted'
                : 'border-warn/40 bg-warn/10 text-warn',
            )}
          >
            <span
              className={cn('size-1.5 rounded-full', inside ? 'bg-ok' : 'bg-warn')}
              aria-hidden="true"
            />
            <span>{inside ? 'Jezero Region' : 'Outside exploration region'}</span>
          </div>

          <span className="font-mono text-[11px] text-ink-subtle">
            X {formatMetreSigned(location.x)} · Y {formatMetreSigned(location.y)}
          </span>
        </div>
      </div>

      {/* Scientific unknowns / reasons */}
      <div className="mt-3 border-t border-edge/60 pt-2.5 space-y-1">
        <UnknownRow
          label="Slope at point"
          reason="Requires terrain resolution beyond the ~200 m/px DEM."
        />
        <UnknownRow
          label="Surface conditions"
          reason="No surface sensor integrated; satellite imagery is historical."
        />
      </div>
    </div>
  );
}
