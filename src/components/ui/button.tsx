/**
 * Button — shadcn/ui-style primitive (cva variants), SOLARA styling.
 * Clear interaction hierarchy: the accent variant is a visible crimson fill
 * with dark readable text (primary actions); default/outline use restrained
 * charcoal surfaces with clear borders; ghost is quiet. Radius system:
 * 10px standard buttons, 8px icon buttons.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-edge bg-elevated text-ink hover:border-ink-subtle/60 hover:bg-subtle',
        accent:
          'border border-accent bg-accent font-semibold text-surface hover:border-accent-hover hover:bg-accent-hover',
        ghost: 'text-ink-muted hover:bg-subtle hover:text-ink',
        outline:
          'border border-edge bg-panel-raised/60 text-ink hover:border-ink-subtle/60 hover:bg-subtle',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        icon: 'size-9 p-0 rounded-sm [&_svg]:size-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
