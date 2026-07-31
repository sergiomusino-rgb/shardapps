'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FullscreenToggle from '@/components/FullscreenToggle';
import HeaderClock from '@/components/HeaderClock';

interface AppTopBarProps {
  title: string;
  onMenuToggle: () => void;
  showMenuToggle: boolean;
  /** Slot extra renderizzato prima del fullscreen toggle. */
  extraActions?: ReactNode;
}

/**
 * Barra superiore dell'app generata: toggle sidebar mobile a sinistra, nome
 * azienda centrato, ora/data e toggle schermo intero a destra. Condivisa da
 * tutti i layout (generico "saas" e quelli di settore in
 * DynamicLayoutRenderer) per un unico design system.
 */
export default function AppTopBar({ title, onMenuToggle, showMenuToggle, extraActions }: AppTopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-tenant-border bg-tenant-card px-4 sm:px-6">
      <div className="flex flex-1 items-center gap-2">
        {showMenuToggle && (
          <Button variant="ghost" size="icon" onClick={onMenuToggle} aria-label="Apri menu">
            <Menu size={20} />
          </Button>
        )}
      </div>

      <h1 className="min-w-0 max-w-[55%] shrink truncate text-center text-base font-bold text-tenant-text sm:text-lg">
        {title}
      </h1>

      <div className="flex flex-1 items-center justify-end gap-3">
        <HeaderClock textColor="var(--tenant-text)" mutedColor="var(--tenant-text-secondary)" />
        {extraActions}
        <FullscreenToggle color="var(--tenant-text-secondary)" hoverBackground="var(--tenant-card-alt)" />
      </div>
    </header>
  );
}
