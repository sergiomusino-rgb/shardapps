import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tenant-primary/40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-tenant-primary text-white shadow-sm hover:opacity-90 active:opacity-95',
        outline:
          'border border-tenant-border bg-transparent text-tenant-text hover:bg-tenant-card-alt',
        ghost: 'bg-transparent text-tenant-text-secondary hover:bg-tenant-card-alt hover:text-tenant-text',
        soft: 'bg-tenant-primary/10 text-tenant-primary hover:bg-tenant-primary/15',
        destructive: 'bg-tenant-danger/10 text-tenant-danger hover:bg-tenant-danger/20',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9 shrink-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
