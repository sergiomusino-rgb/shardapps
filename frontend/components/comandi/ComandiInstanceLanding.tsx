'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mic, Package, Share2 } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { usePwaSetup } from '@/hooks/usePwaSetup';
import { COMANDI_PWA_THEME_COLOR, COMANDI_PWA_APPLE_TOUCH_ICON, COMANDI_PWA_APP_NAME } from '@/src/lib/comandi-pwa';
import InstallAppBanner from '@/components/InstallAppBanner';
import LanguageSelector from '@/components/LanguageSelector';

export interface ComandiInstanceLandingProps {
  slug: string;
}

// Landing pubblica per una singola istanza Comandi AI provisionata da slot
// (app/a/[slug]/page.tsx quando app_type === 'comandi_ai'). Stessi contenuti
// della landing standalone /comandi (stesse chiavi i18n comandi_landing_*).
// Pagina statica, senza controllo di sessione: un solo CTA "Inizia" verso il
// login. Una volta autenticato, l'operatore atterra direttamente in cassa
// (vedi app/a/[slug]/login/page.tsx), da cui la dashboard di gestione resta
// comunque raggiungibile tramite il menu nella console operativa.
export default function ComandiInstanceLanding({ slug }: ComandiInstanceLandingProps) {
  const { t } = useLanguage();

  // Icona e nome dell'app installabile: quelli caricati dal titolare in
  // Azienda (tenants.logo_url / name), non il brand fisso "Comand AI" — chi
  // installa dalla landing pubblica deve vedere l'identità della propria
  // azienda, non quella del reseller. Fetch pubblico dedicato (nessuna
  // sessione qui, la landing precede il login): la tabella tenants non è
  // leggibile da anonimi (RLS). Fallback sui valori fissi finché il fetch
  // non risolve o se l'azienda non ha ancora caricato un logo/nome.
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/a/${slug}/comandi-branding`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { name?: string | null; logoUrl?: string | null } | null) => {
        if (cancelled || !data) return;
        setCompanyName(data.name || '');
        setCompanyLogoUrl(data.logoUrl || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const pwaAppName = companyName || COMANDI_PWA_APP_NAME;
  usePwaSetup(slug, COMANDI_PWA_THEME_COLOR, companyLogoUrl || COMANDI_PWA_APPLE_TOUCH_ICON, pwaAppName);

  const features = [
    {
      icon: Mic,
      title: t('comandi_landing_feature_voice_title'),
      desc: t('comandi_landing_feature_voice_desc'),
    },
    {
      icon: Share2,
      title: t('comandi_landing_feature_share_title'),
      desc: t('comandi_landing_feature_share_desc'),
    },
    {
      icon: Package,
      title: t('comandi_landing_feature_catalog_title'),
      desc: t('comandi_landing_feature_catalog_desc'),
    },
  ];

  return (
    <div className="bg-slate-950 text-white min-h-screen w-full font-sans relative overflow-x-hidden">
      <div className="absolute top-6 right-6 z-30">
        <LanguageSelector />
      </div>

      <main className="flex flex-col items-center px-6 pb-24">
        <section className="max-w-4xl w-full text-center flex flex-col items-center gap-6 pt-16">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-tight">
            Comand<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
          </h1>

          <div className="px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur">
            <p className="text-sm text-amber-400 font-semibold">{t('comandi_landing_tagline')}</p>
          </div>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl font-light leading-relaxed">
            {t('comandi_landing_hero_subtitle')}
          </p>

          <Link
            href={`/a/${slug}/login`}
            className="mt-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition-colors"
          >
            {t('comandi_instance_cta_start')}
          </Link>
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

      <InstallAppBanner
        appName={pwaAppName}
        slug={slug}
        primaryColor={COMANDI_PWA_THEME_COLOR}
        textColor="#ffffff"
        surfaceColor="#0f172a"
        borderColor="#1e293b"
      />
    </div>
  );
}
