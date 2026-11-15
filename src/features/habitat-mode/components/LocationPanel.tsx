/**
 * LocationPanel — the map location selected by clicking, shown in the
 * workspace Inspector tab (Context.md §4.1, Solara Mars Mission Dashboard reference).
 *
 * Coordinates lead (large mono pair), elevation with mountain icon,
 * region membership chip, and scientific unknown rows.
 * Deliberate empty state: "No location selected / Select a map location."
 */

import { useEffect, useRef, useState } from 'react';
import { Crosshair, ExternalLink, Mountain } from 'lucide-react';
import type { MapFeatureSelection, MapLocation } from '../../../map/mapTypes';
import type { RegionRecord } from '../../../data/catalog/types';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon, formatMetreSigned, formatUtcTime } from '../../../lib/format';
import { isInsideBoundingBox } from '../../../lib/bbox';
import { identifyElevation } from '../../../data/adapters/demService';
import { fetchElevationGrid, sampleElevation, type ElevationGrid } from '../../../data/adapters/elevationGrid';
import { getDatasetById } from '../../../data/catalog/datasets';
import { getDatasetCoverage } from '../../../../worker/src/science/coverage';
import { Disclosure } from '../../../components/ui/disclosure';

export interface LocationPanelProps {
  location: MapLocation | null;
  /** Named waypoint the click landed on, when any. */
  feature?: MapFeatureSelection | null;
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

export function LocationPanel({ location, feature, region, onElevationStateChange }: LocationPanelProps) {
  const [elevationState, setElevationState] = useState<ElevationState>({ kind: 'idle' });
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featureDataset = feature ? getDatasetById(feature.datasetId) : undefined;

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
  const coverage = getDatasetCoverage(location.lon, location.lat);
  const globalCtx = coverage.datasets.find((entry) => entry.datasetId === 'mars-global-ctx-mosaic-v01');
  const jezeroCtx = coverage.datasets.find((entry) => entry.datasetId === 'jezero-ctx-mosaic-soc-008');
  const isMissionSite = feature?.datasetId === 'mars-verified-mission-sites';
  const isIauFeature = feature?.datasetId === 'jezero-iau-nomenclature' || feature?.datasetId === 'mars-global-iau-gazetteer';

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
            <span>{inside ? 'Inside Jezero detail area' : 'Outside Jezero detail area'}</span>
          </div>

          <span className="font-mono text-[11px] text-ink-subtle">
            X {formatMetreSigned(location.x)} · Y {formatMetreSigned(location.y)}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-subtle" data-testid="imagery-availability-note">
          Viking MDIM provides historical global optical context. Global CTX is
          {globalCtx?.extentStatus === 'within_declared_extent' ? ' within its 88° coverage extent (with known gaps)' : ' outside its stated ±88° latitude coverage'};
          {jezeroCtx?.extentStatus === 'within_declared_extent' ? ' the controlled Jezero CTX mosaic also lists this point in its footprint.' : ' the controlled Jezero CTX mosaic is not declared at this point.'}
          {' '}No HiRISE coverage is implied.
        </p>
        {!inside && (
          <p className="mt-1.5 text-[11px] leading-snug text-ink-subtle">
            Global terrain-cost routing remains available here through live NASA Trek DEM windows.
            Coverage can be missing or coarser than the prepared Jezero grid; the route report states
            the effective resolution and any gaps. Detailed Jezero overlays remain limited to their
            published footprints.
          </p>
        )}
      </div>

      <Disclosure title="Dataset extents at this coordinate" className="mt-3" contentClassName="max-h-72 space-y-2 overflow-y-auto">
        <p className="text-[10px] leading-snug text-ink-subtle">
          These are catalog extent checks, not proof of valid pixels. Gaps, sparse tracks, and in-situ measurements remain source-specific.
        </p>
        {coverage.datasets.map((entry) => {
          const extentLabel = entry.extentStatus === 'within_declared_extent'
            ? 'Within stated extent'
            : entry.extentStatus === 'outside_declared_extent'
              ? 'Outside stated extent'
              : 'Extent unknown';
          const availabilityLabel = entry.availability.replaceAll('_', ' ');
          return (
            <div key={entry.datasetId} className="border-t border-edge/40 pt-1.5" title={entry.extentNote}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[10.5px] font-medium leading-snug text-ink">{entry.title}</span>
                <span className={cn(
                  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px]',
                  entry.extentStatus === 'within_declared_extent'
                    ? 'border-edge text-ink-muted'
                    : 'border-warn/40 text-warn',
                )}>{extentLabel}</span>
              </div>
              <div className="mt-0.5 text-[9.5px] text-ink-subtle">
                {entry.spatialResolution ?? 'Resolution not recorded'}
                {entry.observationPeriod ? ` · ${entry.observationPeriod}` : ''}
                {` · ${availabilityLabel}`}
              </div>
              {entry.kind === 'thermal' && <div className="mt-0.5 text-[9.5px] text-ink-subtle">Infrared science data; not visible-light photography or point air temperature.</div>}
              {(entry.datasetId === 'mars2020-meda-environmental' || entry.kind === 'rover') && (
                <div className="mt-0.5 text-[9.5px] text-ink-subtle">Historical / in-situ mission data; not a live global observation.</div>
              )}
            </div>
          );
        })}
      </Disclosure>

