/**
 * Section — a titled panel section header with optional trailing content.
 * Section labels are small and muted (Design.md §4 hierarchy).
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SectionProps {
  title: string;
  /** Small muted text after the title (e.g., a count). */
  hint?: string;
  /** Optional right-aligned content (e.g., a control). */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Section({ title, hint, actions, className, children }: SectionProps) {
  return (
    <section className={cn('border-b border-edge px-3.5 py-3 last:border-b-0', className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-baseline gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          {title}
          {hint && <span className="font-mono text-[10px] font-normal normal-case text-ink-subtle/70">{hint}</span>}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** One labelled row of metadata: muted label left, value right. */
export function DataRow({
  label,
  children,
  mono = false,
  wrap = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-[10px] uppercase tracking-[0.06em] text-ink-subtle">{label}</span>
      <span
        className={cn(
          'text-xs leading-snug text-ink',
          mono && 'font-mono text-[11.5px]',
          wrap ? 'break-words' : 'truncate',
        )}
      >
        {children}
      </span>
    </div>
  );
}
