/**
 * LocationPanel — right panel: the map location selected by clicking.
 *
 * Elevation is queried LIVE from the verified Trek ImageServer
 * (MOLA+HRSC blend DEM). When the live query fails, the prepared grid asset
 * (cross-validated against the live service at preparation time) provides a
 * fallback, clearly labelled as derived-from-prepared-grid. When neither is
 * available, elevation is shown as Unknown. Slope at a single point and
 * surface conditions are NOT derivable from integrated data and are shown
 * as unknown with reasons (Context.md §7).
 */

import { useEffect, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import { Section, DataRow } from '../../../components/ui/section';
import { formatLat, formatLon, formatMetreSigned, formatUtcTime } from '../../../lib/format';
import { identifyElevation } from '../../../data/adapters/demService';
import { fetchElevationGrid, sampleElevation, type ElevationGrid } from '../../../data/adapters/elevationGrid';
import { getDatasetById } from '../../../data/catalog/datasets';

export interface LocationPanelProps {
  location: MapLocation | null;
}

type ElevationState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'live'; value: number; fetchedAt: string }
  | { kind: 'no-data'; fetchedAt: string }
  | { kind: 'error'; message: string; fallbackValue: number | null; fallbackLabel: string | null };

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
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-warn">Unknown</span>
        <span className="text-[10px] leading-snug text-ink-subtle">{reason}</span>
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
      detail = state.kind === 'idle' ? 'Querying the live DEM service…' : 'Awaiting query…';
      break;
    case 'live':
      main = `${state.value.toLocaleString('en-US')} m`;
      detail = `Live DEM service query, ${formatUtcTime(state.fetchedAt)}`;
      break;
    case 'no-data':
      main = 'Unknown';
      tone = 'warn';
      detail = 'The live DEM service reports NoData at this point.';
      break;
    case 'error':
      main = 'Unknown';
      tone = 'warn';
      detail = `Live query failed (${state.message}).`;
      break;
  }
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">Elevation</span>
      <span className="flex items-baseline gap-2">
        <span className={tone === 'warn' ? 'text-xs font-medium text-warn' : 'text-xs font-medium text-ink'}>
          {main}
        </span>
        <span className="text-[10px] leading-snug text-ink-subtle">{detail}</span>
      </span>
      {state.kind === 'error' && state.fallbackValue !== null && (
        <span className="text-[10px] leading-snug text-ink-muted">
          Prepared-grid fallback: {Math.round(state.fallbackValue).toLocaleString('en-US')} m —{' '}
          {state.fallbackLabel}
        </span>
      )}
    </div>
  );
}

export function LocationPanel({ location }: LocationPanelProps) {
  const [elevationState, setElevationState] = useState<ElevationState>({ kind: 'idle' });

  useEffect(() => {
    if (!location) {
      setElevationState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const lon = Number(location.lon.toFixed(6));
    const lat = Number(location.lat.toFixed(6));
    setElevationState({ kind: 'loading' });

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await identifyElevation(lon, lat);
          if (cancelled) return;
          if (result.noData) {
            setElevationState({ kind: 'no-data', fetchedAt: result.fetchedAt });
          } else {
            setElevationState({ kind: 'live', value: result.elevationM ?? Number.NaN, fetchedAt: result.fetchedAt });
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
            setElevationState({ kind: 'error', message, fallbackValue, fallbackLabel });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [location]);

  if (!location) {
    return (
      <div data-testid="location-panel">
        <Section title="Selected location">
          <div className="flex items-start gap-2 py-1 text-[11px] leading-relaxed text-ink-muted">
            <Crosshair className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
            <p>
              Click anywhere on the map to inspect a coordinate. Pointer coordinates are shown
              continuously in the status bar.
            </p>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div data-testid="location-panel">
      <Section title="Selected location" hint="clicked point">
        <div className="divide-y divide-edge/60">
          <DataRow label="Longitude" mono>{formatLon(location.lon)}</DataRow>
          <DataRow label="Latitude" mono>{formatLat(location.lat)}</DataRow>
          <DataRow label="Projected X (easting)" mono>{formatMetreSigned(location.x)}</DataRow>
          <DataRow label="Projected Y (northing)" mono>{formatMetreSigned(location.y)}</DataRow>
        </div>
      </Section>

      <Section title="Scientific values here">
        <div className="divide-y divide-edge/60">
          <ElevationRow state={elevationState} />
          <UnknownRow
            label="Slope"
            reason="Site-scale slope needs terrain detail beyond the ~200 m/px DEM; no fine DEM is integrated."
          />
          <UnknownRow
            label="Surface conditions"
            reason="No rock/regolith/roughness dataset is integrated; imagery is historical."
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-subtle">
          Elevation is relative to the Mars areoid (MOLA-registered MOLA+HRSC blend, ~200 m/px) —
          a coarse regional value, not a site survey.
        </p>
      </Section>
    </div>
  );
}
