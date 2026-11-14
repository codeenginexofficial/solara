/**
 * InspectorPanel — the workspace "Inspector" tab: selected location,
 * dataset details with vector thumbnail, and mission route results.
 * (Design.md §5, Solara Mars Mission Dashboard reference).
 */

import { Database, Flag, Route } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import type { DatasetRecord, RegionRecord, VerificationStatus } from '../../../data/catalog/types';
import { Badge } from '../../../components/ui/badge';
import { Disclosure } from '../../../components/ui/disclosure';
import { CtxThumbnail, TopographyThumbnail } from '../../../components/ui/thumbnails';
import { DatasetDetails } from './DatasetPanel';
import { DATASET_SHORT_NAMES } from './MissionOperationsPanel';
import { LocationPanel, type ElevationState } from './LocationPanel';
import { ElevationProfile } from '../../mission/components/ElevationProfile';
import { RouteSummary } from '../../mission/components/RouteSummary';
import { useMissionState } from '../../mission/store';

const VERIFICATION_BADGE: Record<VerificationStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' }> = {
  unverified: { label: 'Unverified', tone: 'warn' },
  inspected: { label: 'Inspected', tone: 'info' },
  tested: { label: 'Tested', tone: 'info' },
  integrated: { label: 'Integrated', tone: 'ok' },
};

export interface InspectorPanelProps {
  location: MapLocation | null;
  region: RegionRecord;
  dataset: DatasetRecord | undefined;
  onElevationStateChange: (state: ElevationState | null) => void;
}

export function InspectorPanel({
  location,
  region,
  dataset,
  onElevationStateChange,
}: InspectorPanelProps) {
  const mission = useMissionState();
  const route = mission.route;
  const badge = dataset ? VERIFICATION_BADGE[dataset.verification] : undefined;

  return (
    <div data-testid="inspector-panel" className="flex flex-col gap-2.5 p-3">
      {/* 1. Location Details Card */}
      <LocationPanel
        location={location}
        region={region}
        onElevationStateChange={onElevationStateChange}
      />

      {/* 2. Selected Dataset Info Card */}
      {dataset && (
        <section className="rounded-lg border border-edge bg-panel-raised/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-ink-muted" aria-hidden="true" />
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Dataset Info
              </h3>
            </div>
            {badge && (
              <Badge tone={badge.tone} className="text-[10px]">
                {badge.label}
              </Badge>
            )}
          </div>

          <div className="mt-2.5 flex items-start gap-3 rounded-md border border-edge/60 bg-surface/50 p-2.5">
            {dataset.id.includes('ctx') ? (
              <CtxThumbnail className="size-12 shrink-0 rounded-sm border border-edge/60" />
            ) : (
              <TopographyThumbnail className="size-12 shrink-0 rounded-sm border border-edge/60" />
            )}
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-semibold text-ink" title={dataset.title}>
                {DATASET_SHORT_NAMES[dataset.id] ?? dataset.title}
              </h4>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                {dataset.description}
              </p>
            </div>
          </div>

          <div className="mt-2.5">
            <Disclosure title="Details & provenance">
              <DatasetDetails dataset={dataset} embedded hideHeader hideDescription />
            </Disclosure>
          </div>
        </section>
      )}

      {/* 3. Route Info Card */}
      <section className="rounded-lg border border-edge bg-panel-raised/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Route className="size-4 text-ink-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Route Info
          </h3>
        </div>

        <RouteSummary
          route={route}
          computing={mission.routeStatus === 'computing'}
          error={mission.routeError?.message ?? null}
        />

        {route && (
          <div className="mt-3 border-t border-edge/60 pt-3">
            <div className="mb-2 text-xs font-medium text-ink-muted">Elevation profile</div>
            <ElevationProfile route={route} />
          </div>
        )}

        {route && route.warnings.length > 0 && (
          <div className="mt-3 border-t border-edge/60 pt-2.5">
            <div className="mb-1 text-xs font-medium text-warn">Terrain concerns (prototype model)</div>
            <ul className="flex flex-col gap-1.5" data-testid="route-warnings">
              {route.warnings.map((warning, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-snug text-warn">
                  <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mission.gridMeta && (
          <div className="mt-3 border-t border-edge/60 pt-2">
            <Disclosure title="Route data provenance">
              <div className="flex flex-col gap-1 text-[11px] leading-snug text-ink-muted">
                <span>
                  Grid prepared <span className="font-mono">{mission.gridMeta.preparedAt.slice(0, 10)}</span> from{' '}
                  <span className="break-all">{mission.gridMeta.sourceService}</span>
                </span>
                <span>{mission.gridMeta.sourceMethod}</span>
                {mission.gridMeta.centreValidation && (
                  <span>
                    Centre cross-check: live identify {mission.gridMeta.centreValidation.identifyValueM} m vs grid{' '}
                    {mission.gridMeta.centreValidation.gridBilinearM} m
                  </span>
                )}
                <span className="text-ink-subtle">{mission.gridMeta.verticalReference}</span>
              </div>
            </Disclosure>
          </div>
        )}
      </section>
    </div>
  );
}
