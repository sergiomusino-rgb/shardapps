'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'left' | 'right';
  widthClassName?: string;
  children: React.ReactNode;
}

/**
 * Off-canvas panel leggero (no Radix): overlay + pannello scorrevole,
 * chiusura su click overlay o Esc, scroll del body bloccato mentre è aperto.
 * Pensato per la sidebar mobile — non un dialog generico.
 */
function Sheet({ open, onOpenChange, side = 'left', widthClassName = 'w-[280px]', children }: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'fixed inset-y-0 z-50 flex flex-col bg-tenant-sidebar-bg shadow-2xl',
          side === 'left' ? 'left-0' : 'right-0',
          widthClassName
        )}
      >
        {children}
      </div>
    </>
  );
}

export { Sheet };
