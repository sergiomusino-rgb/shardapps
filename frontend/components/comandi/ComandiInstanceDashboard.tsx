'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  LogOut,
  Package,
  Plus,
  Receipt,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';
import { setupTenantAction } from '@/app/actions/comandi-tenant';
import { updatePosCredentialsAction } from '@/app/actions/comandi-provisioning';
import type { CatalogItem, Order, ProductSynonym } from '@/types/comandi';

type Tab = 'catalog' | 'company' | 'orders';

export interface ComandiInstanceDashboardProps {
  slug: string;
  tenantId: string;
  appName?: string;
}

function formatCurrency(value: number): string {
  return `€ ${value.toFixed(2)}`;
}

export default function ComandiInstanceDashboard({ slug, tenantId, appName }: ComandiInstanceDashboardProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('catalog');

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push(`/a/${slug}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900/60">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href={`/a/${slug}`} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
              {t('comandi_dashboard_back_to_landing')}
            </Link>
            <span className="text-lg font-bold">
              Comandi<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
              {appName ? <span className="text-gray-500 font-normal"> — {appName}</span> : null}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {t('comandi_dashboard_logout')}
          </button>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-1">
          {(['catalog', 'company', 'orders'] as Tab[]).map((key) => (
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
        {tab === 'catalog' && <CatalogTab tenantId={tenantId} />}
        {tab === 'company' && <CompanyTab tenantId={tenantId} />}
        {tab === 'orders' && <OrdersTab tenantId={tenantId} />}
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

function CatalogTab({ tenantId }: { tenantId: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<EditableCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(EMPTY_NEW_ITEM);
  const [isAdding, setIsAdding] = useState(false);

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

      {/* Aggiungi prodotto */}
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
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white col-span-2 sm:col-span-1"
                />
                <input
                  type="number"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) => updateItemField(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white"
                />
                <input
                  value={item.unit_of_measure}
                  onChange={(e) => updateItemField(item.id, 'unit_of_measure', e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white"
                />
                <label className="flex items-center gap-1.5 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={item.is_active}
                    onChange={(e) => updateItemField(item.id, 'is_active', e.target.checked)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-amber-600"
                  />
                  {t('comandi_dashboard_catalog_col_active')}
                </label>
                <button
                  type="button"
                  onClick={() => handleDeleteItem(item.id)}
                  className="justify-self-end p-1.5 rounded text-gray-500 hover:bg-red-500/15 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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
                    <button type="button" onClick={() => handleRemoveSynonym(item.id, syn.id)} className="hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab Azienda ────────────────────────────────────────────────────────────

function CompanyTab({ tenantId }: { tenantId: string }) {
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
    <CredentialsSection tenantId={tenantId} />
    </>
  );
}

// ─── Credenziali di accesso (account cassa) ────────────────────────────────

function CredentialsSection({ tenantId }: { tenantId: string }) {
  const { t } = useLanguage();
  const [posEmail, setPosEmail] = useState('');
  const [posPassword, setPosPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<'email' | 'password' | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: app } = await supabase
        .from('apps' as any)
        .select('id, client_email')
        .eq('tenant_id', tenantId)
        .eq('app_type', 'comandi_ai')
        .maybeSingle();

      const appRow = app as { id: string; client_email?: string } | null;
      if (!appRow) {
        setLoading(false);
        return;
      }
      setPosEmail(appRow.client_email || '');

      // RPC (non SELECT diretta): client_password/initial_password sono
      // revocate per anon/authenticated su apps, vedi migrazione lockdown.
      const { data: creds } = await (supabase as any).rpc('get_app_client_credentials', { p_app_id: appRow.id });
      if (Array.isArray(creds) && creds[0]?.client_password) {
        setPosPassword(creds[0].client_password);
      }
      setLoading(false);
    })();
  }, [tenantId]);

  const copy = (value: string, field: 'email' | 'password') => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeError(null);
    setChangeSuccess(false);

    if (newPassword.length < 6) {
      setChangeError(t('comandi_dashboard_credentials_password_too_short'));
      return;
    }

    setChanging(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setChangeError(t('comandi_dashboard_company_error_generic'));
        return;
      }
      const result = await updatePosCredentialsAction({ accessToken: session.access_token, newPassword });
      if (!result.success) {
        setChangeError(result.error || t('comandi_dashboard_company_error_generic'));
        return;
      }
      setPosPassword(newPassword);
      setNewPassword('');
      setChangeSuccess(true);
    } catch (err) {
      console.error('[CredentialsSection] Errore cambio password:', err);
      setChangeError(t('comandi_dashboard_company_error_generic'));
    } finally {
      setChanging(false);
    }
  };

  if (loading || !posEmail) return null;

  return (
    <div className="max-w-lg mt-8 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        {t('comandi_dashboard_credentials_title')}
      </p>
      <div className="space-y-2 mb-4">
        <div>
          <p className="text-[11px] text-gray-500 mb-0.5">{t('creator_comandi_success_credentials_email')}</p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm text-gray-200 break-all">{posEmail}</p>
            <button type="button" onClick={() => copy(posEmail, 'email')} className="shrink-0 text-gray-500 hover:text-white">
              {copiedField === 'email' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
        {posPassword && (
          <div>
            <p className="text-[11px] text-gray-500 mb-0.5">{t('creator_comandi_success_credentials_password')}</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-sm text-gray-200">{posPassword}</p>
              <button type="button" onClick={() => copy(posPassword, 'password')} className="shrink-0 text-gray-500 hover:text-white">
                {copiedField === 'password' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleChangePassword} className="flex flex-col sm:flex-row gap-2 items-start">
        <input
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t('comandi_dashboard_credentials_new_password_placeholder')}
          className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={changing || !newPassword}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {changing ? t('comandi_dashboard_credentials_changing') : t('comandi_dashboard_credentials_change_button')}
        </button>
      </form>
      {changeError && <p className="text-xs text-red-400 mt-2">{changeError}</p>}
      {changeSuccess && <p className="text-xs text-green-400 mt-2">{t('comandi_dashboard_credentials_change_success')}</p>}
    </div>
  );
}

// ─── Tab Storico Ordini ─────────────────────────────────────────────────────

function OrdersTab({ tenantId }: { tenantId: string }) {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-800/60 last:border-b-0">
                  <td className="px-4 py-2.5 text-gray-400">{new Date(order.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-white">{order.customer_name || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">{order.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-white font-medium">{formatCurrency(Number(order.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
