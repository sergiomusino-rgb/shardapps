import * as React from 'react';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-[13px] font-semibold text-tenant-text-secondary', className)}
      {...props}
    />
  );
}

export { Label };
