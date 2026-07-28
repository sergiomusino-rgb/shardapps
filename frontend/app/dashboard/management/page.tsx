'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { Copy, Check, CreditCard, AlertCircle, Settings, Wallet, TrendingUp, LayoutGrid } from 'lucide-react';
import { getClientSubscriptionPrice, ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';
import { useLanguage } from '@/src/lib/LanguageContext';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

interface App {
  id: string;
  name: string;
  slug: string | null;
  app_type: string | null;
  totalum_app_id: string | null;
  stripe_connect_id: string | null;
  client_subscription_price: number | null;
  client_price?: number | null;
  status: string | null;
  trial_ends_at: string | null;
  is_active: boolean;
  created_at: string | null;
  client_active: boolean;
  expires_at: string | null;
  client_email?: string | null;
  client_password?: string;
}

export default function ManagementConsolePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightAppId = searchParams.get('appId');
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<App[]>([]);
  const [userPlan, setUserPlan] = useState<string>('free');
  const [stripeConnectId, setStripeConnectId] = useState<string | null>(null);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [savingPrice, setSavingPrice] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [slotInfo, setSlotInfo] = useState<{ appLimit: number; totalCreated: number }>({ appLimit: 0, totalCreated: 0 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    
    // Verifica autenticazione
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push('/login');
      return;
    }

    // Recupera il piano utente
    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan')
      .eq('owner_id', session.user.id)
      .single();

    const plan = tenant?.plan || 'free';
    setUserPlan(plan);

    // Recupera stripe_connect_id dal profilo
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('user_id', session.user.id)
      .single();

    setStripeConnectId(profile?.stripe_connect_id || null);

    // Recupera il tenant_id dell'utente
    const { data: membershipData } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', session.user.id)
      .single();

    const tenantId = membershipData?.tenant_id;

    // Recupera gli slot del piano (per il Riepilogo Finanziario: quanti sono
    // usati/liberi sui slot totali acquistati con il piano PRO/Starter/Business)
    if (tenantId) {
      const { data: tenantSlots } = await supabase
        .from('tenants')
        .select('app_limit, total_apps_created')
        .eq('id', tenantId)
        .single();
      setSlotInfo({
        appLimit: tenantSlots?.app_limit || 0,
        totalCreated: tenantSlots?.total_apps_created || 0,
      });
    }

    // Recupera le app del tenant
    const { data: appsData, error: appsError } = await supabase
      .from('apps')
      .select('id, name, slug, app_type, totalum_app_id, stripe_connect_id, client_subscription_price, client_price, status, trial_ends_at, is_active, client_active, expires_at, client_email, created_at')
      .eq('tenant_id', tenantId || '')
      .order('created_at', { ascending: false });

    if (appsError) {
      setError(appsError.message);
    } else {
      setApps(appsData || []);
      // client_password non è più leggibile con la anon/authenticated key
      // (vedi migrazione lockdown_apps_password_columns): recuperata via RPC
      // SECURITY DEFINER che verifica la membership sul tenant.
      (appsData || []).forEach((a: App) => {
        supabase.rpc('get_app_client_credentials', { p_app_id: a.id }).then(({ data, error: rpcError }) => {
          if (rpcError || !data || !data[0]) return;
          setApps(prev => prev.map(x => x.id === a.id ? { ...x, client_password: data[0].client_password } : x));
        });
      });
      // Inizializza gli input dei prezzi con il prezzo realmente in vigore
      // (client_subscription_price || client_price || quota minima ZeusX),
      // non solo client_subscription_price: per le app appena create con
      // Creator AI quella colonna è 0.00 e mostrerebbe un prezzo sbagliato.
      const initialPrices: Record<string, string> = {};
      appsData?.forEach(app => {
        initialPrices[app.id] = getClientSubscriptionPrice(app).toString();
      });
      setPriceInputs(initialPrices);
    }

    setLoading(false);
  };

  const connectStripe = async () => {
    setConnectingStripe(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const response = await fetch('/api/user/stripe-connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || t('mgmt_err_stripe_connect'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mgmt_err_network'));
    } finally {
      setConnectingStripe(false);
    }
  };

  const updatePrice = async (appId: string, totalumAppId: string | null) => {
    const price = parseFloat(priceInputs[appId] || '0');

    // Validazione prezzo minimo per piano Starter
    if (userPlan === 'starter' && price < 25) {
      setError(t('mgmt_err_min_price_starter'));
      return;
    }

    setSavingPrice(prev => ({ ...prev, [appId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const response = await fetch('/api/user/update-price', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: appId,
          totalum_app_id: totalumAppId,
          client_subscription_price: price,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || t('mgmt_err_update_price'));
      } else {
        // Aggiorna lo stato locale
        setApps(prev => prev.map(app => 
          app.id === appId 
            ? { ...app, client_subscription_price: price } 
            : app
        ));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mgmt_err_network'));
    } finally {
      setSavingPrice(prev => ({ ...prev, [appId]: false }));
    }
  };

  const copyCheckoutLink = (totalumAppId: string | null) => {
    if (!totalumAppId) return;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const checkoutUrl = `${appUrl}/api/totalum-client/checkout?totalum_app_id=${totalumAppId}`;
    navigator.clipboard.writeText(checkoutUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('it-IT');
  };

  const getDaysRemaining = (trialEndsAt: string | null): number => {
    if (!trialEndsAt) return 0;
    const trialDate = new Date(trialEndsAt);
    const now = new Date();
    const diffTime = Math.abs(trialDate.getTime() - now.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getStatusBadge = (status: string | null) => {
    const styles = {
      trial: 'bg-yellow-500/20 text-yellow-300',
      active: 'bg-green-500/20 text-green-300',
      expired: 'bg-red-500/20 text-red-300',
      past_due: 'bg-orange-500/20 text-orange-300',
      canceled: 'bg-gray-500/20 text-gray-300',
    };
    const labels = {
      trial: t('mgmt_status_trial'),
      active: t('mgmt_status_active'),
      expired: t('mgmt_status_expired'),
      past_due: t('mgmt_status_past_due'),
      canceled: t('mgmt_status_canceled'),
    };
    return (
      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-400">{t('mgmt_loading')}</p>
        </div>
      </div>
    );
  }

  // Riepilogo Finanziario: solo le app 'active' generano incasso reale e
  // quota ZeusX (25€/mese ciascuna, la quota minima trattenuta via Stripe
  // Connect — vedi lib/pricing.ts). Le app in trial non hanno ancora un
  // cliente pagante, quindi non contano né come incasso né come costo.
  const activeApps = apps.filter((a) => a.status === 'active');
  const expiredApps = apps.filter((a) => a.status === 'expired' || a.status === 'past_due' || a.status === 'canceled');
  const totalRevenue = activeApps.reduce((sum, a) => sum + getClientSubscriptionPrice(a), 0);
  const totalZeusxFee = activeApps.length * ZEUSX_MINIMUM_FEE_EUR;
  const netMargin = totalRevenue - totalZeusxFee;
  const freeSlots = Math.max(0, slotInfo.appLimit - slotInfo.totalCreated);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">{t('mgmt_title')}</h1>
        <p className="text-gray-400 mt-1 text-sm sm:text-base">{t('mgmt_subtitle')}</p>
      </div>

      {/* Riepilogo Finanziario */}
      <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
        <h2 className="text-lg font-semibold text-white mb-3 sm:mb-4">{t('mgmt_financial_summary')}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide mb-1.5">
              <Wallet size={14} /> {t('mgmt_client_revenue')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {totalRevenue.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
              <span className="text-xs font-normal text-gray-500">{t('mgmt_per_month')}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">{activeApps.length} {t('mgmt_active_apps_suffix')}</div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide mb-1.5">
              <CreditCard size={14} /> {t('mgmt_zeusx_fees')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {totalZeusxFee.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
              <span className="text-xs font-normal text-gray-500">{t('mgmt_per_month')}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">{ZEUSX_MINIMUM_FEE_EUR}€ × {activeApps.length} {t('mgmt_active_apps_suffix')}</div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide mb-1.5">
              <TrendingUp size={14} /> {t('mgmt_net_margin')}
            </div>
            <div className={`text-xl sm:text-2xl font-bold ${netMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {netMargin.toLocaleString('it-IT', { minimumFractionDigits: 2 })} €
              <span className="text-xs font-normal text-gray-500">{t('mgmt_per_month')}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('mgmt_net_margin_desc')}</div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs uppercase tracking-wide mb-1.5">
              <LayoutGrid size={14} /> {t('mgmt_slot_status')}
            </div>
            <div className="text-xl sm:text-2xl font-bold text-white">
              {slotInfo.totalCreated} <span className="text-xs font-normal text-gray-500">/ {slotInfo.appLimit}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {activeApps.length} {t('mgmt_slot_active')} · {expiredApps.length} {t('mgmt_slot_expired')} · {freeSlots} {t('mgmt_slot_free')}
            </div>
          </div>
        </div>
      </div>

      {/* Box Configurazione Stripe Connect */}
      <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
        <h2 className="text-lg font-semibold text-white mb-3 sm:mb-4">{t('mgmt_stripe_config_title')}</h2>

        {stripeConnectId ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-green-500/20 text-green-300">
              {t('mgmt_stripe_configured')}
            </span>
            <span className="text-gray-400 text-sm">
              {t('mgmt_stripe_account_id')}: {stripeConnectId}
            </span>
          </div>
        ) : (
          <div>
            <p className="text-yellow-400 mb-3 sm:mb-4 text-sm">
              {t('mgmt_stripe_configure_desc')}
            </p>
            <button
              onClick={connectStripe}
              disabled={connectingStripe}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              <CreditCard size={16} />
              {connectingStripe ? t('mgmt_stripe_connecting') : t('mgmt_stripe_connect_button')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 text-red-300 p-3 sm:p-4 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Tabella App - Responsive */}
      <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl overflow-hidden">
        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {t('mgmt_th_name')}
                </th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {t('mgmt_th_status')}
                </th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {t('mgmt_th_price')}
                </th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {t('mgmt_th_trial_days')}
                </th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {t('mgmt_th_actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-slate-900/40 divide-y divide-slate-800">
              {apps.map((app) => (
                <tr key={app.id} className={app.id === highlightAppId ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/40' : undefined}>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => router.push(`/dashboard/projects/${app.id}`)}
                      className="text-purple-400 hover:text-purple-300 hover:underline transition-colors text-left"
                    >
                      {app.name}
                    </button>
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                    {getStatusBadge(app.status)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={priceInputs[app.id] || ''}
                        onChange={(e) => setPriceInputs(prev => ({ ...prev, [app.id]: e.target.value }))}
                        className="w-20 px-2 py-1 bg-slate-800 text-white rounded border border-slate-700 text-sm"
                        placeholder="0.00"
                      />
                      <span className="text-gray-400">€</span>
                      <button
                        onClick={() => updatePrice(app.id, app.totalum_app_id)}
                        disabled={savingPrice[app.id]}
                        className="px-2 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {savingPrice[app.id] ? '...' : t('mgmt_save')}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-sm text-gray-400">
                    {getDaysRemaining(app.trial_ends_at)} {t('mgmt_days_suffix')}
                  </td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                      {app.totalum_app_id && (
                        <button
                          onClick={() => copyCheckoutLink(app.totalum_app_id)}
                          className="px-3 py-1 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center gap-1"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {t('mgmt_checkout_link')}
                        </button>
                      )}
                      {app.app_type === 'comandi_ai' && app.slug ? (
                        <a
                          href={`/a/${app.slug}`}
                          className="px-3 py-1 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center gap-1"
                        >
                          <Settings size={14} />
                          {t('mgmt_go')}
                        </a>
                      ) : (
                        <a
                          href={`/dashboard/projects/${app.id}`}
                          className="px-3 py-1 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center gap-1"
                        >
                          <Settings size={14} />
                          {t('mgmt_details')}
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden divide-y divide-slate-800">
          {apps.map((app) => (
            <div key={app.id} className={`p-4 space-y-3 ${app.id === highlightAppId ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/40' : ''}`}>
              <div className="flex justify-between items-start">
                <div>
                  <button
                    onClick={() => router.push(`/dashboard/projects/${app.id}`)}
                    className="text-purple-400 hover:text-purple-300 hover:underline text-left font-medium text-sm"
                  >
                    {app.name}
                  </button>
                </div>
                {getStatusBadge(app.status)}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs">{t('mgmt_th_price')}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs[app.id] || ''}
                    onChange={(e) => setPriceInputs(prev => ({ ...prev, [app.id]: e.target.value }))}
                    className="w-16 px-2 py-1 bg-slate-800 text-white rounded border border-slate-700 text-sm"
                    placeholder="0.00"
                  />
                  <span className="text-gray-400 text-xs">€</span>
                  <button
                    onClick={() => updatePrice(app.id, app.totalum_app_id)}
                    disabled={savingPrice[app.id]}
                    className="px-2 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingPrice[app.id] ? '...' : t('mgmt_save')}
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-xs">{t('mgmt_th_trial_days')}</span>
                <span className="text-gray-400 text-xs">{getDaysRemaining(app.trial_ends_at)} {t('mgmt_days_suffix')}</span>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                {app.totalum_app_id && (
                  <button
                    onClick={() => copyCheckoutLink(app.totalum_app_id)}
                    className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center justify-center gap-1"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {t('mgmt_checkout_link')}
                  </button>
                )}
                {app.app_type === 'comandi_ai' && app.slug ? (
                  <a
                    href={`/a/${app.slug}`}
                    className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center justify-center gap-1"
                  >
                    <Settings size={14} />
                    {t('mgmt_go')}
                  </a>
                ) : (
                  <a
                    href={`/dashboard/projects/${app.id}`}
                    className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-600 flex items-center justify-center gap-1"
                  >
                    <Settings size={14} />
                    {t('mgmt_details')}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {apps.length === 0 && (
          <div className="p-4 sm:p-6 text-center text-gray-400 text-sm">
            {t('mgmt_no_apps')}
          </div>
        )}
      </div>
    </div>
  );
}