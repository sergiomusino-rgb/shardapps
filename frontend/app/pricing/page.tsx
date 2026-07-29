'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser as supabase } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';

export default function PricingPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const [slotsUsed, setSlotsUsed] = useState(0);
  const [slotsTotal, setSlotsTotal] = useState(0);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
      if (session?.user?.id) {
        loadCurrentPlan(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
      if (session?.user?.id) {
        loadCurrentPlan(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Saldo crediti Vision in tempo reale: stesso pattern usato in dashboard/
  // page.tsx e vision/page.tsx (guardia anti-duplicato sul topic del canale,
  // necessaria perché supabase-js riusa un canale già sottoscritto con lo
  // stesso nome invece di crearne uno nuovo).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadCredits() {
      const { data } = await supabase
        .from('profiles')
        .select('credits')
        .eq('user_id', userId as string)
        .single();

      if (cancelled) return;
      setCredits(data?.credits ?? 0);

      const topic = `pricing-credits-${userId}`;
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
      if (stale) await supabase.removeChannel(stale);
      if (cancelled) return;

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${userId}` },
          (payload) => setCredits((payload.new as { credits: number }).credits ?? 0)
        )
        .subscribe();
    }

    loadCredits();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  async function loadCurrentPlan(userId: string) {
    try {
      const { data: memberships } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1) as any;

      if (memberships?.[0]?.tenant_id) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('plan, app_limit, total_apps_created')
          .eq('id', memberships[0].tenant_id)
          .single() as any;

        if (tenant) {
          setCurrentPlan(tenant.plan || 'free');
          setSlotsTotal(tenant.app_limit ?? 1);
          setSlotsUsed(tenant.total_apps_created || 0);
        }
      }
    } catch (err) {
      console.error('Error loading plan:', err);
    } finally {
      setLoading(false);
    }
  }

  const plans = [
    {
      id: 'starter',
      name: 'STARTER',
      setupPrice: '10',
      monthlyFee: '25',
      slots: '1',
      credits: '20',
      features: [
        t('pricing_slots_included_singular'),
        `20 ${t('pricing_credits_included')}`,
        t('pricing_per_app').replace('{fee}', '25€') + ' (dopo 1 mese gratis)',
        'Supporto email'
      ],
      priceId: 'price_1Ty8ZPRZR2YaFu2s8aFmA4Az',
      highlighted: false,
    },
    {
      id: 'pro',
      name: 'PRO',
      setupPrice: '79',
      monthlyFee: '25',
      slots: '5',
      credits: '100',
      features: [
        '5 ' + t('pricing_slots_included'),
        `100 ${t('pricing_credits_included')}`,
        t('pricing_per_app').replace('{fee}', '25€'),
        'Supporto prioritario',
        'API illimitate'
      ],
      priceId: 'price_1TyX0yRZR2YaFu2s1nKkKHVw',
      highlighted: true,
    },
    {
      id: 'business',
      name: 'BUSINESS',
      setupPrice: '299',
      monthlyFee: '25',
      slots: '50',
      credits: '500',
      features: [
        '50 ' + t('pricing_slots_included'),
        `500 ${t('pricing_credits_included')}`,
        t('pricing_per_app').replace('{fee}', '25€'),
        'Supporto dedicato 24/7',
        'API illimitate',
        'SLA garantito'
      ],
      priceId: 'price_1TyX0yRZR2YaFu2s4veOZc6r',
      highlighted: false,
    },
  ];

  function getAccessTokenFromStorage(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          return parsed?.access_token || parsed?.[0] || null;
        }
      }
    } catch {}
    return null;
  }

  const handleUpgrade = async (planId: string, quantity: number = 1) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || getAccessTokenFromStorage();

    if (!token || !session?.user) {
      window.location.href = '/login';
      return;
    }

    let priceId: string | undefined;
    if (planId === 'credit_topup') {
      // Nome storico della env var (era "Slot Extra"): stesso Price Stripe da
      // 15€, cambia solo cosa viene accreditato lato webhook (crediti invece
      // di uno slot app), quindi resta invariata.
      priceId = process.env.NEXT_PUBLIC_EXTRA_SLOT_PRICE_ID || undefined;
      if (!priceId) {
        alert(t('pricing_error_no_topup'));
        return;
      }
    } else {
      const selectedPlan = plans.find(p => p.id === planId);
      if (!selectedPlan) return;
      priceId = selectedPlan.priceId;
    }
    if (!priceId) return;

    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          priceId,
          planId: planId,
          quantity: quantity
        }),
      });

      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        alert(t('projects_error_delete') + (data.error || t('pricing_error_session')));
      }
    } catch (err) {
      console.error("Errore di rete:", err);
      alert(t('pricing_error_connection'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">{t('pricing_loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-12">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-5xl font-black text-center mb-4">{t('pricing_title')}</h1>
        <p className="text-center text-slate-400 mb-12 text-lg">
          {t('pricing_subtitle')}
        </p>

        {/* Info piano attuale */}
        {userId && (
          <div className="mb-12 p-6 bg-slate-900 rounded-2xl border border-slate-800">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">{t('pricing_current_plan')}</h3>
                {currentPlan === 'free' ? (
                  <p className="text-slate-400">
                    <span className="text-indigo-400 font-bold uppercase">{t('pricing_no_plan_title')}</span>
                  </p>
                ) : (
                  <p className="text-slate-400">
                    {t('pricing_current_plan_label')} <span className="text-indigo-400 font-bold uppercase">{currentPlan}</span>
                    {' • '}
                    {slotsUsed} / {slotsTotal} {t('pricing_slots_used')}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-start gap-3 md:items-end">
                <div className="flex items-center gap-2">
                  <div className="w-64 h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                      style={{ width: `${(slotsUsed / slotsTotal) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-400">
                    {slotsTotal - slotsUsed} {t('pricing_slots_available')}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-1.5">
                  <span className="text-amber-400">⚡</span>
                  <span className="font-bold text-white tabular-nums">{credits === null ? '…' : credits}</span>
                  <span className="text-sm text-slate-400">{t('pricing_your_credits_balance')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan) => {
            const isCurrentPlan = currentPlan === plan.id;
            return (
              <div 
                key={plan.id}
                className={`relative p-8 rounded-2xl border transition-all flex flex-col ${
                  isCurrentPlan
                    ? 'border-emerald-500 bg-gradient-to-br from-emerald-950/30 to-green-950/30 shadow-2xl shadow-emerald-500/20' 
                    : plan.highlighted 
                    ? 'border-indigo-500 bg-gradient-to-br from-indigo-950/50 to-purple-950/50 shadow-2xl shadow-indigo-500/20' 
                    : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                }`}
              >
                {isCurrentPlan && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-600 px-4 py-1 rounded-full text-sm font-bold">
                    {t('pricing_your_plan')}
                  </div>
                )}
                {!isCurrentPlan && plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-600 px-4 py-1 rounded-full text-sm font-bold">
                    {t('pricing_most_popular')}
                  </div>
                )}

                <h2 className="text-3xl font-black mb-4">{plan.name}</h2>
                
                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold">€{plan.setupPrice}</span>
                    <span className="text-slate-400">{t('pricing_setup')}</span>
                  </div>
                  <div className="text-sm text-slate-400 mt-2">
                    + {plan.monthlyFee}€/mese per app attiva
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <div className="text-sm font-semibold text-slate-300 mb-1">
                      {plan.slots} {t('pricing_slots')} {plan.id === 'starter' ? t('pricing_slots_included_singular') : t('pricing_slots_included')}
                    </div>
                    <div className="text-xs text-slate-400">
                      {t('pricing_create_up_to')} {plan.slots} {plan.id === 'starter' ? t('pricing_app_singular') : t('pricing_apps_plural')}
                    </div>
                  </div>
                  <div className="p-4 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-xl">
                    <div className="text-sm font-semibold text-fuchsia-300 mb-1">
                      ⚡ {plan.credits} {t('pricing_credits')}
                    </div>
                    <div className="text-xs text-slate-400">
                      {t('pricing_credits_desc')}
                    </div>
                  </div>
                </div>

                <ul className="space-y-3 flex-grow">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                      <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !(plan.id === 'starter' && isCurrentPlan) && handleUpgrade(plan.id)}
                  disabled={plan.id === 'starter' && isCurrentPlan}
                  className={`w-full py-4 rounded-xl font-bold transition-all mt-6 ${
                    plan.id === 'starter' && isCurrentPlan
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : plan.id === 'business'
                      ? 'bg-amber-600 hover:bg-amber-500 text-white'
                      : plan.highlighted
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-white'
                  }`}
                >
                  {plan.id === 'starter' && isCurrentPlan ? t('pricing_included') : isCurrentPlan ? t('pricing_buy_again') : t('pricing_buy')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Ricarica Extra (crediti Vision) */}
        {userId && (
          <div className="mt-12 p-8 bg-gradient-to-br from-fuchsia-950/30 to-indigo-950/30 rounded-2xl border border-fuchsia-800/50">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h3 className="text-2xl font-bold text-fuchsia-400 mb-2">⚡ {t('pricing_credit_topup_title')}</h3>
                <p className="text-slate-400">
                  {t('pricing_credit_topup_desc')}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-white">€15</div>
                  <div className="text-sm text-slate-400">{t('pricing_per_credit_topup')}</div>
                </div>
                <button
                  onClick={() => handleUpgrade('credit_topup', 1)}
                  className="px-6 py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold rounded-xl transition-all"
                >
                  {t('pricing_add_credits')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info fee mensili */}
        <div className="mt-16 p-8 bg-slate-900 rounded-2xl border border-slate-800">
          <h3 className="text-2xl font-bold mb-4">{t('pricing_billing_title')}</h3>
          <div className="grid md:grid-cols-3 gap-6 text-sm text-slate-400">
            <div>
              <div className="font-semibold text-white mb-2">{t('pricing_billing_setup')}</div>
              <p>{t('pricing_billing_setup_desc')}</p>
            </div>
            <div>
              <div className="font-semibold text-white mb-2">{t('pricing_billing_monthly')}</div>
              <p>{t('pricing_billing_monthly_desc')}</p>
            </div>
            <div>
              <div className="font-semibold text-white mb-2">{t('pricing_billing_credits')}</div>
              <p>{t('pricing_billing_credits_desc')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}