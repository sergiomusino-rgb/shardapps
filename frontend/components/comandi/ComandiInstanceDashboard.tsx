'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import ComandiHeaderBrand from './ComandiHeaderBrand';
import ComandiSidebar from './ComandiSidebar';
import HeaderClock from '@/components/HeaderClock';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ChevronDown,
  CreditCard,
  Download,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  QrCode,
  ShieldAlert,
  Minus,
  Trash2,
  UploadCloud,
  UserCog,
  Volume2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';
import { setupTenantAction } from '@/app/actions/comandi-tenant';
import { updateOrderStatusAction, getOrderAudioSignedUrlAction } from '@/app/actions/comandi-orders';
import { listAgentsAction, createAgentAction, regenerateAgentPasswordAction, deleteAgentAction, type AgentRecord } from '@/app/actions/comandi-agents';
import {
  listInvoicesAction,
  createInvoiceAction,
  updateInvoiceStatusAction,
  getInvoiceAction,
  type InvoiceRecord,
  type InvoiceStato,
  type InvoiceTipo,
} from '@/app/actions/comandi-invoices';
import { downloadInvoicePdf, PDF_LAYOUTS, type PdfLayoutMeta } from '@/app/a/[slug]/fatture/pdfTemplates';
import { useComandiRole } from '@/src/lib/useComandiRole';
import { usePwaSetup } from '@/hooks/usePwaSetup';
import { COMANDI_PWA_THEME_COLOR, COMANDI_PWA_APPLE_TOUCH_ICON, COMANDI_PWA_APP_NAME } from '@/src/lib/comandi-pwa';
import InstallAppBanner from '@/components/InstallAppBanner';
import InstallAppCard from '@/components/comandi/InstallAppCard';
import { useAppInfo } from '@/app/a/[slug]/AppInfoContext';
import { daysRemaining } from '@/app/a/[slug]/app/subscription-status';
import type { CatalogItem, Customer, Order, OrderStatus, ProductSynonym, TenantMemberRole } from '@/types/comandi';

// Esportati per riuso nella pagina Agente (app/a/[slug]/app/agente), che
// mostra la stessa lista tab sotto l'header per coerenza di navigazione con
// il resto di Comandi, pur non gestendo lei stessa il contenuto delle tab
// (i link puntano alla Dashboard con ?tab=...).
export type Tab = 'catalog' | 'warehouse' | 'customers' | 'company' | 'orders' | 'agents' | 'invoices' | 'access';

// Tab visibili per ruolo:
// - 'agent': solo catalogo (sola lettura) e clienti — niente dati aziendali,
//   incassi, documenti fiscali, o gestione di altri agenti, come da
//   requisito RBAC del ruolo.
// - 'owner'/'admin': tutto, inclusa 'agents' (creazione/gestione dei
//   rappresentanti sul campo con accesso ridotto — un'azione amministrativa,
//   non deve essere visibile a un account operativo generico 'member').
// - 'member' (es. cassa): tutto tranne 'agents' — emettere fatture/ricevute
//   è un'attività operativa quotidiana, non riservata a owner/admin.
export const ALL_TABS: Tab[] = ['catalog', 'warehouse', 'customers', 'orders', 'invoices', 'agents', 'company', 'access'];
export const MEMBER_TABS: Tab[] = ['catalog', 'warehouse', 'customers', 'orders', 'invoices', 'company', 'access'];
// 'access' (account personale, condivisione app, installazione PWA): a
// differenza di 'company', non contiene dati aziendali/di fatturazione,
// quindi è l'unica voce oltre a catalogo/clienti data anche al ruolo agente.
export const AGENT_TABS: Tab[] = ['catalog', 'customers', 'access'];

export interface ComandiInstanceDashboardProps {
  slug: string;
  tenantId: string;
}

function formatCurrency(value: number): string {
  return `€ ${value.toFixed(2)}`;
}

