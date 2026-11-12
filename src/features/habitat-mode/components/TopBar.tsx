/**
 * TopBar — application header: wordmark, region context, operating mode,
 * source connection status, and compact controls (Design.md §5).
 */

import { PanelLeft, PanelRight, Maximize2 } from 'lucide-react';
import type { SourceStatus, CapabilitiesStatus } from '../../../map/mapTypes';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { formatUtcTime } from '../../../lib/format';

/**
 * Labels for the live capabilities verification state. The map itself always
 * renders from the verified snapshot configuration; these labels describe
 * only whether the LIVE document was re-verified successfully — never claim
 * reachability that has not been confirmed.
 */
const STATUS_TEXT: Record<CapabilitiesStatus, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  checking: { label: 'Verifying live source', tone: 'neutral' },
  live: { label: 'Live source verified', tone: 'ok' },
  'schema-changed': { label: 'Live config changed — snapshot in use', tone: 'warn' },
  unavailable: { label: 'Live check failed — snapshot in use', tone: 'warn' },
};

export interface TopBarProps {
  regionLabel: string;
  sourceStatus: SourceStatus;
  onFitRegion: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}

export function TopBar({
  regionLabel,
  sourceStatus,
  onFitRegion,
  onToggleLeftPanel,
  onToggleRightPanel,
}: TopBarProps) {
  const status = STATUS_TEXT[sourceStatus.capabilities];

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-panel px-3">
      {/* Wordmark */}
      <div className="flex items-center gap-2">
        <img src="/solara.svg" alt="" aria-hidden="true" className="size-5" />
        <span className="text-sm font-semibold tracking-[0.18em] text-ink">SOLARA</span>
        <Badge tone="neutral" className="hidden font-mono sm:inline">M0</Badge>
      </div>

      <span className="hidden h-4 w-px bg-edge md:block" aria-hidden="true" />

      {/* Region + mode context */}
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <span className="truncate text-xs text-ink-muted" title={regionLabel}>
          Mars — {regionLabel}
        </span>
        <Badge tone="accent">Habitat Mode</Badge>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Source connection status */}
        <div
          className="hidden min-w-0 items-center gap-2 sm:flex"
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
          <span className="whitespace-nowrap text-[11px] text-ink-muted">{status.label}</span>
          {sourceStatus.lastCheckedAt && (
            <span className="hidden font-mono text-[10px] text-ink-subtle lg:inline">
              {formatUtcTime(sourceStatus.lastCheckedAt)}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Fit view to region"
          title="Fit view to region"
          onClick={onFitRegion}
        >
          <Maximize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Toggle layer panel"
          onClick={onToggleLeftPanel}
        >
          <PanelLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Toggle dataset panel"
          onClick={onToggleRightPanel}
        >
          <PanelRight />
        </Button>
      </div>
    </header>
  );
}
