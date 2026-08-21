"use client";

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';

// Fonte autoritativa per la sincronizzazione del piano dopo il checkout
// Stripe: il backend Express (unico registrato come webhook endpoint per gli
// eventi subscription.updated/deleted e payment_failed, oltre a
// checkout.session.completed — vedi backend/routes/stripe.js). Anche
// SuccessContent.tsx chiama questa stessa route, per evitare la duplicazione
// con contratti diversi (sessionId vs session_id) che c'era prima qui.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://shardapps-backend.onrender.com';

function SyncPlanBanner() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    async function syncPlan() {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) return;

      const { data: { session } } = await supabaseBrowser.auth.getSession();
      let token = session?.access_token;
      if (!token) return;

      try {
        const res = await fetch(`${BACKEND_URL}/api/sync-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.paid) {
          setSyncMessage(t('dashboard_plan_activated').replace('{plan}', data.plan.toUpperCase()));
        } else if (!data.paid) {
          setSyncMessage(t('dashboard_plan_not_completed'));
        } else {
          setSyncMessage(t('dashboard_plan_error'));
        }
      } catch (err) {
        console.error('[Dashboard] sync-plan error:', err);
      } finally {
        // Rimuove session_id dall'URL una volta sincronizzato: senza questo,
        // ricaricare la pagina (o tornare indietro nella cronologia) rilancia
        // la sincronizzazione con la stessa sessione Stripe già esaurita a
        // ogni visita, rischiando di sovrascrivere il piano corretto.
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    syncPlan();
  }, [searchParams, t]);

  if (!syncMessage) return null;

  return (
    <div className="max-w-6xl mx-auto mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-center font-medium">
      {syncMessage}
    </div>
  );
}

export default function DashboardPage() {
  const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
  const [chatInput, setChatInput] = useState('');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [visionCredits, setVisionCredits] = useState<number | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const user = session?.user;
      console.log('[Dashboard] User ID:', user?.id);
      console.log('[Dashboard] Admin ID:', ADMIN_USER_ID);
      console.log('[Dashboard] Is Admin:', user?.id === ADMIN_USER_ID);
      setIsAdmin(user?.id === ADMIN_USER_ID);
    }
    checkAdmin();
  }, []);

  // Saldo crediti Vision per la card dashboard: letto direttamente (RLS
  // "profiles_select_own" consente all'utente di leggere solo la propria riga)
  // e tenuto sincronizzato in tempo reale così la card riflette subito ogni
  // addebito/rimborso avvenuto in /vision o altrove.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabaseBrowser.channel> | null = null;

    async function loadCredits() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const userId = session?.user?.id;
      if (!userId || cancelled) return;

      const { data } = await supabaseBrowser
        .from('profiles')
        .select('credits')
        .eq('user_id', userId)
        .single();

      if (cancelled) return;
      if (data) setVisionCredits(data.credits ?? 0);

      const topic = `dashboard-credits-${userId}`;
      // supabase-js RIUSA un canale già esistente con lo stesso topic invece
      // di crearne uno nuovo: in dev, il doppio invoke degli effect in React
      // Strict Mode fa sì che la seconda chiamata a .channel(topic) recuperi
      // il canale già sottoscritto dalla prima, e il successivo .on() fallisca
      // con "cannot add postgres_changes callbacks ... after subscribe()".
      // Rimuoviamo qualunque canale residuo con lo stesso topic prima di
      // crearne uno nuovo, per essere sicuri di partire sempre da uno pulito.
      const stale = supabaseBrowser.getChannels().find((c) => c.topic === `realtime:${topic}`);
      if (stale) await supabaseBrowser.removeChannel(stale);
      if (cancelled) return;

      channel = supabaseBrowser
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${userId}` },
          (payload) => setVisionCredits((payload.new as { credits: number }).credits ?? 0)
        )
        .subscribe();
    }

    loadCredits();
    return () => {
      cancelled = true;
      if (channel) supabaseBrowser.removeChannel(channel);
    };
  }, []);

  const coreFeatures: Array<{
    title: string;
    desc: string;
    link: string;
    color: string;
    icon: string;
    highlighted: boolean;
    showCredits?: boolean;
  }> = [
    {
      title: t('dashboard_create_app_title'),
      desc: t('dashboard_create_app_desc'),
      link: "/dashboard/creator",
      color: "bg-gradient-to-br from-indigo-600 to-purple-600",
      icon: "✨",
      highlighted: true
    },
    // Vision Studio subito dopo Creator AI (non in fondo all'elenco): sono i
    // due strumenti di generazione principali e la griglia a 3 colonne li
    // mette automaticamente fianco a fianco su desktop e in sequenza diretta
    // su mobile, senza bisogno di una struttura a griglia separata.
    {
      title: t('dashboard_vision_title'),
      desc: t('dashboard_vision_desc'),
      link: "/vision",
      color: "bg-gradient-to-br from-fuchsia-600 to-indigo-600",
      icon: "🎬",
      highlighted: true,
      showCredits: true,
    },
    {
      title: t('dashboard_catalog_title'),
      desc: t('dashboard_catalog_desc'),
      link: "/dashboard/catalog",
      color: "bg-gradient-to-br from-amber-600 to-orange-600",
      icon: "🛍️",
      highlighted: false
    },
    {
      title: t('dashboard_projects_title'),
      desc: t('dashboard_projects_desc'),
      link: "/dashboard/projects",
      color: "bg-blue-600",
      icon: "📁",
      highlighted: false
    },
    {
      title: t('dashboard_agenda_title'),
      desc: t('dashboard_agenda_desc'),
      link: "/dashboard/vision",
      color: "bg-emerald-600",
      icon: "📅",
      highlighted: false
    },
    // Card "Demo App" (Showcase) rimossa dalla dashboard su richiesta — la
    // route /dashboard/showcase e lib/demoApps.ts restano invariate (nessuna
    // pagina cancellata, solo non più linkata da qui), così un eventuale
    // accesso diretto all'URL continua a funzionare invariato.
  ];

  // Card admin visibile solo per il tuo account
  if (isAdmin === true) {
    coreFeatures.push({
      title: t('dashboard_admin_title'),
      desc: t('dashboard_admin_desc'),
      link: "/admin",
      color: "bg-gradient-to-br from-red-600 to-orange-600",
      icon: "👑",
      highlighted: false,
    });
  }

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      window.location.href = `/dashboard/chat?q=${encodeURIComponent(chatInput.trim())}`;
    }
  };

    return (
    <div className="p-8">
      <Suspense fallback={null}>
        <SyncPlanBanner />
      </Suspense>

      {/* Core Business Features */}
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {coreFeatures.map((item, index) => (
            <Link href={item.link} key={index} className="group">
              <div className={`h-full p-8 rounded-2xl border transition-all hover:scale-105 flex flex-col ${
                item.highlighted 
                  ? 'border-indigo-500/50 bg-gradient-to-br from-indigo-950/50 to-purple-950/50 shadow-lg shadow-indigo-500/20' 
                  : 'border-gray-800 bg-gray-900 hover:border-gray-500'
              }`}>
                <div className="flex items-start justify-between mb-6">
                  <div className={`w-24 h-24 ${item.color} rounded-xl flex items-center justify-center shadow-lg`}>
                    <span className="text-4xl">{item.icon}</span>
                  </div>
                  {item.showCredits && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-300">
                      ⚡ {visionCredits === null ? '…' : visionCredits} {t('dashboard_vision_credits')}
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-bold mb-2">{item.title}</h2>
                <p className="text-gray-400 mb-6 flex-1">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>


        {/* Chat AI Bar */}
        <div className="pt-8">
          <form onSubmit={handleChatSubmit} className="max-w-4xl mx-auto">
            <div className="relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t('dashboard_chat_placeholder')}
                className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-6 py-5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-lg"
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 py-3 font-semibold transition-all"
              >
                {t('dashboard_chat_button')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}