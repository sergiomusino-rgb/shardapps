'use client';

// ─── Comandi: sidebar di navigazione (stile ShardApps) ─────────────────────────
// Sostituisce la lista tab orizzontale sotto l'header con una sidebar
// verticale fissa, sullo stesso schema di components/layout/Sidebar.tsx (voce
// attiva evidenziata, drawer mobile con backdrop, footer "ShardApps by MUSINO")
// ma con la palette grigio/ambra di Comandi invece di slate/indigo. Il footer
// di branding ShardApps va replicato in tutte le app generate da ShardApps (Comandi
// incluso), non è in conflitto col resto del white-label del modulo.
//
// Due modalità d'uso:
// - Dashboard: `onSelectTab` passato, le voci sono bottoni che cambiano tab
//   in-page (nessuna navigazione, lo stato tab vive nel componente padre).
// - Pagina Agente: `onSelectTab` assente, le voci sono Link verso
//   `${dashboardHref}?tab=...` (navigazione vera verso un'altra pagina).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ClipboardList, KeyRound, LogOut, Mic, Package, Receipt, UserCog, Users, Warehouse, X } from 'lucide-react';
import ComandiHeaderBrand from './ComandiHeaderBrand';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';
import type { Tab } from './ComandiInstanceDashboard';

const TAB_ICON: Record<Tab, React.ReactNode> = {
  catalog: <Package className="w-[18px] h-[18px]" />,
  warehouse: <Warehouse className="w-[18px] h-[18px]" />,
  customers: <Users className="w-[18px] h-[18px]" />,
  orders: <ClipboardList className="w-[18px] h-[18px]" />,
  my_orders: <ClipboardList className="w-[18px] h-[18px]" />,
  invoices: <Receipt className="w-[18px] h-[18px]" />,
  agents: <UserCog className="w-[18px] h-[18px]" />,
  company: <Building2 className="w-[18px] h-[18px]" />,
  access: <KeyRound className="w-[18px] h-[18px]" />,
};

export interface ComandiSidebarProps {
  tenantId: string;
  visibleTabs: Tab[];
  tabLabel: (tab: Tab) => string;
  activeTab: Tab | null;
  onSelectTab?: (tab: Tab) => void;
  dashboardHref: string;
  agentHref: string;
  agentLabel: string;
  isOnAgentPage?: boolean;
  onLogout?: () => void;
  logoutLabel?: string;
  onClose?: () => void;
}

function itemClassName(active: boolean): string {
  return `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
    active
      ? 'border border-amber-500/30 bg-amber-500/10 text-amber-400'
      : 'border border-transparent text-gray-400 hover:bg-gray-800/50 hover:text-white'
  }`;
}

export default function ComandiSidebar({
  tenantId,
  visibleTabs,
  tabLabel,
  activeTab,
  onSelectTab,
  dashboardHref,
  agentHref,
  agentLabel,
  isOnAgentPage = false,
  onLogout,
  logoutLabel,
  onClose,
}: ComandiSidebarProps) {
  const { t } = useLanguage();

  // Logo aziendale caricato in Azienda (tenants.logo_url): mostrato in cima
  // all'elenco, sopra "Modalità Agente", solo quando l'azienda ne ha
  // caricato uno — altrimenti la sidebar resta invariata.
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Cast necessario: 'logo_url' (migrazione 20260808000010) non è
      // ancora presente nel tipo Database generato.
      const { data } = await (supabase as any)
        .from('tenants')
        .select('logo_url')
        .eq('id', tenantId)
        .single();
      if (!cancelled) setCompanyLogoUrl((data as { logo_url?: string } | null)?.logo_url || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-800 bg-gray-900">
      <div className="flex h-16 items-center justify-between border-b border-gray-800/60 px-5">
        <ComandiHeaderBrand />
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white md:hidden"
            aria-label="Chiudi menu"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {(() => {
          // Sempre presente, per ogni ruolo: è il punto d'ingresso per
          // registrare nuovi ordini, e deve restare raggiungibile anche
          // quando un agente naviga su Catalogo/Clienti/Accesso dalla
          // Dashboard, non solo dalla pagina Agente stessa.
          const agentEntry = (
            <Link key="agente" href={agentHref} className={itemClassName(isOnAgentPage)}>
              <span className="flex-shrink-0">
                <Mic className="w-[18px] h-[18px]" />
              </span>
              <span className="truncate">{agentLabel}</span>
            </Link>
          );

          const tabItems = visibleTabs.map((tabKey) => {
            const active = activeTab === tabKey;
            const content = (
              <>
                <span className="flex-shrink-0">{TAB_ICON[tabKey]}</span>
                <span className="truncate">{tabLabel(tabKey)}</span>
              </>
            );
            return onSelectTab ? (
              <button key={tabKey} type="button" onClick={() => onSelectTab(tabKey)} className={`w-full ${itemClassName(active)}`}>
                {content}
              </button>
            ) : (
              <Link key={tabKey} href={`${dashboardHref}?tab=${tabKey}`} className={itemClassName(active)}>
                {content}
              </Link>
            );
          });

          // "Modalità Agente" apre in cima all'elenco: è il punto d'ingresso
          // per registrare nuovi ordini, prima ancora del catalogo. Il logo
          // aziendale, quando presente, va sopra anche a questa voce.
          return (
            <>
              {companyLogoUrl && (
                <div className="flex justify-center pb-2 mb-1 border-b border-gray-800/60">
                  <img
                    src={companyLogoUrl}
                    alt=""
                    className="h-12 w-auto max-w-full rounded-lg object-contain"
                  />
                </div>
              )}
              {agentEntry}
              {tabItems}
            </>
          );
        })()}
      </nav>

      {onLogout && (
        <div className="border-t border-gray-800/60 p-3">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800/50 hover:text-red-400"
          >
            <LogOut className="w-[18px] h-[18px]" />
            {logoutLabel}
          </button>
        </div>
      )}

      <div className="border-t border-gray-800/60 bg-gray-950/40 p-4">
        <div className="flex flex-col items-center gap-2">
          <img src="/favicon.png" alt="ShardApps" className="h-14 w-14 rounded-full object-cover" />
          <p className="text-xs font-semibold text-gray-400">{t('sidebar_by')}</p>
        </div>
      </div>
    </aside>
  );
}
