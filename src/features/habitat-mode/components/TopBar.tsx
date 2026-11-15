/**
 * TopBar — application header: wordmark, operating-mode navigation, region
 * context, source connection status, and compact controls (Design.md §5).
 *
 * The mode switch is deliberately part of the header (not a floating control
 * over the map): mode selection is an explicit, always-visible decision.
 */

import { PanelLeft, PanelRight, Maximize2, MapPin, Globe } from 'lucide-react';
import type { SourceStatus, CapabilitiesStatus } from '../../../map/mapTypes';
import type { MapLocation, MapProjectionMode } from '../../../map/mapTypes';
import { Button } from '../../../components/ui/button';
import { PlanetaryLocationSearch } from '../../global-exploration/PlanetaryLocationSearch';
import { cn } from '../../../lib/utils';
import { formatUtcTime } from '../../../lib/format';
import type { IauFeature } from '../../../data/adapters/iauFeatureService';

/**
 * Labels for the live capabilities verification state. The map itself always
 * renders from the verified snapshot configuration; these labels describe
 * only whether the LIVE document was re-verified successfully — never claim
 * reachability that has not been confirmed.
 */
const STATUS_TEXT: Record<CapabilitiesStatus, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  checking: { label: 'Verifying live source', tone: 'neutral' },
  live: { label: 'Live', tone: 'ok' },
  'schema-changed': { label: 'Snapshot active', tone: 'warn' },
  unavailable: { label: 'Snapshot active', tone: 'warn' },
};

export interface TopBarProps {
  regionLabel: string;
  sourceStatus: SourceStatus;
  onFitRegion: () => void;
  onToggleGlobe: () => void;
  globeActive: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  /** Provided when the app can switch to Field Tablet Mode from here. */
  onSwitchToTablet?: () => void;
  projectionMode: MapProjectionMode;
  onProjectionModeChange: (mode: MapProjectionMode) => void;
  onSelectLocation: (location: MapLocation, label?: string, feature?: IauFeature) => void;
}

export function TopBar({
  regionLabel,
  sourceStatus,
  onFitRegion,
  onToggleGlobe,
  globeActive,
  onToggleLeftPanel,
  onToggleRightPanel,
  onSwitchToTablet,
  projectionMode,
  onProjectionModeChange,
  onSelectLocation,
}: TopBarProps) {
  const status = STATUS_TEXT[sourceStatus.capabilities];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 rounded-xl border border-edge bg-panel px-2 sm:gap-3 sm:px-3.5">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5">
        <img src="/solara.svg" alt="" aria-hidden="true" className="size-5" />
        <span className="hidden text-sm font-medium tracking-[0.2em] text-ink sm:inline">SOLARA</span>
      </div>

      <span className="hidden h-4 w-px bg-edge md:block" aria-hidden="true" />

      {/* Operating-mode navigation (this header only ever shows Habitat as
          active; Field Tablet renders its own header variant). */}
      {onSwitchToTablet && (
        <div
          className="flex items-center gap-1 rounded-md border border-edge/60 bg-surface/50 p-1"
          aria-label="Operating mode"
          data-testid="mode-switch"
        >
          <span
            aria-current="true"
            className="whitespace-nowrap rounded-sm bg-elevated px-2.5 py-1 text-xs font-medium text-ink shadow-none"
          >
            Habitat
          </span>
          <button
            type="button"
            onClick={onSwitchToTablet}
            aria-label="Switch to Field Tablet mode"
            className="whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-[160ms] ease-out hover:bg-subtle/70 hover:text-ink"
          >
            Field Tablet
          </button>
        </div>
      )}

      {/* Region context with MapPin icon */}
      <div
        className="hidden min-w-0 items-center gap-1.5 truncate text-xs text-ink-muted md:flex"
        title={regionLabel}
      >
        <MapPin className="size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="truncate">{globeActive ? 'Mars · Global 3D' : 'Mars · Planetary surface'}</span>
      </div>

      {/* Search drops out below sm — the header cannot fit it beside the
          mode switch and panel toggles at phone widths; the map itself and
          Field Tablet's header keep search reachable there. */}
      <PlanetaryLocationSearch
        projectionMode={projectionMode}
        onProjectionModeChange={onProjectionModeChange}
        onSelectLocation={onSelectLocation}
        className="mx-1 hidden min-w-0 flex-1 sm:flex"
        compact
      />

      <div className="ml-auto flex items-center gap-2">
        {/* Source connection status */}
        {!globeActive && <div
          className="hidden min-w-0 items-center gap-1.5 sm:flex"
          title={sourceStatus.message}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              status.tone === 'ok' && 'bg-ok',
              status.tone === 'warn' && 'bg-warn',
              status.tone === 'danger' && 'bg-danger',
              status.tone === 'neutral' && 'bg-ink-subtle',
            )}
          />
          <span className="whitespace-nowrap text-xs text-ink-muted">{status.label}</span>
          {sourceStatus.lastCheckedAt && (
            <span className="font-mono text-[11px] text-ink-subtle">
              • {formatUtcTime(sourceStatus.lastCheckedAt)}
            </span>
          )}
        </div>}

        <span className="hidden h-4 w-px bg-edge sm:block" aria-hidden="true" />

        {!globeActive && <Button
          variant="ghost"
          size="icon"
          aria-label="Fit view to region"
          title="Fit view to region"
          onClick={onFitRegion}
          className="hidden sm:inline-flex"
        >
          <Maximize2 />
        </Button>}
        <Button
          variant={globeActive ? 'accent' : 'outline'}
          size="sm"
          className="h-8 px-2.5 text-xs"
          aria-pressed={globeActive}
          aria-label={globeActive ? 'Return to 2D scientific map' : 'Open 3D Mars globe'}
          onClick={onToggleGlobe}
        >
          <Globe className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{globeActive ? '2D Map' : '3D Globe'}</span>
        </Button>
        {!globeActive && <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Toggle mission operations panel"
          onClick={onToggleLeftPanel}
        >
          <PanelLeft />
        </Button>}
        {!globeActive && <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle workspace panel"
          onClick={onToggleRightPanel}
        >
          <PanelRight />
        </Button>}
      </div>
    </header>
  );
}