// ─── Nudge trial (banner non bloccante) ─────────────────────────────────────
// Il paywall bloccante per trial scaduto (TrialPaywallModal) scatta già a
// monte in app/a/[slug]/layout.tsx per QUALUNQUE app_type, Comandi incluso —
// non va duplicato qui. Questo banner copre invece il caso non ancora
// coperto: il promemoria discreto durante un trial ancora attivo, con
// styling coerente col resto di Comandi (ambra/grigio) invece del gradiente
// ZeusX generico, per restare in linea con l'isolamento white-label del
// modulo (vedi commento nella diramazione comandi_ai di layout.tsx).
export function TrialNudgeBanner({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const appInfo = useAppInfo();
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (appInfo.status !== 'trial' || !appInfo.trialEndsAt) return null;

  const days = daysRemaining(appInfo.trialEndsAt);

  const handleSubscribe = async () => {
    setSubscribing(true);
    setError(null);
    try {
      const res = await fetch(`/api/a/${slug}/create-checkout-session`, { method: 'POST' });
      const data = await res.json().catch(() => ({ error: t('comandi_dashboard_trial_error_generic') }));
      if (!res.ok || !data.url) {
        setError(data.error || t('comandi_dashboard_trial_error_generic'));
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error('[TrialNudgeBanner] Errore avvio checkout:', err);
      setError(t('comandi_dashboard_trial_error_generic'));
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="border-b border-amber-700/40 bg-amber-900/20">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-200">
          {t('comandi_dashboard_trial_banner_label').replace('{days}', String(days))}
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs text-red-300">{error}</span>}
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={subscribing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
          >
            {subscribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {t('comandi_dashboard_trial_subscribe_button').replace('{price}', appInfo.clientPrice.toFixed(2))}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ComandiInstanceDashboard({ slug, tenantId }: ComandiInstanceDashboardProps) {
  const { t } = useLanguage();
  const router = useRouter();
  usePwaSetup(slug, COMANDI_PWA_THEME_COLOR, COMANDI_PWA_APPLE_TOUCH_ICON, COMANDI_PWA_APP_NAME);
  const { role } = useComandiRole(tenantId);
  const isAgent = role === 'agent';
  const canManageAgents = role === 'owner' || role === 'admin';
  const visibleTabs = isAgent ? AGENT_TABS : canManageAgents ? ALL_TABS : MEMBER_TABS;

  const [tab, setTab] = useState<Tab>('catalog');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Deep-link dal pulsante "Nuovo Cliente" in Modalità Agente
  // (/dashboard?tab=customers&new=1): apre subito la scheda cliente vuota
  // invece di lasciare l'utente sulla sola tabella.
  const [openCustomerFormOnLoad, setOpenCustomerFormOnLoad] = useState(false);

  // Deep-link diretto a una tab (es. dalla lista tab della pagina Agente, che
  // punta a /dashboard?tab=customers): letto da window.location invece di
  // useSearchParams per evitare il vincolo di Suspense boundary, come da
  // convenzione già in uso in app/a/[slug]/layout.tsx.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab') as Tab | null;
    if (requestedTab && ALL_TABS.includes(requestedTab)) setTab(requestedTab);
    if (params.get('new') === '1') setOpenCustomerFormOnLoad(true);
  }, []);

  // Un agente non deve mai restare su un tab non autorizzato: se il ruolo
  // viene risolto dopo il mount (fetch async) e il tab corrente non è più
  // nell'elenco visibile, riporta forzatamente su 'catalog'.
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab('catalog');
  }, [visibleTabs, tab]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push(`/a/${slug}`);
  };

  const handleSelectTab = (nextTab: Tab) => {
    setTab(nextTab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-white">
      {/* Sidebar desktop */}
      <div className="hidden md:block">
        <ComandiSidebar
          tenantId={tenantId}
          visibleTabs={visibleTabs}
          tabLabel={(key) => t(`comandi_dashboard_tab_${key}`)}
          activeTab={tab}
          onSelectTab={handleSelectTab}
          dashboardHref={`/a/${slug}/dashboard`}
          agentHref={`/a/${slug}/app/agente`}
          agentLabel={t('comandi_dashboard_go_to_console')}
          onLogout={handleLogout}
          logoutLabel={t('comandi_dashboard_logout')}
        />
      </div>

      {/* Sidebar mobile (drawer) */}
      <div className="md:hidden">
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-200 ${
            mobileMenuOpen ? 'bg-black/60 backdrop-blur-sm opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ComandiSidebar
            tenantId={tenantId}
            visibleTabs={visibleTabs}
            tabLabel={(key) => t(`comandi_dashboard_tab_${key}`)}
            activeTab={tab}
            onSelectTab={handleSelectTab}
            dashboardHref={`/a/${slug}/dashboard`}
            agentHref={`/a/${slug}/app/agente`}
            agentLabel={t('comandi_dashboard_go_to_console')}
              onLogout={handleLogout}
            logoutLabel={t('comandi_dashboard_logout')}
            onClose={() => setMobileMenuOpen(false)}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <TrialNudgeBanner slug={slug} />

        <header className="flex h-16 items-center justify-between gap-3 border-b border-gray-800 bg-gray-900/60 px-4 md:justify-end md:px-6">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white md:hidden"
            aria-label="Apri menu"
          >
            <Menu size={22} />
          </button>
          <div className="md:hidden">
            <ComandiHeaderBrand />
          </div>
          <div className="flex items-center gap-3">
            <HeaderClock textColor="#e5e7eb" mutedColor="#6b7280" />
            <LanguageSelector />
            <FullscreenToggle color="#e5e7eb" hoverBackground="rgba(107,114,128,0.2)" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
          {isAgent && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/50 bg-amber-900/20 p-4">
              <div className="flex items-start gap-2 text-sm text-amber-300">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t('comandi_dashboard_agent_restricted_banner')}</span>
              </div>
              <Link
                href={`/a/${slug}/app/agente`}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                {t('comandi_dashboard_agent_go_to_orders')}
              </Link>
            </div>
          )}
          {tab === 'catalog' && <CatalogTab tenantId={tenantId} readOnly={isAgent} role={role} />}
          {tab === 'warehouse' && !isAgent && <WarehouseTab tenantId={tenantId} />}
          {tab === 'customers' && <CustomersTab tenantId={tenantId} openNewOnMount={openCustomerFormOnLoad} />}
          {tab === 'company' && !isAgent && <CompanyTab tenantId={tenantId} slug={slug} />}
          {tab === 'orders' && !isAgent && <OrdersTab tenantId={tenantId} />}
          {tab === 'invoices' && !isAgent && <InvoicesTab />}
          {tab === 'agents' && canManageAgents && <AgentsTab tenantId={tenantId} slug={slug} />}
          {tab === 'access' && <AccessTab tenantId={tenantId} />}
        </main>
      </div>

      <InstallAppBanner
        appName={COMANDI_PWA_APP_NAME}
        slug={slug}
        primaryColor={COMANDI_PWA_THEME_COLOR}
        textColor="#ffffff"
        surfaceColor="#111827"
        borderColor="#1f2937"
      />
    </div>
  );
}

// ─── Semaforo disponibilità (stock_qty) ────────────────────────────────────
// Condiviso tra Catalogo e Magazzino: entrambi leggono/scrivono lo stesso
// campo catalog_items.stock_qty, quindi lo stesso criterio di colore deve
// valere in entrambe le viste.

type StockStatus = 'available' | 'low' | 'out';

const LOW_STOCK_DEFAULT_THRESHOLD = 5;

function stockStatus(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return 'out';
  if (qty <= threshold) return 'low';
  return 'available';
}

const STOCK_STATUS_DOT: Record<StockStatus, string> = {
  available: 'bg-green-500',
  low: 'bg-amber-500',
  out: 'bg-red-500',
};

// Badge pieno (bordo + sfondo tenue + testo colorato), più visibile del solo
// pallino nelle liste dense come il Catalogo.
const STOCK_STATUS_BADGE: Record<StockStatus, string> = {
  available: 'border-green-500/40 bg-green-500/15 text-green-400',
  low: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  out: 'border-red-500/40 bg-red-500/15 text-red-400',
};

// ─── Tab Catalogo ───────────────────────────────────────────────────────────

interface EditableCatalogItem extends CatalogItem {
  synonyms: ProductSynonym[];
  newSynonym: string;
}

const EMPTY_NEW_ITEM = { sku: '', name: '', unit_price: '', unit_of_measure: 'pz', stock_qty: '' };

interface CatalogImportResult {
  importedCount: number;
  skippedCount: number;
  totalRows: number;
  errors: { row: number; error: string }[];
}

const IMPORT_TEMPLATE_HEADERS = ['code', 'name', 'category', 'price', 'unit'];
const IMPORT_TEMPLATE_EXAMPLE_ROW = ['ART001', 'Acqua naturale 50cl', 'Bevande', '1.20', 'pz'];

function CatalogTab({
  tenantId,
  readOnly = false,
  role,
}: {
  tenantId: string;
  readOnly?: boolean;
  role?: TenantMemberRole | null;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<EditableCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(EMPTY_NEW_ITEM);
  const [isAdding, setIsAdding] = useState(false);

  // Import massivo: solo owner/admin (stesso controllo, difeso anche lato
  // server in app/api/catalog/import/route.ts — questo è solo per non
  // mostrare in UI un'azione che verrebbe comunque rifiutata).
  const canImport = role === 'owner' || role === 'admin';
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<CatalogImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDraggingImport, setIsDraggingImport] = useState(false);
  const [showImportErrors, setShowImportErrors] = useState(false);
  // Espansione per-prodotto della sezione "Altri campi" (extra_fields):
  // chiusa di default per non appesantire la lista, l'utente la apre solo
  // sui prodotti che gli interessano.
  const [expandedExtraFields, setExpandedExtraFields] = useState<Set<string>>(new Set());
  const toggleExtraFields = (itemId: string) => {
    setExpandedExtraFields((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: catalogRows, error: catalogError } = await supabase
        .from('catalog_items' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name');

      if (catalogError) throw catalogError;

      const rows = (catalogRows || []) as unknown as CatalogItem[];
      const ids = rows.map((r) => r.id);
      let synonymRows: ProductSynonym[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('product_synonyms' as any)
          .select('*')
          .in('product_id', ids);
        synonymRows = (data || []) as unknown as ProductSynonym[];
      }

      setItems(
        rows.map((r) => ({
          ...r,
          synonyms: synonymRows.filter((s) => s.product_id === r.id),
          newSynonym: '',
        }))
      );
    } catch (err) {
      console.error('[CatalogTab] Errore caricamento catalogo:', err);
      setError(t('comandi_dashboard_catalog_error_generic'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // ── Import massivo da file Excel/CSV ─────────────────────────────────────
  const handleDownloadTemplate = useCallback(() => {
    // CSV generato lato client (nessuna dipendenza da 'xlsx' nel bundle
    // browser, tenuto solo lato server): si apre correttamente sia in Excel
    // sia in fogli di calcolo compatibili, con le stesse colonne attese
    // dalla rotta di import.
    const csvLines = [IMPORT_TEMPLATE_HEADERS.join(','), IMPORT_TEMPLATE_EXAMPLE_ROW.join(',')];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-catalogo.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportError(null);
      setImportResult(null);
      setShowImportErrors(false);
      setImporting(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setImportError(t('comandi_dashboard_catalog_import_error_session'));
          return;
        }

        const form = new FormData();
        form.append('file', file);

        const res = await fetch('/api/catalog/import', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        const json = await res.json().catch(() => ({ success: false, error: t('comandi_dashboard_catalog_import_error_generic') }));

        if (!res.ok || !json.success) {
          setImportError(json.error || t('comandi_dashboard_catalog_import_error_generic'));
          return;
        }

        setImportResult(json.data as CatalogImportResult);
        if ((json.data as CatalogImportResult).importedCount > 0) {
          await loadCatalog();
        }
      } catch (err) {
        console.error('[CatalogTab] Errore import catalogo:', err);
        setImportError(t('comandi_dashboard_catalog_import_error_generic'));
      } finally {
        setImporting(false);
        if (importFileInputRef.current) importFileInputRef.current.value = '';
      }
    },
    [loadCatalog, t]
  );

  const handleAddItem = async () => {
    if (!newItem.sku.trim() || !newItem.name.trim()) return;
    setIsAdding(true);
    setError(null);
    try {
      const { error: insertError } = await (supabase as any).from('catalog_items').insert({
        tenant_id: tenantId,
        sku: newItem.sku.trim(),
        name: newItem.name.trim(),
        unit_price: parseFloat(newItem.unit_price) || 0,
        unit_of_measure: newItem.unit_of_measure.trim() || 'pz',
        stock_qty: parseFloat(newItem.stock_qty) || 0,
        is_active: true,
      });
      if (insertError) throw insertError;
      setNewItem(EMPTY_NEW_ITEM);
      await loadCatalog();
    } catch (err) {
      console.error('[CatalogTab] Errore aggiunta prodotto:', err);
      setError(t('comandi_dashboard_catalog_error_generic'));
    } finally {
      setIsAdding(false);
    }
  };

  const updateItemField = async (id: string, field: keyof CatalogItem, value: unknown) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
    const { error: updateError } = await (supabase as any)
      .from('catalog_items')
      .update({ [field]: value })
      .eq('id', id);
    if (updateError) {
      console.error('[CatalogTab] Errore aggiornamento prodotto:', updateError);
      setError(t('comandi_dashboard_catalog_error_generic'));
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!window.confirm(t('comandi_dashboard_catalog_delete_confirm'))) return;
    const { error: deleteError } = await supabase.from('catalog_items' as any).delete().eq('id', id);
    if (deleteError) {
      console.error('[CatalogTab] Errore eliminazione prodotto:', deleteError);
      setError(t('comandi_dashboard_catalog_error_generic'));
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleAddSynonym = async (itemId: string, alias: string) => {
    if (!alias.trim()) return;
    const { data, error: insertError } = await (supabase as any)
      .from('product_synonyms')
      .insert({ tenant_id: tenantId, product_id: itemId, spoken_alias: alias.trim() })
      .select('*')
      .single();
    if (insertError || !data) {
      console.error('[CatalogTab] Errore aggiunta sinonimo:', insertError);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, synonyms: [...i.synonyms, data as ProductSynonym], newSynonym: '' } : i
      )
    );
  };

  const handleRemoveSynonym = async (itemId: string, synonymId: string) => {
    const { error: deleteError } = await supabase.from('product_synonyms' as any).delete().eq('id', synonymId);
    if (deleteError) {
      console.error('[CatalogTab] Errore rimozione sinonimo:', deleteError);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, synonyms: i.synonyms.filter((s) => s.id !== synonymId) } : i))
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Import massivo catalogo: solo owner/admin */}
      {canImport && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {t('comandi_dashboard_catalog_import_title')}
            </p>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300"
            >
              <Download className="w-3.5 h-3.5" />
              {t('comandi_dashboard_catalog_import_template_button')}
            </button>
          </div>

          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />

          <button
            type="button"
            onClick={() => importFileInputRef.current?.click()}
            disabled={importing}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingImport(true); }}
            onDragLeave={() => setIsDraggingImport(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingImport(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleImportFile(file);
            }}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isDraggingImport
                ? 'border-amber-500 bg-amber-500/5'
                : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/40'
            }`}
          >
            {importing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-sm font-medium text-gray-300">{t('comandi_dashboard_catalog_import_uploading')}</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-6 h-6 text-gray-500" />
                <span className="text-sm font-semibold text-gray-300">{t('comandi_dashboard_catalog_import_dropzone_label')}</span>
                <span className="text-xs text-gray-500">{t('comandi_dashboard_catalog_import_dropzone_hint')}</span>
              </>
            )}
          </button>

          {importError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {importResult && (
            <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
              <p className="text-sm text-gray-200">
                {t('comandi_dashboard_catalog_import_result_summary')
                  .replace('{imported}', String(importResult.importedCount))
                  .replace('{total}', String(importResult.totalRows))}
              </p>
              {importResult.errors.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowImportErrors((v) => !v)}
                    className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"
                  >
                    {t('comandi_dashboard_catalog_import_errors_toggle').replace('{count}', String(importResult.errors.length))}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showImportErrors ? 'rotate-180' : ''}`} />
                  </button>
                  {showImportErrors && (
                    <ul className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                      {importResult.errors.map((rowError, i) => (
                        <li key={i} className="text-xs text-gray-400">
                          {rowError.row > 0
                            ? t('comandi_dashboard_catalog_import_error_row').replace('{row}', String(rowError.row))
                            : ''}
                          {' '}{rowError.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aggiungi prodotto: non disponibile in sola lettura (ruolo agente) */}
      {!readOnly && (
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
          {t('comandi_dashboard_catalog_add_title')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input
            value={newItem.sku}
            onChange={(e) => setNewItem((v) => ({ ...v, sku: e.target.value }))}
            placeholder="SKU"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 col-span-1"
          />
          <input
            value={newItem.name}
            onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))}
            placeholder={t('comandi_dashboard_catalog_col_name')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 col-span-2 sm:col-span-1"
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">€</span>
            <input
              type="number"
              step="0.01"
              value={newItem.unit_price}
              onChange={(e) => setNewItem((v) => ({ ...v, unit_price: e.target.value }))}
              placeholder={t('comandi_dashboard_catalog_col_price')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-6 pr-3 py-2 text-sm text-white placeholder:text-gray-500"
            />
          </div>
          <input
            value={newItem.unit_of_measure}
            onChange={(e) => setNewItem((v) => ({ ...v, unit_of_measure: e.target.value }))}
            placeholder={t('comandi_dashboard_catalog_col_unit')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <input
            type="number"
            step="0.01"
            value={newItem.stock_qty}
            onChange={(e) => setNewItem((v) => ({ ...v, stock_qty: e.target.value }))}
            placeholder={t('comandi_dashboard_catalog_col_stock')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={handleAddItem}
          disabled={isAdding || !newItem.sku.trim() || !newItem.name.trim()}
          className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('comandi_dashboard_catalog_add_button')}
        </button>
      </div>
      )}

      {/* Lista prodotti */}
      {loading ? (
        <p className="text-sm text-gray-500">…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('comandi_dashboard_catalog_empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-center">
                <span className="text-xs font-mono text-gray-500 col-span-2 sm:col-span-1">{item.sku}</span>
                <input
                  value={item.name}
                  onChange={(e) => updateItemField(item.id, 'name', e.target.value)}
                  disabled={readOnly}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white col-span-2 sm:col-span-1 disabled:opacity-70 disabled:cursor-not-allowed"
                />
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">€</span>
                  <input
                    type="number"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(e) => updateItemField(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                    disabled={readOnly}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-5 pr-2 py-1.5 text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                </div>
                <input
                  value={item.unit_of_measure}
                  onChange={(e) => updateItemField(item.id, 'unit_of_measure', e.target.value)}
                  disabled={readOnly}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
                {/* Semaforo disponibilità: stesso criterio e stesso campo
                    (stock_qty) della tab Magazzino, sola lettura qui — la
                    quantità si modifica dal Magazzino per non duplicare
                    l'azione in due schermate diverse. */}
                {(() => {
                  const status = stockStatus(item.stock_qty, LOW_STOCK_DEFAULT_THRESHOLD);
                  const statusLabel =
                    status === 'available'
                      ? t('comandi_dashboard_warehouse_status_available')
                      : status === 'low'
                        ? t('comandi_dashboard_warehouse_status_low')
                        : t('comandi_dashboard_warehouse_status_out');
                  return (
                    <div
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${STOCK_STATUS_BADGE[status]}`}
                      title={statusLabel}
                    >
                      <span className={`h-3 w-3 rounded-full shrink-0 ${STOCK_STATUS_DOT[status]}`} />
                      {item.stock_qty} {item.unit_of_measure}
                    </div>
                  );
                })()}
                <label className="flex items-center gap-1.5 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={item.is_active}
                    onChange={(e) => updateItemField(item.id, 'is_active', e.target.checked)}
                    disabled={readOnly}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-amber-600 disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                  {t('comandi_dashboard_catalog_col_active')}
                </label>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(item.id)}
                    className="justify-self-end p-1.5 rounded text-gray-500 hover:bg-red-500/15 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-600 mr-1">
                  {t('comandi_dashboard_catalog_col_synonyms')}
                </span>
                {item.synonyms.map((syn) => (
                  <span
                    key={syn.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300"
                  >
                    {syn.spoken_alias}
                    {!readOnly && (
                      <button type="button" onClick={() => handleRemoveSynonym(item.id, syn.id)} className="hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
                {!readOnly && (
                <input
                  value={item.newSynonym}
                  onChange={(e) =>
                    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, newSynonym: e.target.value } : i)))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSynonym(item.id, item.newSynonym);
                    }
                  }}
                  placeholder={t('comandi_dashboard_catalog_add_synonym_placeholder')}
                  className="bg-gray-800 border border-gray-700 rounded-full px-2.5 py-0.5 text-xs text-white placeholder:text-gray-600 w-40"
                />
                )}
              </div>

              {!!item.extra_fields && Object.keys(item.extra_fields).length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleExtraFields(item.id)}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-600 hover:text-gray-400"
                  >
                    {t('comandi_dashboard_catalog_extra_fields_toggle').replace('{count}', String(Object.keys(item.extra_fields).length))}
                    <ChevronDown className={`w-3 h-3 transition-transform ${expandedExtraFields.has(item.id) ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedExtraFields.has(item.id) && (
                    <dl className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(item.extra_fields).map(([key, value]) => (
                        <div key={key} className="flex items-baseline gap-1.5 text-xs">
                          <dt className="text-gray-500 shrink-0">{key}:</dt>
                          <dd className="text-gray-300 truncate">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab Magazzino ──────────────────────────────────────────────────────────
// Stessa tabella catalog_items del Catalogo (nessuna tabella/colonna nuova):
// qui la vista è invertita, il focus è la disponibilità (stock_qty) invece
// dell'anagrafica prodotto, con lo stesso semaforo verde/arancio/rosso
// mostrato nel Catalogo (vedi stockStatus più sopra). Modificare la quantità
// qui aggiorna lo stesso record che il Catalogo mostra nel suo campo
// "Stock" — sono la stessa fonte dati.

function WarehouseTab({ tenantId, readOnly = false }: { tenantId: string; readOnly?: boolean }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | StockStatus>('all');
  const [threshold, setThreshold] = useState(LOW_STOCK_DEFAULT_THRESHOLD);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('catalog_items' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('stock_qty', { ascending: true });
      if (fetchError) throw fetchError;
      setItems((data || []) as unknown as CatalogItem[]);
    } catch (err) {
      console.error('[WarehouseTab] Errore caricamento magazzino:', err);
      setError(t('comandi_dashboard_warehouse_error_generic'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleStockChange = async (id: string, nextQty: number) => {
    const qty = Math.max(0, Math.round(nextQty));
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, stock_qty: qty } : i)));
    const { error: updateError } = await (supabase as any)
      .from('catalog_items')
      .update({ stock_qty: qty })
      .eq('id', id);
    if (updateError) {
      console.error('[WarehouseTab] Errore aggiornamento quantità:', updateError);
      setError(t('comandi_dashboard_warehouse_error_generic'));
    }
  };

  const counts = items.reduce(
    (acc, item) => {
      acc[stockStatus(item.stock_qty, threshold)] += 1;
      return acc;
    },
    { available: 0, low: 0, out: 0 } as Record<StockStatus, number>
  );

  const filteredItems = items.filter((item) => {
    if (filter !== 'all' && stockStatus(item.stock_qty, threshold) !== filter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
  });

  const statusLabel = (status: StockStatus) =>
    status === 'available'
      ? t('comandi_dashboard_warehouse_status_available')
      : status === 'low'
        ? t('comandi_dashboard_warehouse_status_low')
        : t('comandi_dashboard_warehouse_status_out');

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Riepilogo disponibilità */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_dashboard_warehouse_stat_total')}</p>
          <p className="text-2xl font-bold text-white mt-1">{items.length}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {t('comandi_dashboard_warehouse_stat_available')}
          </p>
          <p className="text-2xl font-bold text-green-400 mt-1">{counts.available}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {t('comandi_dashboard_warehouse_stat_low')}
          </p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{counts.low}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {t('comandi_dashboard_warehouse_stat_out')}
          </p>
          <p className="text-2xl font-bold text-red-400 mt-1">{counts.out}</p>
        </div>
      </div>

      {/* Filtri, ricerca e soglia scorta bassa */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('comandi_dashboard_warehouse_search_placeholder')}
            className="flex-1 min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'available', 'low', 'out'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  filter === key
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
                }`}
              >
                {key === 'all'
                  ? t('comandi_dashboard_warehouse_filter_all')
                  : statusLabel(key)}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          {t('comandi_dashboard_warehouse_threshold_label')}
          <input
            type="number"
            min={0}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      {/* Lista disponibilità */}
      {loading ? (
        <p className="text-sm text-gray-500">…</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-gray-500">
          {items.length === 0
            ? t('comandi_dashboard_warehouse_empty')
            : t('comandi_dashboard_warehouse_empty_filtered')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredItems.map((item) => {
            const status = stockStatus(item.stock_qty, threshold);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 items-center"
              >
                <div
                  className={`flex items-center gap-2 col-span-2 sm:col-span-1 rounded-full border px-3 py-1.5 text-xs font-bold w-fit ${STOCK_STATUS_BADGE[status]}`}
                >
                  <span className={`h-3 w-3 rounded-full shrink-0 ${STOCK_STATUS_DOT[status]}`} />
                  {statusLabel(status)}
                </div>
                <span className="text-xs font-mono text-gray-500">{item.sku}</span>
                <span className="text-sm text-white truncate col-span-2 sm:col-span-2">{item.name}</span>
                <div className="flex items-center gap-1.5 justify-self-start sm:justify-self-end col-span-2 sm:col-span-2">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleStockChange(item.id, item.stock_qty - 1)}
                      className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={item.stock_qty <= 0}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={item.stock_qty}
                    onChange={(e) => handleStockChange(item.id, parseFloat(e.target.value) || 0)}
                    disabled={readOnly}
                    className="w-20 text-center bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
                  />
                  <span className="text-xs text-gray-500">{item.unit_of_measure}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleStockChange(item.id, item.stock_qty + 1)}
                      className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab Clienti ────────────────────────────────────────────────────────────
// Rubrica clienti del tenant: scheda in stile "Azienda" (stessi campi
// anagrafici: nome, P.IVA/CF, indirizzo, città, telefono, vedi CompanyTab più
// sotto) per inserire/modificare un cliente, più la tabella di tutti i
// clienti registrati. La stessa scheda serve sia per "Nuovo Cliente" (form
// vuoto) sia per la modifica (click su "Modifica" in tabella la precompila),
// invece di due form separati.

const EMPTY_CUSTOMER_FORM = {
  name: '',
  vat_number: '',
  sdi_code: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  notes: '',
};

function CustomersTab({ tenantId, openNewOnMount = false }: { tenantId: string; openNewOnMount?: boolean }) {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // La scheda cliente è un modale, non una sezione sempre visibile: la vista
  // predefinita del tab è la tabella riassuntiva, la scheda si apre solo dal
  // tasto "Nuovo Cliente" o da "Modifica" su una riga.
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_CUSTOMER_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const { data, error } = await supabase
        .from('customers' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name');
      if (error) throw error;
      setCustomers((data || []) as unknown as Customer[]);
    } catch (err) {
      console.error('[CustomersTab] Errore caricamento clienti:', err);
      setListError(t('comandi_dashboard_customers_error_generic'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_CUSTOMER_FORM);
    setFormError(null);
  }, []);

  const handleOpenNew = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_CUSTOMER_FORM);
    setFormError(null);
    setShowForm(true);
  }, []);

  // Deep-link da Modalità Agente (?tab=customers&new=1, vedi
  // ComandiInstanceDashboard): apre subito la scheda vuota. Il ref evita di
  // riaprirla se l'utente la chiude manualmente durante la sessione.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (openNewOnMount && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      handleOpenNew();
    }
  }, [openNewOnMount, handleOpenNew]);

  const handleEdit = useCallback((customer: Customer) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name || '',
      vat_number: customer.vat_number || '',
      sdi_code: customer.sdi_code || '',
      address: customer.address || '',
      city: customer.city || '',
      phone: customer.phone || '',
      email: customer.email || '',
      notes: customer.notes || '',
    });
    setFormError(null);
    setShowForm(true);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError(t('comandi_dashboard_customers_error_name_required'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name,
        vat_number: form.vat_number.trim() || null,
        sdi_code: form.sdi_code.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await (supabase as any).from('customers').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('customers').insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }

      closeForm();
      await loadCustomers();
    } catch (err) {
      console.error('[CustomersTab] Errore salvataggio cliente:', err);
      setFormError(t('comandi_dashboard_customers_error_generic'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('comandi_dashboard_customers_delete_confirm'))) return;
    const { error } = await supabase.from('customers' as any).delete().eq('id', id);
    if (error) {
      console.error('[CustomersTab] Errore eliminazione cliente:', error);
      setListError(t('comandi_dashboard_customers_error_generic'));
      return;
    }
    if (editingId === id) closeForm();
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('comandi_dashboard_customers_list_title').replace('{count}', String(customers.length))}
        </p>
        <button
          type="button"
          onClick={handleOpenNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('comandi_dashboard_customers_new_button')}
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-5">
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {editingId ? t('comandi_dashboard_customers_form_title_edit') : t('comandi_dashboard_customers_form_title_new')}
                </p>
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('comandi_dashboard_customers_field_name')}
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('comandi_dashboard_customers_field_vat')}
                </label>
                <input
                  value={form.vat_number}
                  onChange={(e) => setForm((v) => ({ ...v, vat_number: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('comandi_dashboard_customers_field_sdi')}
                </label>
                <input
                  value={form.sdi_code}
                  onChange={(e) => setForm((v) => ({ ...v, sdi_code: e.target.value.toUpperCase() }))}
                  placeholder={t('comandi_dashboard_customers_field_sdi_placeholder')}
                  maxLength={7}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t('comandi_dashboard_customers_field_address')}
                  </label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm((v) => ({ ...v, address: e.target.value }))}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t('comandi_dashboard_customers_field_city')}
                  </label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm((v) => ({ ...v, city: e.target.value }))}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t('comandi_dashboard_customers_field_phone')}
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {t('comandi_dashboard_customers_field_email')}
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {t('comandi_dashboard_customers_field_notes')}
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
                />
              </div>

              <button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="self-start flex items-center gap-1.5 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingId ? t('comandi_dashboard_customers_save_button_edit') : t('comandi_dashboard_customers_save_button_new')}
              </button>
            </form>
          </div>
        </div>
      )}

      {listError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">…</p>
      ) : customers.length === 0 ? (
        <p className="text-sm text-gray-500">{t('comandi_dashboard_customers_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800 bg-gray-900/60">
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_vat')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_sdi')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_city')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_phone')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_customers_col_email')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('comandi_dashboard_customers_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-gray-800/60 last:border-b-0">
                  <td className="px-4 py-2.5 text-white">{customer.name}</td>
                  <td className="px-4 py-2.5 text-gray-400">{customer.vat_number || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono">{customer.sdi_code || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400">{customer.city || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400">{customer.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400">{customer.email || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEdit(customer)}
                        title={t('comandi_dashboard_customers_action_edit')}
                        className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(customer.id)}
                        title={t('comandi_dashboard_customers_action_delete')}
                        className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-700 text-gray-500 hover:bg-red-500/15 hover:text-red-400 hover:border-gray-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Azienda ────────────────────────────────────────────────────────────

function CompanyTab({ tenantId, slug }: { tenantId: string; slug: string }) {
  const { t } = useLanguage();
  const [businessName, setBusinessName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      // Cast necessario: 'logo_url' (migrazione 20260808000010) non è
      // ancora presente nel tipo Database generato.
      const { data } = await (supabase as any)
        .from('tenants')
        .select('name, vat_number, address, city, phone, logo_url')
        .eq('id', tenantId)
        .single();
      if (data) {
        const tenant = data as { name?: string; vat_number?: string; address?: string; city?: string; phone?: string; logo_url?: string };
        setBusinessName(tenant.name || '');
        setVatNumber(tenant.vat_number || '');
        setAddress(tenant.address || '');
        setCity(tenant.city || '');
        setPhone(tenant.phone || '');
        setLogoUrl(tenant.logo_url || '');
      }
      setLoading(false);
    })();
  }, [tenantId]);

  // Caricato subito nel bucket pubblico 'vision-uploads' (già usato da ZeusX
  // Vision) al momento della scelta del file: l'URL risultante viene salvato
  // in tenants.logo_url solo quando l'utente preme "Salva dati aziendali",
  // coerente col resto del form (un solo pulsante di salvataggio).
  const handleLogoFile = async (file: File) => {
    setLogoError(null);
    if (!file.type.startsWith('image/')) {
      setLogoError(t('comandi_dashboard_company_logo_error_type'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoError(t('comandi_dashboard_company_logo_error_size'));
      return;
    }
    setUploadingLogo(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLogoError(t('comandi_dashboard_company_error_generic'));
        return;
      }
      const ext = file.name.split('.').pop() || 'png';
      const path = `${user.id}/comandi-logo-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('vision-uploads')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('vision-uploads').getPublicUrl(path);
      setLogoUrl(publicUrlData.publicUrl);
    } catch (err) {
      console.error('[CompanyTab] Errore caricamento logo:', err);
      setLogoError(t('comandi_dashboard_company_logo_error_generic'));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError(t('comandi_dashboard_company_error_generic'));
        return;
      }
      const result = await setupTenantAction({
        businessName: businessName.trim(),
        vatNumber: vatNumber.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        logoUrl: logoUrl || undefined,
        seedDemoCatalog: false,
        accessToken: session.access_token,
      });
      if (!result.success) {
        setError(result.error || t('comandi_dashboard_company_error_generic'));
        return;
      }
      setSaved(true);
    } catch (err) {
      console.error('[CompanyTab] Errore salvataggio:', err);
      setError(t('comandi_dashboard_company_error_generic'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">…</p>;

  return (
    <div className="flex flex-col gap-6 max-w-lg">
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="flex items-start gap-2 rounded-lg border border-green-700/50 bg-green-900/20 p-3 text-sm text-green-300">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('comandi_dashboard_company_save_success')}</span>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('comandi_dashboard_company_logo_label')}
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-16 h-16 rounded-xl border border-gray-700 bg-gray-800 overflow-hidden shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="w-full h-full object-contain" />
            ) : (
              <Building2 className="w-6 h-6 text-gray-600" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800 cursor-pointer w-fit">
              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              {t('comandi_dashboard_company_logo_upload_button')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            {logoError && <p className="text-xs text-red-400">{logoError}</p>}
          </div>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('comandi_setup_business_name_label')}
        </label>
        <input
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('comandi_setup_vat_label')}
        </label>
        <input
          value={vatNumber}
          onChange={(e) => setVatNumber(e.target.value)}
          className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('comandi_setup_address_label')}
          </label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('comandi_setup_city_label')}
          </label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('comandi_setup_phone_label')}
        </label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="self-start px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
      >
        {t('comandi_dashboard_company_save_button')}
      </button>
    </form>
    <SubscriptionSection slug={slug} />
    </div>
  );
}

// ─── Tab Accesso ────────────────────────────────────────────────────────────
// A differenza di Azienda (dati aziendali + fatturazione, solo ruoli con
// accesso pieno), qui non c'è nulla di sensibile a livello di tenant: ogni
// utente gestisce solo le proprie credenziali, più condivisione/installazione
// dell'app — per questo è l'unica voce, oltre a Catalogo e Clienti, data
// anche al ruolo agente (vedi AGENT_TABS).
function AccessTab({ tenantId }: { tenantId: string }) {
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any).from('tenants').select('name').eq('id', tenantId).single();
      if (!cancelled) setCompanyName((data as { name?: string } | null)?.name || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <MyAccountSection />
      <ShareAppSection tenantId={tenantId} />
      <InstallAppCard appName={companyName || COMANDI_PWA_APP_NAME} />
    </div>
  );
}

// ─── Il tuo accesso (email + password dell'utente loggato) ─────────────────
// L'utente gestisce QUI le proprie credenziali di login (supabase.auth.
// updateUser, la sessione corrente è già valida per entrambe le operazioni,
// nessuna vecchia password richiesta). Il cambio email, per come Supabase
// Auth è configurato di default (secure email change), invia un'email di
// conferma al nuovo indirizzo: l'indirizzo mostrato/attivo non cambia finché
// il link di conferma non viene aperto.

function MyAccountSection() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email || '');
    })();
  }, []);

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(false);

    const trimmed = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError(t('comandi_dashboard_myaccount_email_invalid'));
      return;
    }

    setChangingEmail(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: trimmed });
      if (updateError) {
        if (updateError.message?.toLowerCase().includes('session')) {
          setEmailError(t('comandi_dashboard_myaccount_error_session'));
        } else {
          setEmailError(updateError.message);
        }
        return;
      }
      setNewEmail('');
      setEmailSuccess(true);
    } catch (err) {
      console.error('[MyAccountSection] Errore cambio email:', err);
      setEmailError(t('comandi_dashboard_myaccount_error_generic'));
    } finally {
      setChangingEmail(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 6) {
      setError(t('comandi_dashboard_credentials_password_too_short'));
      return;
    }

    setChanging(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        if (updateError.message?.toLowerCase().includes('session')) {
          setError(t('comandi_dashboard_myaccount_error_session'));
        } else {
          setError(updateError.message);
        }
        return;
      }
      setNewPassword('');
      setSuccess(true);
    } catch (err) {
      console.error('[MyAccountSection] Errore cambio password:', err);
      setError(t('comandi_dashboard_myaccount_error_generic'));
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        <KeyRound className="w-3.5 h-3.5" />
        {t('comandi_dashboard_myaccount_title')}
      </p>
      {email && (
        <p className="text-xs text-gray-500 mb-4">
          {t('comandi_dashboard_myaccount_email_label')}: <span className="text-gray-300 font-mono">{email}</span>
        </p>
      )}

      {/* Cambio email */}
      <form onSubmit={handleChangeEmail} className="flex flex-col sm:flex-row gap-2 items-start">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={t('comandi_dashboard_myaccount_new_email_placeholder')}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={changingEmail || !newEmail}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {changingEmail ? t('comandi_dashboard_myaccount_changing') : t('comandi_dashboard_myaccount_change_email_button')}
        </button>
      </form>
      {emailError && <p className="text-xs text-red-400 mt-2">{emailError}</p>}
      {emailSuccess && <p className="text-xs text-green-400 mt-2">{t('comandi_dashboard_myaccount_email_change_pending')}</p>}

      {/* Cambio password */}
      <form onSubmit={handleChangePassword} className="flex flex-col sm:flex-row gap-2 items-start mt-4 pt-4 border-t border-gray-800">
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t('comandi_dashboard_myaccount_new_password_placeholder')}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={changing || !newPassword}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {changing ? t('comandi_dashboard_myaccount_changing') : t('comandi_dashboard_myaccount_change_button')}
        </button>
      </form>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      {success && <p className="text-xs text-green-400 mt-2">{t('comandi_dashboard_myaccount_change_success')}</p>}
    </div>
  );
}

// ─── Condividi l'app (URL pubblico + QR) ────────────────────────────────────
// Il link/QR deve puntare SEMPRE alla landing page pubblica dell'istanza
// (/a/[slug], non /app o /dashboard): è costruito direttamente dallo slug
// invece di riusare apps.production_url, che è una colonna generica condivisa
// con le app a schema generato e non garantisce di restare allineata alla
// landing (es. se in futuro viene ripuntata a un dominio custom).

function ShareAppSection({ tenantId }: { tenantId: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: app } = await supabase
        .from('apps' as any)
        .select('slug')
        .eq('tenant_id', tenantId)
        .eq('app_type', 'comandi_ai')
        .maybeSingle();

      const appRow = app as { slug?: string } | null;
      const shareUrl = appRow?.slug
        ? `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appRow.slug}`
        : null;
      setUrl(shareUrl);
      setLoading(false);
    })();
  }, [tenantId]);

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !url) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        <QrCode className="w-3.5 h-3.5" />
        {t('comandi_dashboard_share_title')}
      </p>
      <p className="text-xs text-gray-500 mb-4">{t('comandi_dashboard_share_subtitle')}</p>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="shrink-0 rounded-xl bg-white p-3">
          <QRCodeSVG value={url} size={120} bgColor="#ffffff" fgColor="#000000" level="M" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <p className="break-all font-mono text-sm text-gray-200">{url}</p>
          <button type="button" onClick={copy} className="shrink-0 text-gray-500 hover:text-white">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Abbonamento (stato, annullamento) ──────────────────────────────────────
// Raggiungibile solo da qui (tab Azienda, non agente): mostrare "Disdici
// abbonamento" a un ruolo 'member'/cassa non ha senso.

function SubscriptionSection({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const appInfo = useAppInfo();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const handleCancel = async () => {
    if (!window.confirm(t('comandi_dashboard_subscription_cancel_confirm'))) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/a/${slug}/cancel-subscription`, { method: 'POST' });
      const data = await res.json().catch(() => ({ error: t('comandi_dashboard_subscription_error_generic') }));
      if (!res.ok || !data.success) {
        setError(data.error || t('comandi_dashboard_subscription_error_generic'));
        return;
      }
      setCancelled(true);
    } catch (err) {
      console.error('[SubscriptionSection] Errore annullamento abbonamento:', err);
      setError(t('comandi_dashboard_subscription_error_generic'));
    } finally {
      setCancelling(false);
    }
  };

  if (!appInfo.status) return null;

  return (
    <div className="max-w-lg mt-8 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        <CreditCard className="w-3.5 h-3.5" />
        {t('comandi_dashboard_subscription_title')}
      </p>

      {appInfo.status === 'active' && !cancelled && (
        <>
          <p className="text-sm text-gray-300 mb-3">
            {t('comandi_dashboard_subscription_active_label').replace('{price}', appInfo.clientPrice.toFixed(2))}
          </p>
          {appInfo.stripeSubscriptionId && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-red-700/50 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {cancelling ? t('comandi_dashboard_subscription_cancelling') : t('comandi_dashboard_subscription_cancel_button')}
            </button>
          )}
        </>
      )}

      {appInfo.status === 'trial' && (
        <p className="text-sm text-gray-400 mb-3">{t('comandi_dashboard_subscription_trial_hint')}</p>
      )}

      {cancelled && <p className="text-sm text-green-400 mb-3">{t('comandi_dashboard_subscription_cancel_success')}</p>}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}

// ─── Tab Storico Ordini ─────────────────────────────────────────────────────

const ORDER_STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: 'bg-amber-500/15 text-amber-300 border border-amber-700/50',
  CONFIRMED: 'bg-green-500/15 text-green-300 border border-green-700/50',
  PROCESSING: 'bg-blue-500/15 text-blue-300 border border-blue-700/50',
  COMPLETED: 'bg-gray-700/50 text-gray-300 border border-gray-600/50',
  CANCELLED: 'bg-red-500/15 text-red-300 border border-red-700/50',
};

function OrdersTab({ tenantId }: { tenantId: string }) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Conferma / annullamento ordine ───────────────────────────────────────
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Memo audio dell'agente (signed URL on-demand) ────────────────────────
  const [audioOrderId, setAudioOrderId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // ── N. Bolla / N. Fattura (editabili inline) ─────────────────────────────
  const [savingDocsOrderId, setSavingDocsOrderId] = useState<string | null>(null);

  // ── Esportazione (CSV/Excel, download/email/WhatsApp) ────────────────────
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'whatsapp' | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('orders' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      setOrders((data || []) as unknown as Order[]);
      setLoading(false);
    })();
  }, [tenantId]);

  const handleUpdateDocumentField = async (
    orderId: string,
    field: 'delivery_note_number' | 'invoice_number',
    value: string
  ) => {
    const previous = orders.find((o) => o.id === orderId)?.[field] ?? null;
    const nextValue = value.trim() || null;
    if (nextValue === previous) return;

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: nextValue } : o)));
    setSavingDocsOrderId(orderId);
    const { error } = await (supabase as any).from('orders').update({ [field]: nextValue }).eq('id', orderId);
    setSavingDocsOrderId(null);
    if (error) {
      console.error('[OrdersTab] Errore salvataggio documento ordine:', error);
      setActionError(t('comandi_dashboard_orders_action_error_generic'));
      // Ripristina il valore precedente: l'update ottimistico sopra non è andato a buon fine.
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, [field]: previous } : o)));
    }
  };

  const getExportAuthToken = async (): Promise<string | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const fetchExportBlob = async (format: 'csv' | 'xlsx'): Promise<Blob | null> => {
    const token = await getExportAuthToken();
    if (!token) {
      setExportError(t('comandi_dashboard_orders_export_error_session'));
      return null;
    }
    const res = await fetch(`/api/comandi/orders-export?format=${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setExportError(t('comandi_dashboard_orders_export_error_generic'));
      return null;
    }
    return res.blob();
  };

  const handleDownloadExport = async (format: 'csv' | 'xlsx') => {
    setExportError(null);
    setExporting(format);
    try {
      const blob = await fetchExportBlob(format);
      if (blob) downloadBlob(blob, format === 'xlsx' ? 'ordini.xlsx' : 'ordini.csv');
    } catch (err) {
      console.error('[OrdersTab] Errore download esportazione:', err);
      setExportError(t('comandi_dashboard_orders_export_error_generic'));
    } finally {
      setExporting(null);
    }
  };

  // Nessuna Business API WhatsApp collegata (richiederebbe un account Twilio/
  // Meta a pagamento): usa la Web Share API nativa del browser, che passa il
  // file reale all'app scelta dall'utente (inclusa WhatsApp) nel foglio di
  // condivisione del sistema operativo. Se non supportata (tipicamente
  // desktop), scarica il file e apre WhatsApp Web con un messaggio pronto —
  // l'allegato va aggiunto a mano perché i link wa.me non supportano file.
  const handleShareWhatsApp = async () => {
    setExportError(null);
    setExporting('whatsapp');
    try {
      const blob = await fetchExportBlob('xlsx');
      if (!blob) return;
      const file = new File([blob], 'ordini.xlsx', { type: blob.type });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Ordini', text: t('comandi_dashboard_orders_export_whatsapp_share_text') });
      } else {
        downloadBlob(blob, 'ordini.xlsx');
        window.open(`https://wa.me/?text=${encodeURIComponent(t('comandi_dashboard_orders_export_whatsapp_fallback_text'))}`, '_blank');
      }
    } catch (err) {
      // AbortError: l'utente ha chiuso il foglio di condivisione senza scegliere nulla, non è un errore da segnalare.
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[OrdersTab] Errore condivisione WhatsApp:', err);
      setExportError(t('comandi_dashboard_orders_export_error_generic'));
    } finally {
      setExporting(null);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);
    setEmailSent(false);
    setSendingEmail(true);
    try {
      const token = await getExportAuthToken();
      if (!token) {
        setExportError(t('comandi_dashboard_orders_export_error_session'));
        return;
      }
      const res = await fetch('/api/comandi/orders-export/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ format: 'xlsx', recipientEmail: emailRecipient.trim() }),
      });
      const json = await res.json().catch(() => ({ success: false }));
      if (!res.ok || !json.success) {
        setExportError(json.error || t('comandi_dashboard_orders_export_error_generic'));
        return;
      }
      setEmailSent(true);
      setEmailRecipient('');
    } catch (err) {
      console.error('[OrdersTab] Errore invio email esportazione:', err);
      setExportError(t('comandi_dashboard_orders_export_error_generic'));
    } finally {
      setSendingEmail(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, status: 'CONFIRMED' | 'CANCELLED') => {
    setActionError(null);
    setUpdatingOrderId(orderId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setActionError(t('comandi_dashboard_orders_action_error_session'));
        return;
      }
      const result = await updateOrderStatusAction({ orderId, status, accessToken: token });
      if (!result.success) {
        setActionError(result.error || t('comandi_dashboard_orders_action_error_generic'));
        return;
      }
      // Feedback visivo immediato: aggiorna lo stato in memoria senza
      // ricaricare l'intera lista (già confermato lato server sopra).
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    } catch (err) {
      console.error('[OrdersTab] Errore aggiornamento stato ordine:', err);
      setActionError(t('comandi_dashboard_orders_action_error_generic'));
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleToggleAudio = async (order: Order) => {
    // Click sull'ordine già aperto: chiudi il player invece di ri-generare
    // un nuovo signed URL inutilmente.
    if (audioOrderId === order.id) {
      setAudioOrderId(null);
      setAudioUrl(null);
      setAudioError(null);
      return;
    }

    setAudioOrderId(order.id);
    setAudioUrl(null);
    setAudioError(null);
    setAudioLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setAudioError(t('comandi_dashboard_orders_action_error_session'));
        return;
      }
      const result = await getOrderAudioSignedUrlAction({ orderId: order.id, accessToken: token });
      if (!result.success || !result.url) {
        setAudioError(result.error || t('comandi_dashboard_orders_audio_error_generic'));
        return;
      }
      setAudioUrl(result.url);
    } catch (err) {
      console.error('[OrdersTab] Errore recupero memo audio:', err);
      setAudioError(t('comandi_dashboard_orders_audio_error_generic'));
    } finally {
      setAudioLoading(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">…</p>;

  const todayStr = new Date().toDateString();
  const todayOrders = orders.filter((o) => new Date(o.created_at).toDateString() === todayStr);
  const todayRevenue = todayOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_dashboard_orders_stat_today_count')}</p>
          <p className="text-2xl font-bold text-white mt-1">{todayOrders.length}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_dashboard_orders_stat_today_revenue')}</p>
          <p className="text-2xl font-bold text-white mt-1">{formatCurrency(todayRevenue)}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_dashboard_orders_stat_total_revenue')}</p>
          <p className="text-2xl font-bold text-white mt-1">{formatCurrency(totalRevenue)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_orders_export_title')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleDownloadExport('csv')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
          >
            {exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {t('comandi_dashboard_orders_export_csv_button')}
          </button>
          <button
            type="button"
            onClick={() => handleDownloadExport('xlsx')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
          >
            {exporting === 'xlsx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {t('comandi_dashboard_orders_export_excel_button')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowEmailForm((v) => !v);
              setEmailSent(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            {t('comandi_dashboard_orders_export_email_button')}
          </button>
          <button
            type="button"
            onClick={handleShareWhatsApp}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50 transition-colors"
          >
            {exporting === 'whatsapp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
            {t('comandi_dashboard_orders_export_whatsapp_button')}
          </button>
        </div>

        {showEmailForm && (
          <form onSubmit={handleSendEmail} className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              required
              value={emailRecipient}
              onChange={(e) => setEmailRecipient(e.target.value)}
              placeholder={t('comandi_dashboard_orders_export_email_placeholder')}
              className="flex-1 min-w-[220px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500"
            />
            <button
              type="submit"
              disabled={sendingEmail || !emailRecipient.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
            >
              {sendingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              {t('comandi_dashboard_orders_export_email_send_button')}
            </button>
          </form>
        )}
        {emailSent && <p className="text-xs text-green-400">{t('comandi_dashboard_orders_export_email_success')}</p>}
        {exportError && <p className="text-xs text-red-400">{exportError}</p>}
      </div>

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="text-sm text-gray-500">{t('comandi_dashboard_orders_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800 bg-gray-900/60">
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_orders_col_date')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_orders_col_customer')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_orders_col_status')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('comandi_dashboard_orders_col_total')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_orders_col_delivery_note')}</th>
                <th className="px-4 py-2.5 font-medium">{t('comandi_dashboard_orders_col_invoice')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('comandi_dashboard_orders_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <Fragment key={order.id}>
                  <tr className="border-b border-gray-800/60 last:border-b-0">
                    <td className="px-4 py-2.5 text-gray-400">{new Date(order.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-white">{order.customer_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_BADGE_CLASS[order.status]}`}>
                        {t(`comandi_order_status_${order.status.toLowerCase()}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-white font-medium">{formatCurrency(Number(order.total_amount))}</td>
                    <td className="px-4 py-2.5">
                      <input
                        defaultValue={order.delivery_note_number || ''}
                        onBlur={(e) => handleUpdateDocumentField(order.id, 'delivery_note_number', e.target.value)}
                        disabled={savingDocsOrderId === order.id}
                        placeholder="—"
                        className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder:text-gray-600 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        defaultValue={order.invoice_number || ''}
                        onBlur={(e) => handleUpdateDocumentField(order.id, 'invoice_number', e.target.value)}
                        disabled={savingDocsOrderId === order.id}
                        placeholder="—"
                        className="w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder:text-gray-600 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {order.audio_url && (
                          <button
                            type="button"
                            onClick={() => handleToggleAudio(order)}
                            title={t('comandi_dashboard_orders_action_listen')}
                            className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                              audioOrderId === order.id
                                ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                                : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                            }`}
                          >
                            {audioLoading && audioOrderId === order.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        {order.status === 'PENDING_CONFIRMATION' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(order.id, 'CONFIRMED')}
                              disabled={updatingOrderId === order.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {updatingOrderId === order.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              {t('comandi_dashboard_orders_action_approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(order.id, 'CANCELLED')}
                              disabled={updatingOrderId === order.id}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:border-red-700/50 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              {t('comandi_dashboard_orders_action_cancel')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {audioOrderId === order.id && (
                    <tr className="border-b border-gray-800/60 last:border-b-0 bg-gray-950/40">
                      <td colSpan={7} className="px-4 py-3">
                        {audioError ? (
                          <p className="text-xs text-red-400">{audioError}</p>
                        ) : audioUrl ? (
                          <audio controls autoPlay src={audioUrl} className="w-full max-w-md h-9" />
                        ) : (
                          <p className="text-xs text-gray-500">{t('comandi_dashboard_orders_audio_loading')}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Agenti (owner/admin) ───────────────────────────────────────────────
// Crea/gestisce account per rappresentanti sul campo (ruolo 'agent', accesso
// limitato a Modalità Agente + Catalogo + Clienti, vedi AGENT_TABS). Ogni
// agente è un vero account Supabase Auth con password generata dal server:
// il QR personale precompila solo l'email nella pagina di login, non
// sostituisce la password — niente meccanismo di autenticazione parallelo.

interface AgentCredentials {
  email: string;
  password: string;
}

function AgentsTab({ tenantId, slug }: { tenantId: string; slug: string }) {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCredentials, setNewCredentials] = useState<AgentCredentials | null>(null);

  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [regeneratedFor, setRegeneratedFor] = useState<{ userId: string; password: string } | null>(null);
  const [qrForUserId, setQrForUserId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_agents_error_session'));
        return;
      }
      const result = await listAgentsAction({ accessToken });
      if (!result.success || !result.agents) {
        setError(result.error || t('comandi_dashboard_agents_error_generic'));
        return;
      }
      setAgents(result.agents);
    } catch (err) {
      console.error('[AgentsTab] Errore caricamento agenti:', err);
      setError(t('comandi_dashboard_agents_error_generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const copy = (value: string, field: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setCreating(true);
    setError(null);
    setNewCredentials(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_agents_error_session'));
        return;
      }
      const result = await createAgentAction({ displayName: newName.trim(), email: newEmail.trim(), accessToken });
      if (!result.success || !result.email || !result.password) {
        setError(result.error || t('comandi_dashboard_agents_error_generic'));
        return;
      }
      setNewCredentials({ email: result.email, password: result.password });
      setNewName('');
      setNewEmail('');
      await loadAgents();
    } catch (err) {
      console.error('[AgentsTab] Errore creazione agente:', err);
      setError(t('comandi_dashboard_agents_error_generic'));
    } finally {
      setCreating(false);
    }
  };

  const handleRegeneratePassword = async (agentUserId: string) => {
    if (!window.confirm(t('comandi_dashboard_agents_regenerate_confirm'))) return;
    setBusyUserId(agentUserId);
    setError(null);
    setRegeneratedFor(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_agents_error_session'));
        return;
      }
      const result = await regenerateAgentPasswordAction({ agentUserId, accessToken });
      if (!result.success || !result.password) {
        setError(result.error || t('comandi_dashboard_agents_error_generic'));
        return;
      }
      setRegeneratedFor({ userId: agentUserId, password: result.password });
    } catch (err) {
      console.error('[AgentsTab] Errore rigenerazione password:', err);
      setError(t('comandi_dashboard_agents_error_generic'));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDelete = async (agentUserId: string) => {
    if (!window.confirm(t('comandi_dashboard_agents_delete_confirm'))) return;
    setBusyUserId(agentUserId);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_agents_error_session'));
        return;
      }
      const result = await deleteAgentAction({ agentUserId, accessToken });
      if (!result.success) {
        setError(result.error || t('comandi_dashboard_agents_error_generic'));
        return;
      }
      setAgents((prev) => prev.filter((a) => a.userId !== agentUserId));
    } catch (err) {
      console.error('[AgentsTab] Errore rimozione agente:', err);
      setError(t('comandi_dashboard_agents_error_generic'));
    } finally {
      setBusyUserId(null);
    }
  };

  const loginUrlFor = (email: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}/login?email=${encodeURIComponent(email)}`;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
          <UserCog className="w-3.5 h-3.5" />
          {t('comandi_dashboard_agents_title')}
        </p>
        <p className="text-xs text-gray-500 mb-4">{t('comandi_dashboard_agents_subtitle')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('comandi_dashboard_agents_name_placeholder')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t('comandi_dashboard_agents_email_placeholder')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim() || !newEmail.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t('comandi_dashboard_agents_add_button')}
          </button>
        </div>

        {newCredentials && (
          <div className="mt-4 rounded-lg border border-green-700/50 bg-green-950/20 p-3">
            <p className="text-xs font-semibold text-green-300 mb-2">{t('comandi_dashboard_agents_credentials_title')}</p>
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20 shrink-0">{t('comandi_dashboard_agents_credentials_email')}</span>
                <span className="font-mono text-gray-200">{newCredentials.email}</span>
                <button type="button" onClick={() => copy(newCredentials.email, 'new-email')} className="text-gray-500 hover:text-white">
                  {copiedField === 'new-email' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-20 shrink-0">{t('comandi_dashboard_agents_credentials_password')}</span>
                <span className="font-mono text-gray-200">{newCredentials.password}</span>
                <button type="button" onClick={() => copy(newCredentials.password, 'new-password')} className="text-gray-500 hover:text-white">
                  {copiedField === 'new-password' ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('comandi_dashboard_agents_credentials_hint')}</p>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-gray-500">{t('comandi_dashboard_agents_empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {agents.map((agent) => (
            <div key={agent.userId} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{agent.displayName || agent.email}</p>
                  <p className="text-xs text-gray-500 font-mono truncate">{agent.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setQrForUserId((prev) => (prev === agent.userId ? null : agent.userId))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    {t('comandi_dashboard_agents_qr_button')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegeneratePassword(agent.userId)}
                    disabled={busyUserId === agent.userId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {t('comandi_dashboard_agents_regenerate_button')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(agent.userId)}
                    disabled={busyUserId === agent.userId}
                    className="p-1.5 rounded text-gray-500 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {regeneratedFor?.userId === agent.userId && (
                <div className="mt-3 rounded-lg border border-green-700/50 bg-green-950/20 p-3">
                  <p className="text-xs font-semibold text-green-300 mb-1">{t('comandi_dashboard_agents_new_password_title')}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-gray-200">{regeneratedFor.password}</span>
                    <button type="button" onClick={() => copy(regeneratedFor.password, `regen-${agent.userId}`)} className="text-gray-500 hover:text-white">
                      {copiedField === `regen-${agent.userId}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{t('comandi_dashboard_agents_credentials_hint')}</p>
                </div>
              )}

              {qrForUserId === agent.userId && (
                <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
                  <div className="shrink-0 rounded-xl bg-white p-2">
                    <QRCodeSVG value={loginUrlFor(agent.email)} size={96} bgColor="#ffffff" fgColor="#000000" level="M" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 mb-1">{t('comandi_dashboard_agents_qr_hint')}</p>
                    <p className="break-all font-mono text-xs text-gray-400">{loginUrlFor(agent.email)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab Fatture e Ricevute ─────────────────────────────────────────────────
// Riusa le tabelle fatture/righe_fattura e la stessa generazione PDF
// (pdfTemplates.ts) del modulo del motore a schema generato, con dati e
// autenticazione presi da Comandi (Server Action comandi-invoices.ts) invece
// del vecchio flusso a password — colore PDF fissato sull'ambra del brand
// Comandi invece del colore per-tenant generico.

interface InvoiceRigaForm {
  key: string;
  descrizione: string;
  quantita: string;
  prezzoUnitario: string;
  aliquotaIva: string;
}

const EMPTY_INVOICE_RIGA = (): InvoiceRigaForm => ({
  key: Math.random().toString(36).slice(2),
  descrizione: '',
  quantita: '1',
  prezzoUnitario: '0',
  aliquotaIva: '22',
});

function InvoicesTab() {
  const { t } = useLanguage();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [tipoDocumento, setTipoDocumento] = useState<InvoiceTipo>('fattura');
  const [dataEmissione, setDataEmissione] = useState(() => new Date().toISOString().slice(0, 10));
  const [clienteNome, setClienteNome] = useState('');
  const [clientePiva, setClientePiva] = useState('');
  const [clienteSdi, setClienteSdi] = useState('');
  const [clienteIndirizzo, setClienteIndirizzo] = useState('');
  const [metodoPagamento, setMetodoPagamento] = useState('');
  const [righe, setRighe] = useState<InvoiceRigaForm[]>([EMPTY_INVOICE_RIGA()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTipo, setFilterTipo] = useState<'tutti' | InvoiceTipo>('tutti');
  const [filterStato, setFilterStato] = useState<'tutti' | InvoiceStato>('tutti');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [layoutByInvoiceId, setLayoutByInvoiceId] = useState<Record<string, PdfLayoutMeta['key']>>({});

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_invoices_error_session'));
        return;
      }
      const result = await listInvoicesAction({ accessToken });
      if (!result.success || !result.invoices) {
        setError(result.error || t('comandi_dashboard_invoices_error_generic'));
        return;
      }
      setInvoices(result.invoices);
    } catch (err) {
      console.error('[InvoicesTab] Errore caricamento documenti:', err);
      setError(t('comandi_dashboard_invoices_error_generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const addRiga = () => setRighe((prev) => [...prev, EMPTY_INVOICE_RIGA()]);
  const removeRiga = (key: string) => {
    setRighe((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));
  };
  const updateRiga = (key: string, field: keyof Omit<InvoiceRigaForm, 'key'>, value: string) => {
    setRighe((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const totals = righe.reduce(
    (acc, r) => {
      const qty = parseFloat(r.quantita) || 0;
      const price = parseFloat(r.prezzoUnitario) || 0;
      const iva = parseFloat(r.aliquotaIva) || 0;
      const subtotal = qty * price;
      acc.imponibile += subtotal;
      acc.iva += subtotal * (iva / 100);
      return acc;
    },
    { imponibile: 0, iva: 0 }
  );
  const totaleGenerale = totals.imponibile + totals.iva;

  const resetForm = () => {
    setTipoDocumento('fattura');
    setDataEmissione(new Date().toISOString().slice(0, 10));
    setClienteNome('');
    setClientePiva('');
    setClienteSdi('');
    setClienteIndirizzo('');
    setMetodoPagamento('');
    setRighe([EMPTY_INVOICE_RIGA()]);
    setFormError(null);
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!clienteNome.trim()) {
      setFormError(t('comandi_dashboard_invoices_error_customer_required'));
      return;
    }
    const parsedRighe = righe.map((r) => ({
      descrizione: r.descrizione.trim(),
      quantita: parseFloat(r.quantita),
      prezzoUnitario: parseFloat(r.prezzoUnitario),
      aliquotaIva: parseFloat(r.aliquotaIva),
    }));
    if (parsedRighe.some((r) => !r.descrizione || !Number.isFinite(r.quantita) || r.quantita <= 0 || !Number.isFinite(r.prezzoUnitario))) {
      setFormError(t('comandi_dashboard_invoices_error_rows_invalid'));
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setFormError(t('comandi_dashboard_invoices_error_session'));
        return;
      }
      const result = await createInvoiceAction({
        tipoDocumento,
        dataEmissione,
        clienteNome: clienteNome.trim(),
        clientePiva: clientePiva.trim() || undefined,
        clienteSdi: clienteSdi.trim() || undefined,
        clienteIndirizzo: clienteIndirizzo.trim() || undefined,
        metodoPagamento: metodoPagamento.trim() || undefined,
        righe: parsedRighe,
        accessToken,
      });
      if (!result.success) {
        setFormError(result.error || t('comandi_dashboard_invoices_error_generic'));
        return;
      }
      resetForm();
      setShowForm(false);
      await loadInvoices();
    } catch (err) {
      console.error('[InvoicesTab] Errore creazione documento:', err);
      setFormError(t('comandi_dashboard_invoices_error_generic'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStato = async (invoiceId: string, stato: InvoiceStato) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? { ...inv, stato } : inv)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return;
      const result = await updateInvoiceStatusAction({ invoiceId, stato, accessToken });
      if (!result.success) {
        setError(result.error || t('comandi_dashboard_invoices_error_generic'));
        await loadInvoices();
      }
    } catch (err) {
      console.error('[InvoicesTab] Errore aggiornamento stato:', err);
      await loadInvoices();
    }
  };

  const handleDownloadPdf = async (invoiceId: string) => {
    setDownloadingId(invoiceId);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        setError(t('comandi_dashboard_invoices_error_session'));
        return;
      }
      const result = await getInvoiceAction({ invoiceId, accessToken });
      if (!result.success || !result.invoice) {
        setError(result.error || t('comandi_dashboard_invoices_error_generic'));
        return;
      }
      const inv = result.invoice;
      const layout = layoutByInvoiceId[invoiceId] || 'moderno';
      downloadInvoicePdf(layout, {
        tipoDocumento: inv.tipoDocumento,
        numero: inv.numeroFattura,
        anno: inv.anno,
        dataEmissione: inv.dataEmissione,
        stato: inv.stato,
        cliente: { nome: inv.clienteNome, piva: inv.clientePiva, sdi: inv.clienteSdi, indirizzo: inv.clienteIndirizzo },
        righe: inv.righe,
        azienda: {
          ragioneSociale: inv.azienda.ragioneSociale,
          piva: inv.azienda.piva,
          indirizzo: inv.azienda.indirizzo,
          telefono: inv.azienda.telefono,
        },
        // Ambra del brand Comandi, fissa: a differenza del modulo generico
        // (colore per-tenant), qui non c'è un colore "azienda" da leggere.
        primaryColorHex: COMANDI_PWA_THEME_COLOR,
      });
    } catch (err) {
      console.error('[InvoicesTab] Errore generazione PDF:', err);
      setError(t('comandi_dashboard_invoices_error_generic'));
    } finally {
      setDownloadingId(null);
    }
  };

  const formatCurrency = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('it-IT'); } catch { return iso; }
  };

  const filtered = invoices.filter((inv) => {
    const matchStato = filterStato === 'tutti' || inv.stato === filterStato;
    const matchTipo = filterTipo === 'tutti' || inv.tipoDocumento === filterTipo;
    const term = searchTerm.trim().toLowerCase();
    const matchSearch =
      !term ||
      inv.clienteNome.toLowerCase().includes(term) ||
      inv.numeroFattura.toLowerCase().includes(term) ||
      (inv.clientePiva || '').toLowerCase().includes(term);
    return matchStato && matchTipo && matchSearch;
  });

  const stats = {
    totale: filtered.length,
    bozze: filtered.filter((f) => f.stato === 'bozza').length,
    emesse: filtered.filter((f) => f.stato === 'emessa').length,
    pagate: filtered.filter((f) => f.stato === 'pagata').length,
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="text-2xl font-bold text-white">{stats.totale}</div>
          <div className="text-xs text-gray-500">{t('comandi_dashboard_invoices_stat_total')}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="text-2xl font-bold text-gray-400">{stats.bozze}</div>
          <div className="text-xs text-gray-500">{t('comandi_dashboard_invoices_stato_bozza')}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="text-2xl font-bold text-blue-400">{stats.emesse}</div>
          <div className="text-xs text-gray-500">{t('comandi_dashboard_invoices_stato_emessa')}</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="text-2xl font-bold text-green-400">{stats.pagate}</div>
          <div className="text-xs text-gray-500">{t('comandi_dashboard_invoices_stato_pagata')}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t('comandi_dashboard_invoices_title')}
          </p>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('comandi_dashboard_invoices_new_button')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('comandi_dashboard_invoices_search_placeholder')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value as typeof filterTipo)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="tutti">{t('comandi_dashboard_invoices_filter_all')}</option>
            <option value="fattura">{t('comandi_dashboard_invoices_tipo_fattura')}</option>
            <option value="ricevuta">{t('comandi_dashboard_invoices_tipo_ricevuta')}</option>
          </select>
          <select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value as typeof filterStato)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="tutti">{t('comandi_dashboard_invoices_filter_all')}</option>
            <option value="bozza">{t('comandi_dashboard_invoices_stato_bozza')}</option>
            <option value="emessa">{t('comandi_dashboard_invoices_stato_emessa')}</option>
            <option value="pagata">{t('comandi_dashboard_invoices_stato_pagata')}</option>
            <option value="annullata">{t('comandi_dashboard_invoices_stato_annullata')}</option>
          </select>
        </div>

        {showForm && (
          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => setTipoDocumento('fattura')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${tipoDocumento === 'fattura' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
              >
                {t('comandi_dashboard_invoices_tipo_fattura')}
              </button>
              <button
                type="button"
                onClick={() => setTipoDocumento('ricevuta')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${tipoDocumento === 'ricevuta' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
              >
                {t('comandi_dashboard_invoices_tipo_ricevuta')}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <input
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                placeholder={t('comandi_dashboard_invoices_customer_name_placeholder')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
              <input
                value={clientePiva}
                onChange={(e) => setClientePiva(e.target.value)}
                placeholder={t('comandi_dashboard_invoices_customer_vat_placeholder')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
              <input
                value={clienteSdi}
                onChange={(e) => setClienteSdi(e.target.value.toUpperCase())}
                placeholder={t('comandi_dashboard_invoices_customer_sdi_placeholder')}
                maxLength={7}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 font-mono"
              />
              <input
                value={clienteIndirizzo}
                onChange={(e) => setClienteIndirizzo(e.target.value)}
                placeholder={t('comandi_dashboard_invoices_customer_address_placeholder')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
              <input
                value={metodoPagamento}
                onChange={(e) => setMetodoPagamento(e.target.value)}
                placeholder={t('comandi_dashboard_invoices_payment_method_placeholder')}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
              />
              <input
                type="date"
                value={dataEmissione}
                onChange={(e) => setDataEmissione(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white sm:col-span-2"
              />
            </div>

            <div className="flex flex-col gap-2 mt-3">
              {righe.map((riga) => (
                <div key={riga.key} className="grid grid-cols-2 sm:grid-cols-[1fr_5rem_6rem_5rem_auto] gap-2 items-center">
                  <input
                    value={riga.descrizione}
                    onChange={(e) => updateRiga(riga.key, 'descrizione', e.target.value)}
                    placeholder={t('comandi_dashboard_invoices_row_description_placeholder')}
                    className="col-span-2 sm:col-span-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-gray-500"
                  />
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={riga.quantita}
                    onChange={(e) => updateRiga(riga.key, 'quantita', e.target.value)}
                    placeholder={t('comandi_dashboard_invoices_row_qty_placeholder')}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder:text-gray-500"
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">€</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={riga.prezzoUnitario}
                      onChange={(e) => updateRiga(riga.key, 'prezzoUnitario', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-5 pr-2 py-1.5 text-sm text-white"
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={riga.aliquotaIva}
                      onChange={(e) => updateRiga(riga.key, 'aliquotaIva', e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-2 pr-5 py-1.5 text-sm text-white"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRiga(riga.key)}
                    disabled={righe.length === 1}
                    className="p-1.5 rounded text-gray-500 hover:bg-red-500/15 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed justify-self-end"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addRiga}
                className="self-start flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('comandi_dashboard_invoices_add_row_button')}
              </button>
            </div>

            <div className="mt-4 flex flex-col items-end gap-1 text-sm">
              <div className="flex items-center gap-3 text-gray-400">
                <span>{t('comandi_dashboard_invoices_totals_taxable')}</span>
                <span className="text-white font-mono">{formatCurrency(totals.imponibile)}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-400">
                <span>{t('comandi_dashboard_invoices_totals_vat')}</span>
                <span className="text-white font-mono">{formatCurrency(totals.iva)}</span>
              </div>
              <div className="flex items-center gap-3 text-base font-bold">
                <span className="text-gray-300">{t('comandi_dashboard_invoices_totals_total')}</span>
                <span className="text-amber-400 font-mono">{formatCurrency(totaleGenerale)}</span>
              </div>
            </div>

            {formError && <p className="mt-2 text-xs text-red-400">{formError}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {t('comandi_dashboard_invoices_save_button')}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                {t('comandi_dashboard_invoices_cancel_button')}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">{t('comandi_dashboard_invoices_empty')}</p>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-900/80">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_type')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_number')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_date')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_customer')}</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_status')}</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_total')}</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">{t('comandi_dashboard_invoices_col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-t border-gray-800/60 hover:bg-gray-800/20">
                    <td className="px-3 py-2.5 text-xs">
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${inv.tipoDocumento === 'ricevuta' ? 'bg-amber-500/15 text-amber-400' : 'border border-gray-700 text-gray-300'}`}>
                        {inv.tipoDocumento === 'ricevuta' ? t('comandi_dashboard_invoices_tipo_ricevuta') : t('comandi_dashboard_invoices_tipo_fattura')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-white font-mono">{inv.numeroFattura}/{inv.anno}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300">{formatDate(inv.dataEmissione)}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-300 max-w-[180px] truncate">{inv.clienteNome}</td>
                    <td className="px-3 py-2.5 text-center">
                      <select
                        value={inv.stato}
                        onChange={(e) => handleUpdateStato(inv.id, e.target.value as InvoiceStato)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white"
                      >
                        <option value="bozza">{t('comandi_dashboard_invoices_stato_bozza')}</option>
                        <option value="emessa">{t('comandi_dashboard_invoices_stato_emessa')}</option>
                        <option value="pagata">{t('comandi_dashboard_invoices_stato_pagata')}</option>
                        <option value="annullata">{t('comandi_dashboard_invoices_stato_annullata')}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm text-white font-mono">{formatCurrency(inv.totale)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <select
                          value={layoutByInvoiceId[inv.id] || 'moderno'}
                          onChange={(e) => setLayoutByInvoiceId((prev) => ({ ...prev, [inv.id]: e.target.value as PdfLayoutMeta['key'] }))}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-xs text-white"
                          title={t('comandi_dashboard_invoices_layout_label')}
                        >
                          {PDF_LAYOUTS.map((layout) => (
                            <option key={layout.key} value={layout.key}>{layout.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv.id)}
                          disabled={downloadingId === inv.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40"
                        >
                          {downloadingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
