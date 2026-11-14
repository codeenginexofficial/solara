/**
 * InspectorPanel — the workspace "Inspector" tab: selected location, details
 * for the selected dataset, and mission route results (summary, elevation
 * profile, terrain-derived warnings, route data provenance).
 *
 * Revision 2 composition (2026-11-14): the tab reads top-down as
 * location → scientific values (inside LocationPanel) → selected dataset
 * (compact summary card; the full technical record sits behind a
 * disclosure) → route candidate. Lengthy product identifiers, technical
 * metadata and provenance stay collapsed by default.
 *
 * Route results moved out of MissionPanel (2026-11-14 UI milestone) so the
 * left panel stays focused on planning controls while results live next to
 * the location/dataset inspection they belong to. RouteSummary and
 * ElevationProfile remain shared with Field Tablet Mode.
 */

import { Flag } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import type { DatasetRecord, RegionRecord, VerificationStatus } from '../../../data/catalog/types';
import { Badge } from '../../../components/ui/badge';
import { Disclosure } from '../../../components/ui/disclosure';
import { Section } from '../../../components/ui/section';
import { DatasetDetails } from './DatasetPanel';
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
    <div data-testid="inspector-panel">
      <LocationPanel
        location={location}
        region={region}
        onElevationStateChange={onElevationStateChange}
      />

      {dataset && (
        <Section title="Selected dataset" hint={dataset.kind}>
          <div className="rounded-lg border border-edge bg-panel-raised/60 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-[13px] font-semibold leading-snug text-ink" title={dataset.title}>
                {dataset.title}
              </h4>
              <span className="shrink-0" title="Verification-workflow status — not a live health signal">
                <Badge tone={badge!.tone}>{badge!.label}</Badge>
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">{dataset.description}</p>
            <Disclosure title="Details & provenance" className="mt-2">
              <DatasetDetails dataset={dataset} embedded hideHeader hideDescription />
            </Disclosure>
          </div>
        </Section>
      )}

      <RouteSummary
        route={route}
        computing={mission.routeStatus === 'computing'}
        error={mission.routeError?.message ?? null}
      />

      {route && (
        <Section title="Elevation profile">
          <ElevationProfile route={route} />
        </Section>
      )}

      {route && route.warnings.length > 0 && (
        <Section title="Terrain-derived concerns" hint="prototype model">
          <ul className="flex flex-col gap-1.5" data-testid="route-warnings">
            {route.warnings.map((warning, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-snug text-warn">
                <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mission.gridMeta && (
        <Section title="Route data provenance">
          <Disclosure title="Technical provenance details">
            <div className="flex flex-col gap-1 text-[11px] leading-snug text-ink-muted">
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
          </Disclosure>
        </Section>
      )}
    </div>
  );
}
