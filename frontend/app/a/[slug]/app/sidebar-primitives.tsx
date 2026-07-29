'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Forma minima di una tabella personalizzata usata solo per il nav della sidebar. */
export interface SidebarCustomTable {
  name: string;
  label: string;
  labelPlural?: string;
}

/**
 * Blocchi presentazionali condivisi dalle sidebar dell'app generata:
 * ViewerSidebar.tsx (layout "saas" generico) e DynamicLayoutRenderer.tsx
 * (layout di settore ecommerce/ristorante/ricette/docs). Nessuna logica —
 * solo lo stesso linguaggio visivo, così l'app ha un unico design system
 * indipendentemente dal settore.
 */

export function NavItem({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="group/nav flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
          active
            ? 'bg-tenant-primary/12 text-tenant-primary'
            : 'text-tenant-sidebar-text/80 hover:bg-tenant-sidebar-hover hover:text-tenant-sidebar-text'
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {trailing}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-tenant-sidebar-text/40">
      {children}
    </div>
  );
}

export function CollapsibleSection({
  icon,
  label,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-2 border-t border-tenant-sidebar-text/10 pt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-tenant-sidebar-text/50 transition-colors hover:bg-tenant-sidebar-hover hover:text-tenant-sidebar-text/80"
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="mt-1 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

export function SidebarLogo({ logoUrl, companyName }: { logoUrl: string; companyName: string }) {
  return (
    <div className="flex items-center justify-center border-b border-tenant-sidebar-text/10 px-5 py-6">
      {logoUrl ? (
        <img src={logoUrl} alt={companyName} className="h-16 w-16 rounded-2xl object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-tenant-primary/15 text-2xl font-bold text-tenant-primary">
          {companyName.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export function SidebarBrandFooter() {
  return (
    <div className="flex items-center justify-center gap-1.5 px-5 py-3">
      <Image
        src="/zeusxapps.jpeg"
        alt="ZeusX"
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 rounded object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <p className="m-0 text-[11px] font-semibold text-tenant-sidebar-text/50">
        ZeusX <span className="font-normal">by</span> <span className="text-tenant-sidebar-text/70">MUSINO</span>
      </p>
    </div>
  );
}
