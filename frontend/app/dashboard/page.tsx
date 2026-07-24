"use client";

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

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

  const coreFeatures = [
    { 
      title: t('dashboard_create_app_title'),
      desc: t('dashboard_create_app_desc'),
      link: "/dashboard/creator",
      color: "bg-gradient-to-br from-indigo-600 to-purple-600",
      icon: "✨",
      highlighted: true
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
      title: t('dashboard_comandi_title'),
      desc: t('dashboard_comandi_desc'),
      link: "/dashboard/comandi",
      color: "bg-gradient-to-br from-amber-600 to-orange-600",
      icon: "🎙️",
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
    { 
      title: t('dashboard_showcase_title'), 
      desc: t('dashboard_showcase_subtitle'),
      link: "/dashboard/showcase", 
      color: "bg-gradient-to-br from-indigo-500 to-purple-600",
      icon: "🚀",
      highlighted: false,
    },
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

  const utilityFeatures = [
    { title: t('dashboard_chat_title'), desc: t('dashboard_chat_desc'), link: "/dashboard/chat", color: "bg-cyan-600", icon: "" },
    { title: t('dashboard_stats_title'), desc: t('dashboard_stats_desc'), link: "/dashboard/stats", color: "bg-purple-600", icon: "📊" },
    { title: t('dashboard_settings_title'), desc: t('dashboard_settings_desc'), link: "/dashboard/settings", color: "bg-gray-600", icon: "" },
  ];

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
                <div className={`w-24 h-24 ${item.color} rounded-xl mb-6 flex items-center justify-center shadow-lg`}>
                  <span className="text-4xl">{item.icon}</span>
                </div>
                <h2 className="text-xl font-bold mb-2">{item.title}</h2>
                <p className="text-gray-400 mb-6 flex-1">{item.desc}</p>
                <span className="text-blue-400 font-semibold group-hover:underline">{t('dashboard_card_access')}</span>
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