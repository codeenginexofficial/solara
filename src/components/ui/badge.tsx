/**
 * Badge — small status label. Design.md §9: never rely on color alone, so a
 * badge always carries meaningful text.
 */

import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium tracking-wide whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-edge bg-edge/20 text-ink-muted',
        info: 'border-info/35 bg-info/10 text-info',
        ok: 'border-ok/40 bg-ok/10 text-ok',
        warn: 'border-warn/40 bg-warn/10 text-warn',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        accent: 'border-accent/40 bg-accent/10 text-accent',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
