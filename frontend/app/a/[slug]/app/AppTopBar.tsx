'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import FullscreenToggle from '@/components/FullscreenToggle';
import { useAppInfo } from '../AppInfoContext';
import { getSubscriptionStatusInfo } from './subscription-status';

interface AppTopBarProps {
  title: string;
  onMenuToggle: () => void;
  showMenuToggle: boolean;
  /** Slot extra (es. HeaderClock) renderizzato prima del fullscreen toggle. */
  extraActions?: ReactNode;
}

/**
 * Barra superiore dell'app generata: titolo pagina corrente, toggle sidebar
 * mobile, indicatore di stato abbonamento reale (da AppInfoContext, non
 * inventato) e toggle schermo intero esistente. Condivisa da tutti i layout
 * (generico "saas" e quelli di settore in DynamicLayoutRenderer) per un unico
 * design system.
 */
export default function AppTopBar({ title, onMenuToggle, showMenuToggle, extraActions }: AppTopBarProps) {
  const { status, trialEndsAt } = useAppInfo();
  const statusInfo = getSubscriptionStatusInfo(status, trialEndsAt);

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-tenant-border bg-tenant-card px-4 sm:px-6">
      {showMenuToggle && (
        <Button variant="ghost" size="icon" onClick={onMenuToggle} aria-label="Apri menu">
          <Menu size={20} />
        </Button>
      )}

      <h1 className="min-w-0 flex-1 truncate text-base font-bold text-tenant-text sm:text-lg">
        {title}
      </h1>

      {statusInfo && (
        <Badge variant={statusInfo.variant} dot>
          {statusInfo.label}
        </Badge>
      )}

      {extraActions}

      <FullscreenToggle color="var(--tenant-text-secondary)" hoverBackground="var(--tenant-card-alt)" />
    </header>
  );
}
