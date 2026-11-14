/**
 * LocationPanel — the map location selected by clicking, shown in the
 * workspace Inspector tab.
 *
 * Revision 2 composition (2026-11-14): coordinates lead (large mono pair,
 * projected metres as a compact secondary line), region membership is a
 * compact chip, elevation is the prominent scientific value, and the
 * no-selection case is a deliberate empty state. The query logic is
 * unchanged.
 *
 * Elevation is queried LIVE from the verified Trek ImageServer (the static
 * MOLA+HRSC blend DEM, 2018 v2 — a fixed product, not current conditions).
 * When the live query fails, the prepared grid asset (cross-validated
 * against the live service at preparation time) provides a fallback, clearly
 * labelled as derived-from-prepared-grid. When neither is available,
 * elevation is shown as Unknown. Slope at a single point and surface
 * conditions are NOT derivable from integrated data and are shown as
 * unknown with reasons (Context.md §7).
 *
 * Region membership is an exact compare against the exploration bounding
 * box — out-of-region points are never clamped or rejected.
 */

import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import type { RegionRecord } from '../../../data/catalog/types';
import { Section } from '../../../components/ui/section';
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

/** Stable key for the location an elevation state belongs to; lets the
 *  reporter never pair an old elevation value with a new location. */
function locationKeyOf(location: MapLocation): string {
  return `${location.lon.toFixed(6)},${location.lat.toFixed(6)}`;
}

/** Module-level cache of the prepared grid (loaded at most once). */
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
    <div className="flex flex-col gap-0.5 py-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-medium text-warn">Unknown</span>
        <span className="min-w-0 max-w-full flex-1 basis-36 text-[11px] leading-snug text-ink-subtle">
          {reason}
        </span>
      </span>
    </div>
  );
}

function ElevationRow({ state }: { state: ElevationState }) {
  let main: string;
  let detail: string;
  let tone: 'value' | 'warn' = 'value';
  switch (state.kind) {
    case 'idle':
    case 'loading':
      main = '…';
      detail = state.kind === 'idle' ? 'Querying the Trek DEM service…' : 'Awaiting query…';
      break;
    case 'live':
      main = `${state.value.toLocaleString('en-US')} m`;
      detail = `Queried from Trek DEM service (static MOLA+HRSC blend, 2018 v2), ${formatUtcTime(state.fetchedAt)}`;
      break;
    case 'no-data':
      main = 'Unknown';
      tone = 'warn';
      detail = 'The DEM service reports NoData at this point.';
      break;
    case 'error':
      main = 'Unknown';
      tone = 'warn';
      detail = `Live query failed (${state.message}).`;
      break;
  }
  return (
    <div>
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">Elevation</span>
      <div
        className={cn(
          'mt-0.5 font-mono text-[17px] leading-tight',
          tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {main}
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-ink-subtle">{detail}</p>
      {state.kind === 'error' && state.fallbackValue !== null && (
        <p className="mt-1 text-[10.5px] leading-snug text-ink-muted">
          Prepared-grid fallback: {Math.round(state.fallbackValue).toLocaleString('en-US')} m —{' '}
          {state.fallbackLabel}
        </p>
      )}
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
                fallbackLabel = `bilinear sample of the prepared grid (prepared ${grid.meta.preparedAt.slice(0, 10)}; centre validated against the live service at preparation time)`;
              } else {
                fallbackLabel = null;
              }
            }
          } catch {
            // Fallback stays unavailable; the primary Unknown stands.
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

  /* Report the elevation state that belongs to the CURRENT location only —
   * a state keyed to a previous location is reported as a pending query
   * instead of being paired with the new point. */
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
      <div data-testid="location-panel">
        <Section title="Location">
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-edge bg-panel-raised/40 px-4 py-7 text-center">
            <Crosshair className="size-5 text-accent" aria-hidden="true" />
            <span className="text-[13px] font-medium text-ink">No location selected</span>
            <p className="max-w-[26ch] text-[11.5px] leading-snug text-ink-subtle">
              Click the map to inspect coordinates, elevation and coverage.
            </p>
          </div>
        </Section>
      </div>
    );
  }

  const bbox = region?.boundingBox;
  const inside = bbox !== undefined && isInsideBoundingBox(location, bbox);

  const handleCopy = () => {
    const text = `${formatLon(location.lon)}, ${formatLat(location.lat)}`;
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

  return (
    <div data-testid="location-panel">
      <Section
        title="Location"
        hint="clicked point"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            aria-label="Copy coordinates"
            className="-mr-1.5"
          >
            {copyState === 'ok' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </Button>
        }
      >
        <div className="rounded-lg border border-edge bg-panel-raised/60 px-3 py-2.5">
          <div className="font-mono text-[14px] leading-snug text-ink">
            <div>{formatLon(location.lon)}</div>
            <div className="mt-0.5">{formatLat(location.lat)}</div>
          </div>
          <div className="mt-1.5 font-mono text-[11px] leading-snug text-ink-subtle">
            X {formatMetreSigned(location.x)} · Y {formatMetreSigned(location.y)}
          </div>
          {bbox && (
            <div
              data-testid="region-membership"
              className={cn(
                'mt-2.5 rounded-md border px-2 py-1 text-[11.5px] font-medium leading-snug',
                inside ? 'border-ok/40 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn',
              )}
            >
              {inside
                ? 'Inside exploration region'
                : 'Outside exploration region — global imagery and elevation products only; route planning unavailable here.'}
            </div>
          )}
        </div>
      </Section>

      <Section title="Scientific values here">
        <div className="rounded-lg border border-edge bg-panel-raised/60 px-3 py-2.5">
          <ElevationRow state={elevationState} />
        </div>
        <div className="mt-1.5 divide-y divide-edge/60">
          <UnknownRow
            label="Slope"
            reason="Site-scale slope needs terrain detail beyond the ~200 m/px DEM; no fine DEM is integrated."
          />
          <UnknownRow
            label="Surface conditions"
            reason="No rock/regolith/roughness dataset is integrated; imagery is historical."
          />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-subtle">
          Elevation is relative to the Mars areoid (MOLA-registered MOLA+HRSC blend, ~200 m/px) —
          a coarse regional value, not a site survey.
        </p>
      </Section>
    </div>
  );
}
