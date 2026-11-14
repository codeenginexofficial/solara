/**
 * ContextWorkspace — Habitat Mode's right panel: a tabbed, resizable,
 * collapsible workspace holding the Inspector and the Mission Copilot.
 *
 * - Tabs: "Inspector" (location + dataset + route results) and "Copilot".
 *   Both tab contents stay mounted (toggled via the `hidden` attribute) so
 *   LocationPanel's debounced elevation queries keep reporting state for the
 *   Copilot context even while the Copilot tab is active.
 * - Resizing: a pointer/keyboard drag handle on the panel's left edge
 *   (desktop widths only, 320–640 px, default 360 px, double-click resets).
 * - Collapsing: the close button hides the panel entirely; TopBar's panel
 *   toggle reopens it. Below `lg` the panel renders as an overlay drawer.
 */

import {
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { PanelRightClose } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

export type ContextWorkspaceTab = 'inspector' | 'copilot';

export const WORKSPACE_MIN_WIDTH = 320;
export const WORKSPACE_MAX_WIDTH = 640;
export const WORKSPACE_DEFAULT_WIDTH = 360;

const RESIZE_STEP = 16;

function clampWidth(value: number): number {
  return Math.min(WORKSPACE_MAX_WIDTH, Math.max(WORKSPACE_MIN_WIDTH, Math.round(value)));
}

export interface ContextWorkspaceProps {
  open: boolean;
  onClose: () => void;
  tab: ContextWorkspaceTab;
  onTabChange: (tab: ContextWorkspaceTab) => void;
  width: number;
  onWidthChange: (width: number) => void;
  inspector: ReactNode;
  copilot: ReactNode;
}

export function ContextWorkspace({
  open,
  onClose,
  tab,
  onTabChange,
  width,
  onWidthChange,
  inspector,
  copilot,
}: ContextWorkspaceProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // The panel sits on the right: dragging the handle left widens it.
    onWidthChange(clampWidth(drag.startWidth + (drag.startX - event.clientX)));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onWidthChange(clampWidth(width + RESIZE_STEP));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onWidthChange(clampWidth(width - RESIZE_STEP));
    }
  };

  return (
    <aside
      data-testid="context-workspace"
      aria-label="Inspector and Copilot workspace"
      style={{ '--work-w': `${width}px` } as CSSProperties}
      className={cn(
        'absolute inset-y-0 right-0 z-20 flex-col rounded-l-2xl border-l border-edge bg-panel shadow-2xl',
        'w-[22rem] max-w-[calc(100vw-2rem)] lg:static lg:z-auto lg:max-w-none lg:rounded-xl lg:border lg:border-edge lg:shadow-none lg:w-[var(--work-w,22rem)] overflow-hidden',
        open ? 'flex' : 'hidden',
      )}
    >
      {/* Resize handle (desktop widths only), centred on the panel edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace panel"
        aria-valuenow={width}
        aria-valuemin={WORKSPACE_MIN_WIDTH}
        aria-valuemax={WORKSPACE_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={() => onWidthChange(WORKSPACE_DEFAULT_WIDTH)}
        onKeyDown={handleKeyDown}
        className="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors duration-150 hover:bg-accent/40 focus-visible:bg-accent/60 lg:block"
      />

      <header className="flex h-12 shrink-0 items-center justify-between border-b border-edge/60 px-3">
        <div
          role="tablist"
          aria-label="Workspace panel"
          className="flex items-center gap-1 rounded-md border border-edge/60 bg-surface/50 p-1"
        >
          <button
            type="button"
            role="tab"
            id="workspace-tab-inspector"
            aria-selected={tab === 'inspector'}
            aria-controls="workspace-tabpanel-inspector"
            data-testid="workspace-tab-inspector"
            onClick={() => onTabChange('inspector')}
            className={cn(
              'h-7 min-w-[80px] rounded-sm px-3 text-xs font-medium transition-colors duration-[180ms] ease-out',
              tab === 'inspector'
                ? 'bg-elevated text-ink shadow-none'
                : 'text-ink-muted hover:bg-subtle/70 hover:text-ink',
            )}
          >
            Inspector
          </button>
          <button
            type="button"
            role="tab"
            id="workspace-tab-copilot"
            aria-selected={tab === 'copilot'}
            aria-controls="workspace-tabpanel-copilot"
            data-testid="workspace-tab-copilot"
            onClick={() => onTabChange('copilot')}
            className={cn(
              'h-7 min-w-[80px] rounded-sm px-3 text-xs font-medium transition-colors duration-[180ms] ease-out',
              tab === 'copilot'
                ? 'bg-elevated text-ink shadow-none'
                : 'text-ink-muted hover:bg-subtle/70 hover:text-ink',
            )}
          >
            Copilot
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close workspace panel"
          title="Close workspace panel"
          onClick={onClose}
        >
          <PanelRightClose />
        </Button>
      </header>

      {/* Both panels stay mounted so background state (e.g. LocationPanel's
          debounced elevation query) keeps updating the Copilot context. */}
      <div className="relative min-h-0 flex-1">
        <div
          id="workspace-tabpanel-inspector"
          role="tabpanel"
          aria-labelledby="workspace-tab-inspector"
          hidden={tab !== 'inspector'}
          className="absolute inset-0 overflow-y-auto"
        >
          {inspector}
        </div>
        <div
          id="workspace-tabpanel-copilot"
          role="tabpanel"
          aria-labelledby="workspace-tab-copilot"
          hidden={tab !== 'copilot'}
          className="absolute inset-0"
        >
          {copilot}
        </div>
      </div>
    </aside>
  );
}
