/**
 * Button — shadcn/ui-style primitive (cva variants), SOLARA styling.
 * Flat monochrome surfaces: the accent variant is the highest-contrast
 * element (white fill, near-black text) so primary actions stand out by
 * contrast rather than color; default/outline use restrained dark surfaces
 * with clear borders; ghost is quiet. No shadows or depth effects.
 * Radius: 12px on all buttons (including icon buttons).
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-[160ms] ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-edge bg-elevated text-ink hover:border-ink-subtle/60 hover:bg-subtle',
        accent:
          'border border-accent bg-accent font-medium text-surface hover:border-accent-hover hover:bg-accent-hover',
        ghost: 'text-ink-muted hover:bg-subtle hover:text-ink',
        outline:
          'border border-edge bg-panel-raised/60 text-ink hover:border-ink-subtle/60 hover:bg-subtle',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        icon: 'size-9 p-0 rounded-md [&_svg]:size-4',
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
