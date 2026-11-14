/**
 * Switch — accessible toggle (button with role="switch"), shadcn-style
 * visual language without an external dependency.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name announced by screen readers. */
  label: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
        checked ? 'border-accent bg-accent-soft' : 'border-edge bg-edge/50',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block size-3.5 rounded-full shadow transition-transform duration-150',
          checked ? 'translate-x-5 bg-accent' : 'translate-x-0.5 bg-ink-muted',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
