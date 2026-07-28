'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import ComandiHeaderBrand from './ComandiHeaderBrand';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ChevronDown,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  LogOut,
  Mic,
  Plus,
  QrCode,
  ShieldAlert,
  Trash2,
  UploadCloud,
  Volume2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';
import { setupTenantAction } from '@/app/actions/comandi-tenant';
import { updateOrderStatusAction, getOrderAudioSignedUrlAction } from '@/app/actions/comandi-orders';
import { useComandiRole } from '@/src/lib/useComandiRole';
import { useAppInfo } from '@/app/a/[slug]/AppInfoContext';
import { daysRemaining } from '@/app/a/[slug]/app/subscription-status';
import type { CatalogItem, Order, OrderStatus, ProductSynonym, TenantMemberRole } from '@/types/comandi';

type Tab = 'catalog' | 'company' | 'orders';

// Tab visibili per ruolo: 'agent' vede solo il catalogo (in sola lettura, vedi
// CatalogTab readOnly più sotto) — niente dati aziendali né incassi, come da
// requisito RBAC del ruolo. Tutti gli altri ruoli (owner/admin/member) vedono
// tutto, invariato.
const ALL_TABS: Tab[] = ['catalog', 'company', 'orders'];
const AGENT_TABS: Tab[] = ['catalog'];

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
function TrialNudgeBanner({ slug }: { slug: string }) {
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
  const { role } = useComandiRole(tenantId);
  const isAgent = role === 'agent';
  const visibleTabs = isAgent ? AGENT_TABS : ALL_TABS;

  const [tab, setTab] = useState<Tab>('catalog');

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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <TrialNudgeBanner slug={slug} />

      <header className="border-b border-gray-800 bg-gray-900/60">
        <div className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div />
          <ComandiHeaderBrand />
          <div className="flex items-center justify-end gap-3">
            {!isAgent && (
              <Link
                href={`/a/${slug}/app/agente`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                <Mic className="w-4 h-4" />
                {t('comandi_dashboard_go_to_console')}
              </Link>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t('comandi_dashboard_logout')}
            </button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-1">
          {visibleTabs.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                tab === key
                  ? 'border-amber-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t(`comandi_dashboard_tab_${key}`)}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
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
        {tab === 'company' && !isAgent && <CompanyTab tenantId={tenantId} slug={slug} />}
        {tab === 'orders' && !isAgent && <OrdersTab tenantId={tenantId} />}
      </main>
    </div>
  );
}

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

      const rows = (catalogRows || []) as CatalogItem[];
      const ids = rows.map((r) => r.id);
      let synonymRows: ProductSynonym[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from('product_synonyms' as any)
          .select('*')
          .in('product_id', ids);
        synonymRows = (data || []) as ProductSynonym[];
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
          <input
            type="number"
            step="0.01"
            value={newItem.unit_price}
            onChange={(e) => setNewItem((v) => ({ ...v, unit_price: e.target.value }))}
            placeholder={t('comandi_dashboard_catalog_col_price')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
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
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                <span className="text-xs font-mono text-gray-500 col-span-2 sm:col-span-1">{item.sku}</span>
                <input
                  value={item.name}
                  onChange={(e) => updateItemField(item.id, 'name', e.target.value)}
                  disabled={readOnly}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white col-span-2 sm:col-span-1 disabled:opacity-70 disabled:cursor-not-allowed"
                />
                <input
                  type="number"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) => updateItemField(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                  disabled={readOnly}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
                <input
                  value={item.unit_of_measure}
                  onChange={(e) => updateItemField(item.id, 'unit_of_measure', e.target.value)}
                  disabled={readOnly}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white disabled:opacity-70 disabled:cursor-not-allowed"
                />
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
            </div>
          ))}
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('tenants' as any)
        .select('name, vat_number, address, city, phone')
        .eq('id', tenantId)
        .single();
      if (data) {
        const tenant = data as { name?: string; vat_number?: string; address?: string; city?: string; phone?: string };
        setBusinessName(tenant.name || '');
        setVatNumber(tenant.vat_number || '');
        setAddress(tenant.address || '');
        setCity(tenant.city || '');
        setPhone(tenant.phone || '');
      }
      setLoading(false);
    })();
  }, [tenantId]);

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
    <>
    <form onSubmit={handleSave} className="max-w-lg flex flex-col gap-4">
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
    <MyAccountSection />
    <ShareAppSection tenantId={tenantId} />
    <SubscriptionSection slug={slug} />
    </>
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
    <div className="max-w-lg mt-8 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
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
    <div className="max-w-lg mt-8 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
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

// ─── Abbonamento (stato, annullamento, link a Gestione) ─────────────────────
// Raggiungibile solo da qui (tab Azienda, non agente): mostrare "Disdici
// abbonamento" a un ruolo 'member'/cassa non ha senso. Il link punta a
// /dashboard/management, l'area ZeusX dove il titolare gestisce fatturazione
// e Stripe Connect per le proprie app — /management è una pagina diversa e
// più vecchia, non quella giusta qui (vedi ricerca in app/dashboard/management).

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

      <Link
        href={`/dashboard/management?appId=${appInfo.appId}`}
        className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        {t('comandi_dashboard_subscription_management_link')}
      </Link>
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('orders' as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      setOrders((data || []) as Order[]);
      setLoading(false);
    })();
  }, [tenantId]);

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
                      <div className="flex items-center justify-end gap-1.5">
                        {order.audio_url && (
                          <button
                            type="button"
                            onClick={() => handleToggleAudio(order)}
                            title={t('comandi_dashboard_orders_action_listen')}
                            className={`flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
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
                      <td colSpan={5} className="px-4 py-3">
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
