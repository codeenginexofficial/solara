/**
 * StatusBar — bottom bar: pointer coordinates, projection identifier,
 * zoom/resolution information, and active dataset status (Design.md §5).
 */

import type { MapLocation, SourceStatus, ViewInfo } from '../../../map/mapTypes';
import type { DatasetRecord, VerificationStatus } from '../../../data/catalog/types';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon, formatResolution } from '../../../lib/format';

export interface StatusBarProps {
  pointerLocation: MapLocation | null;
  viewInfo: ViewInfo | null;
  dataset: DatasetRecord | undefined;
  sourceStatus: SourceStatus;
}

const DATASET_STATUS_TEXT: Record<VerificationStatus, string> = {
  unverified: 'Unverified',
  inspected: 'Inspected',
  tested: 'Tested',
  integrated: 'Integrated',
};

export function StatusBar({ pointerLocation, viewInfo, dataset, sourceStatus }: StatusBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-t border-edge bg-panel px-3 font-mono text-[10.5px] text-ink-muted">
      <span className="flex shrink-0 items-center gap-1.5" data-testid="status-pointer">
        <span aria-hidden="true" className="text-ink-subtle">⌖</span>
        {pointerLocation
          ? `${formatLon(pointerLocation.lon)} ${formatLat(pointerLocation.lat)}`
          : 'lon — , lat —'}
      </span>

      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

      <span className="shrink-0" title="Map projection">
        EPSG:104905
      </span>
      <span className="hidden shrink-0 text-ink-subtle sm:inline" title="Working projection units">
        metres
      </span>

      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

      <span className="shrink-0" data-testid="status-resolution">
        {viewInfo ? formatResolution(viewInfo.resolutionMpp) : '— m/px'}
        {viewInfo?.tileLevel !== null && viewInfo?.tileLevel !== undefined ? ` · L${viewInfo.tileLevel}` : ''}
      </span>
      <span className="hidden shrink-0 text-ink-subtle lg:inline">
        {viewInfo ? `centre ${formatLon(viewInfo.center.lon)} ${formatLat(viewInfo.center.lat)}` : ''}
      </span>

      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

      <span
        className="ml-auto flex shrink-0 items-center gap-1.5"
        title={sourceStatus.message}
        data-testid="status-dataset"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            sourceStatus.capabilities === 'live' && 'bg-ok',
            sourceStatus.capabilities === 'checking' && 'bg-ink-subtle',
            sourceStatus.capabilities === 'schema-changed' && 'bg-warn',
            sourceStatus.capabilities === 'unavailable' && 'bg-danger',
          )}
        />
        {dataset ? `${dataset.instrument ?? dataset.id}: ${DATASET_STATUS_TEXT[dataset.verification]}` : 'No active dataset'}
      </span>
    </footer>
  );
}
