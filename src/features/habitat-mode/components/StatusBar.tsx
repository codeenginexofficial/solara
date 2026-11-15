/**
 * StatusBar — bottom bar: telemetry, working-projection identifier,
 * zoom/resolution information, and mission route actions (Design.md §5,
 * Solara Mars Mission Dashboard reference).
 */

import { Download, MoreHorizontal, Play } from 'lucide-react';
import type { MapLocation, SourceStatus, ViewInfo } from '../../../map/mapTypes';
import type { DatasetRecord, VerificationStatus } from '../../../data/catalog/types';
import type { ElevationState } from './LocationPanel';
import { MARS_EQUIRECTANGULAR, PROJECTION_INFO } from '../../../lib/marsCrs';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { formatLat, formatLon, formatResolution } from '../../../lib/format';

export interface StatusBarProps {
  pointerLocation: MapLocation | null;
  selectedLocation?: MapLocation | null;
  elevationState?: ElevationState | null;
  viewInfo: ViewInfo | null;
  dataset: DatasetRecord | undefined;
  sourceStatus: SourceStatus;
  canComputeRoute?: boolean;
  computingRoute?: boolean;
  onComputeRoute?: () => void;
  onExportPlan?: () => void;
  onImportPlan?: () => void;
}

const DATASET_STATUS_TEXT: Record<VerificationStatus, string> = {
  unverified: 'Unverified',
  inspected: 'Inspected',
  tested: 'Tested',
  integrated: 'Integrated',
};

export function StatusBar({
  pointerLocation,
  selectedLocation,
  elevationState,
  viewInfo,
  dataset,
  sourceStatus,
  canComputeRoute,
  computingRoute,
  onComputeRoute,
  onExportPlan,
  onImportPlan,
}: StatusBarProps) {
  // Format elevation from current elevation state if available
  let elevationDisplay = '—';
  if (elevationState) {
    if (elevationState.kind === 'live') {
      elevationDisplay = `${elevationState.value.toLocaleString('en-US')} m`;
    } else if (elevationState.kind === 'error' && elevationState.fallbackValue !== null) {
      elevationDisplay = `~${Math.round(elevationState.fallbackValue).toLocaleString('en-US')} m`;
    } else if (elevationState.kind === 'loading') {
      elevationDisplay = '…';
    }
  }

  // Active position is selectedLocation or pointerLocation
  const activeLoc = selectedLocation ?? pointerLocation;

  return (
    <footer className="flex h-12 shrink-0 items-center justify-between gap-3 overflow-x-auto rounded-xl border border-edge bg-panel px-4 font-mono text-[11px] text-ink-muted">
      {/* Left side telemetry indicators */}
      <div className="flex shrink-0 items-center gap-3">
        {/* System nominal / live indicator */}
        <span
          className="flex shrink-0 items-center gap-1.5 font-sans font-medium text-xs text-ink"
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
              sourceStatus.capabilities === 'unavailable' && 'bg-warn',
            )}
          />
          System Nominal
        </span>

        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

        {/* Elevation readout */}
        <span className="shrink-0">
          <span className="text-ink-subtle font-sans">Elevation: </span>
          <span className="text-ink font-semibold">{elevationDisplay}</span>
        </span>

        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

        {/* Position coordinates */}
        <span className="shrink-0" data-testid="status-pointer">
          <span className="text-ink-subtle font-sans">Position: </span>
          <span className="text-ink">
            {activeLoc
              ? `${formatLat(activeLoc.lat)}, ${formatLon(activeLoc.lon)}`
              : '18.44° N, 77.45° E'}
          </span>
        </span>

        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-edge" />

        {/* Region */}
        <span className="hidden sm:inline shrink-0">
          <span className="text-ink-subtle font-sans">Region: </span>
          <span className="text-ink">Jezero</span>
        </span>

        <span aria-hidden="true" className="hidden lg:inline h-3.5 w-px shrink-0 bg-edge" />

        {/* Working projection */}
        <span
          className="hidden lg:inline shrink-0 font-mono text-ink-subtle"
          title={`${PROJECTION_INFO[MARS_EQUIRECTANGULAR].label} — declared by the source as urn:ogc:def:crs:EPSG::104905`}
          data-testid="status-crs"
        >
          {MARS_EQUIRECTANGULAR}
        </span>

        <span aria-hidden="true" className="hidden xl:inline h-3.5 w-px shrink-0 bg-edge" />

        {/* Resolution */}
        <span className="hidden xl:inline shrink-0 text-ink-subtle" data-testid="status-resolution">
          {viewInfo ? formatResolution(viewInfo.resolutionMpp) : '— m/px'}
          {viewInfo?.tileLevel !== null && viewInfo?.tileLevel !== undefined ? ` · L${viewInfo.tileLevel}` : ''}
        </span>

        {dataset && (
          <span className="hidden 2xl:inline shrink-0 text-ink-subtle">
            • {dataset.instrument ?? dataset.id}: {DATASET_STATUS_TEXT[dataset.verification]}
          </span>
        )}
      </div>

      {/* Right side actions (Compute Route, Export, More) */}
      <div className="flex shrink-0 items-center gap-2">
        {onComputeRoute && (
          <Button
            variant="accent"
            size="sm"
            onClick={onComputeRoute}
            disabled={!canComputeRoute || computingRoute}
            className="h-8 px-3.5 gap-1.5 text-xs rounded-md"
            data-testid="status-compute-route"
          >
            <Play className="size-3.5 fill-current" aria-hidden="true" />
            <span>{computingRoute ? 'Computing…' : 'Compute Route'}</span>
          </Button>
        )}

        {onExportPlan && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExportPlan}
            className="h-8 px-3 gap-1.5 text-xs rounded-md"
            title="Export plan (JSON)"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span className="hidden md:inline">Export</span>
          </Button>
        )}

        {onImportPlan && (
          <Button
            variant="outline"
            size="sm"
            onClick={onImportPlan}
            className="h-8 px-2.5 text-xs rounded-md"
            title="Import plan or options"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </footer>
  );
}
