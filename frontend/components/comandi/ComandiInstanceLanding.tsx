'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Loader2, Mic, Package, ShoppingCart } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';

export interface ComandiInstanceLandingProps {
  slug: string;
  appName?: string;
  tenantId: string;
}

type AuthState = 'checking' | 'authenticated' | 'anonymous';

// Landing pubblica per una singola istanza Comandi AI provisionata da slot
// (app/a/[slug]/page.tsx quando app_type === 'comandi_ai'). Stessi contenuti
// della landing standalone /comandi (stesse chiavi i18n comandi_landing_*).
// Se l'utente è già autenticato e membro del tenant proprietario, mostra le
// azioni dirette (Cassa/Dashboard) invece del CTA di accesso: il login non
// deve più forzare l'ingresso diretto in cassa, atterra qui.
export default function ComandiInstanceLanding({ slug, appName, tenantId }: ComandiInstanceLandingProps) {
  const { t } = useLanguage();
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session?.user) {
        setAuthState('anonymous');
        return;
      }

      const { data: membership } = await supabase
        .from('tenant_members' as any)
        .select('tenant_id')
        .eq('user_id', session.user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (cancelled) return;
      setAuthState(membership ? 'authenticated' : 'anonymous');
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const features = [
    {
      icon: Mic,
      title: t('comandi_landing_feature_voice_title'),
      desc: t('comandi_landing_feature_voice_desc'),
    },
    {
      icon: ShoppingCart,
      title: t('comandi_landing_feature_pos_title'),
      desc: t('comandi_landing_feature_pos_desc'),
    },
    {
      icon: Package,
      title: t('comandi_landing_feature_catalog_title'),
      desc: t('comandi_landing_feature_catalog_desc'),
    },
  ];

  return (
    <div className="bg-slate-950 text-white min-h-screen w-full font-sans">
      <header className="pt-10 pb-4 flex justify-center">
        <span className="text-4xl md:text-5xl font-black tracking-tighter text-white">
          Comandi<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
        </span>
      </header>

      <main className="flex flex-col items-center px-6 pb-24">
        <section className="max-w-4xl w-full text-center flex flex-col items-center gap-6 pt-8">
          <div className="px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur">
            <p className="text-sm text-amber-400 font-semibold">{appName || t('comandi_landing_tagline')}</p>
          </div>

          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">
            {t('comandi_landing_hero_title')}
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl font-light leading-relaxed">
            {t('comandi_landing_hero_subtitle')}
          </p>

          {authState === 'checking' && (
            <div className="mt-4 h-[52px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
            </div>
          )}

          {authState === 'anonymous' && (
            <Link
              href={`/a/${slug}/login`}
              className="mt-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition-colors"
            >
              {t('comandi_landing_cta_login')}
            </Link>
          )}

          {authState === 'authenticated' && (
            <div className="mt-4 flex flex-col sm:flex-row gap-4">
              <Link
                href={`/a/${slug}/app`}
                className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition-colors"
              >
                <Mic className="w-4 h-4" />
                {t('comandi_instance_cta_checkout')}
              </Link>
              <Link
                href={`/a/${slug}/dashboard`}
                className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold px-8 py-4 rounded-xl text-center transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                {t('comandi_instance_cta_dashboard')}
              </Link>
            </div>
          )}
        </section>

        <section className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-6 mt-20">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur p-6 flex flex-col items-center text-center gap-3"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center shadow-lg">
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
