/**
 * Button — shadcn/ui-style primitive (cva variants), SOLARA styling.
 * Dark instrument look: neutral raised surfaces, teal reserved for the
 * primary accent variant (the single interaction accent).
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-edge bg-panel-raised text-ink hover:border-ink-subtle/50 hover:bg-edge/60',
        accent:
          'border border-accent bg-accent text-surface hover:border-accent-strong hover:bg-accent-strong',
        ghost: 'text-ink-muted hover:bg-edge/40 hover:text-ink',
        outline:
          'border border-edge bg-transparent text-ink hover:border-ink-subtle/50 hover:bg-edge/30',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-[11.5px]',
        icon: 'size-8 p-0',
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
