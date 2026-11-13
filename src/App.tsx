import { useState } from 'react';
import HabitatMode from './features/habitat-mode/HabitatMode';
import FieldTabletMode from './features/field-tablet/FieldTabletMode';
import { cn } from './lib/utils';

/**
 * Application root.
 *
 * Habitat Mode (desktop) and Field Tablet Mode (touch-first) are two
 * interfaces over the same mission model, data catalog, and map engine
 * (Context.md §4.4). The mode switch is deliberate — viewport width alone
 * never decides the operating mode (Design.md §6).
 */
export default function App() {
  const [mode, setMode] = useState<'habitat' | 'tablet'>('habitat');

  return (
    <div className="relative h-full min-h-0">
      {mode === 'habitat' ? (
        <HabitatMode />
      ) : (
        <FieldTabletMode onExit={() => setMode('habitat')} />
      )}

      {/* Deliberate operating-mode switch, available in both modes. */}
      <div
        className="absolute bottom-16 left-1/2 z-50 flex -translate-x-1/2 overflow-hidden rounded-full border border-edge bg-panel/95 shadow-xl"
        role="tablist"
        aria-label="Operating mode"
        data-testid="mode-switch"
      >
        {(['habitat', 'tablet'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'px-4 py-2 text-[11px] font-medium transition-colors duration-150',
              mode === m ? 'bg-accent text-surface' : 'text-ink-muted hover:text-ink',
            )}
          >
            {m === 'habitat' ? 'Habitat' : 'Field tablet'}
          </button>
        ))}
      </div>
    </div>
  );
}
