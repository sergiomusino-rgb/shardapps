'use client';

// ─── Comandi: sidebar di navigazione (stile ZeusX) ─────────────────────────
// Sostituisce la lista tab orizzontale sotto l'header con una sidebar
// verticale fissa, sullo stesso schema di components/layout/Sidebar.tsx (voce
// attiva evidenziata, drawer mobile con backdrop, footer "ZeusX by MUSINO")
// ma con la palette grigio/ambra di Comandi invece di slate/indigo. Il footer
// di branding ZeusX va replicato in tutte le app generate da ZeusX (Comandi
// incluso), non è in conflitto col resto del white-label del modulo.
//
// Due modalità d'uso:
// - Dashboard: `onSelectTab` passato, le voci sono bottoni che cambiano tab
//   in-page (nessuna navigazione, lo stato tab vive nel componente padre).
// - Pagina Agente: `onSelectTab` assente, le voci sono Link verso
//   `${dashboardHref}?tab=...` (navigazione vera verso un'altra pagina).

import Link from 'next/link';
import { Building2, ClipboardList, LogOut, Mic, Package, Users, X } from 'lucide-react';
import ComandiHeaderBrand from './ComandiHeaderBrand';
import { useLanguage } from '@/src/lib/LanguageContext';
import type { Tab } from './ComandiInstanceDashboard';

const TAB_ICON: Record<Tab, React.ReactNode> = {
  catalog: <Package className="w-[18px] h-[18px]" />,
  customers: <Users className="w-[18px] h-[18px]" />,
  orders: <ClipboardList className="w-[18px] h-[18px]" />,
  company: <Building2 className="w-[18px] h-[18px]" />,
};

export interface ComandiSidebarProps {
  visibleTabs: Tab[];
  tabLabel: (tab: Tab) => string;
  activeTab: Tab | null;
  onSelectTab?: (tab: Tab) => void;
  dashboardHref: string;
  agentHref: string;
  agentLabel: string;
  showAgentEntry: boolean;
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
  visibleTabs,
  tabLabel,
  activeTab,
  onSelectTab,
  dashboardHref,
  agentHref,
  agentLabel,
  showAgentEntry,
  isOnAgentPage = false,
  onLogout,
  logoutLabel,
  onClose,
}: ComandiSidebarProps) {
  const { t } = useLanguage();

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
          const agentEntry = showAgentEntry && (
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
          // per registrare nuovi ordini, prima ancora del catalogo.
          return (
            <>
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
          <img src="/favicon.png" alt="ZeusX" className="h-14 w-14 rounded-full object-cover" />
          <p className="text-xs font-semibold text-gray-400">{t('sidebar_by')}</p>
        </div>
      </div>
    </aside>
  );
}
