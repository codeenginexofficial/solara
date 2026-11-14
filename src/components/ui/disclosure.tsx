/**
 * Disclosure — a small labelled collapse control with inline content.
 * Used to keep lengthy descriptions, technical metadata and provenance out
 * of the primary reading path (Design.md §4 hierarchy, Revision 2).
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DisclosureProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
  contentClassName,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-lg border border-edge/70 bg-surface/30', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-subtle/50 hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          {title}
        </span>
      </button>
      {open && <div className={cn('border-t border-edge/50 px-2.5 py-2.5', contentClassName)}>{children}</div>}
    </div>
  );
}
