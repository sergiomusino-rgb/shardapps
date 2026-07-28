'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
}

/**
 * Overlay + pannello centrato per i modali dell'app generata (record, tabelle
 * personalizzate, AI, impostazioni). Nessun Radix: chiusura su click overlay,
 * stesso pattern già in uso in tutta l'app.
 */
function Dialog({ open, onClose, children, maxWidthClassName = 'max-w-[560px]' }: DialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          'max-h-[85vh] w-full overflow-auto rounded-2xl border border-tenant-border bg-tenant-card p-8 shadow-2xl',
          maxWidthClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h2 className="m-0 text-xl font-bold text-tenant-text">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg p-1 text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
      >
        <X size={20} />
      </button>
    </div>
  );
}

export { Dialog, DialogHeader };
