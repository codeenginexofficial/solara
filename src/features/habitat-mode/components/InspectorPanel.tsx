/**
 * InspectorPanel — the workspace "Inspector" tab: selected location, details
 * for the selected dataset, and mission route results (summary, elevation
 * profile, terrain-derived warnings, route data provenance).
 *
 * Route results moved out of MissionPanel (2026-11-14 UI milestone) so the
 * left panel stays focused on planning controls while results live next to
 * the location/dataset inspection they belong to. RouteSummary and
 * ElevationProfile remain shared with Field Tablet Mode.
 */

import { Flag } from 'lucide-react';
import type { MapLocation } from '../../../map/mapTypes';
import type { DatasetRecord, RegionRecord } from '../../../data/catalog/types';
import { Section } from '../../../components/ui/section';
import { DatasetDetails } from './DatasetPanel';
import { LocationPanel, type ElevationState } from './LocationPanel';
import { ElevationProfile } from '../../mission/components/ElevationProfile';
import { RouteSummary } from '../../mission/components/RouteSummary';
import { useMissionState } from '../../mission/store';

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

  return (
    <div data-testid="inspector-panel">
      <LocationPanel
        location={location}
        region={region}
        onElevationStateChange={onElevationStateChange}
      />

      {dataset && (
        <Section title="Selected dataset" hint={dataset.id}>
          <DatasetDetails dataset={dataset} embedded />
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
                <Flag className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mission.gridMeta && (
        <Section title="Route data provenance">
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
        </Section>
      )}
    </div>
  );
}