      {/* Selected science waypoint (named destination) */}
      {feature && (
        <div
          className="mt-3 rounded-md border border-edge/70 bg-surface/60 p-2.5"
          data-testid="science-stop-card"
        >
          <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">
            {isMissionSite ? 'Historic mission site' : isIauFeature ? 'IAU feature' : 'Science stop'}
          </div>
          <div className="mt-0.5 text-[13px] font-semibold leading-snug text-ink">
            {feature.name}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
            {isMissionSite
              ? `${String(feature.sourceProperties.mission ?? 'Historic mission')} · ${String(feature.sourceProperties.coordinateNote ?? 'Published site coordinate')}. This is a historical site marker, not a live rover position.`
              : isIauFeature
                ? 'IAU-adopted feature name (USGS/IAU Gazetteer). Identification only — no boundary, hazard, or trafficability information is implied.'
                : 'Compiled NASA Trek waypoint. A destination of scientific interest — not a hazard, trafficability, or landing assessment.'}
          </p>
          <div className="mt-2 border-t border-edge/50 pt-2">
            <div className="text-[10px] uppercase tracking-[0.05em] text-ink-subtle">Feature coordinates · Mars lon/lat</div>
            <div className="mt-0.5 font-mono text-[11px] text-ink">
              {formatLat(feature.lat)}, {formatLon(feature.lon)}
            </div>
          </div>
          {featureDataset && (
            <div className="mt-2 text-[10px] leading-snug text-ink-subtle">
              <div>Source: {featureDataset.title} · {featureDataset.provider}</div>
              <a
                href={featureDataset.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 inline-flex items-center gap-1 text-info hover:underline"
              >
                Dataset source <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
          )}
          {Object.entries(feature.sourceProperties)
            .filter(([key]) => key !== 'name' && key !== 'template' && key !== 'gazetteerUrl')
            .map(([key, value]) => {
              const humanizedKey = key.replace(/([a-z])([A-Z])/g, '$1 $2');
              const label = key === 'elevationDeclared'
                ? 'Published elevation field'
                : `${humanizedKey.charAt(0).toUpperCase()}${humanizedKey.slice(1)}`;
              const displayValue = key === 'elevationDeclared' && value === 0
                ? '0 — Trek publishes this field as 0; it is not a measured elevation.'
                : value === null ? 'Unknown (source field is null)' : String(value);
              return (
                <div key={key} className="mt-1.5 border-t border-edge/40 pt-1.5">
                  <div className="text-[10px] uppercase tracking-[0.04em] text-ink-subtle">{label}</div>
                  <div className="mt-0.5 break-words text-[11px] text-ink-muted">{displayValue}</div>
                </div>
              );
            })}
          {feature.detailUrl && (
            <a
              href={feature.detailUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-info hover:underline"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              {isMissionSite ? 'Mission source' : isIauFeature ? 'IAU gazetteer' : 'Trek bookmark'}
            </a>
          )}
        </div>
      )}

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
