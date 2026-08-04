'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Bot, Video, Share2, Smartphone, CreditCard, ShieldCheck } from 'lucide-react';

interface LandingFeature {
  icon: typeof Bot;
  color: string;
  title: string;
  desc: string;
}

type TFunction = (key: string) => string;

function getLeftFeatures(t: TFunction): LandingFeature[] {
  return [
    {
      icon: Bot,
      color: 'cyan',
      title: t('landing_feature_comandi_title'),
      desc: t('landing_feature_comandi_desc'),
    },
    {
      icon: Video,
      color: 'purple',
      title: t('landing_feature_vision_title'),
      desc: t('landing_feature_vision_desc'),
    },
    {
      icon: Share2,
      color: 'emerald',
      title: t('landing_feature_reselling_title'),
      desc: t('landing_feature_reselling_desc'),
    },
  ];
}

function getRightFeatures(t: TFunction): LandingFeature[] {
  return [
    {
      icon: Smartphone,
      color: 'blue',
      title: t('landing_feature_pwa_title'),
      desc: t('landing_feature_pwa_desc'),
    },
    {
      icon: CreditCard,
      color: 'indigo',
      title: t('landing_feature_stripe_title'),
      desc: t('landing_feature_stripe_desc'),
    },
    {
      icon: ShieldCheck,
      color: 'cyan',
      title: t('landing_feature_isolation_title'),
      desc: t('landing_feature_isolation_desc'),
    },
  ];
}

const COLOR_MAP: Record<string, string> = {
  cyan: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]',
  purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.3)]',
  emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
  blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.3)]',
  indigo: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.3)]',
};

function FeatureCard({ f }: { f: LandingFeature }) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 backdrop-blur-xl p-4">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-2 ${COLOR_MAP[f.color]}`}>
        <f.icon className="w-5 h-5" />
      </div>
      <h3 className="font-bold text-white text-sm mb-1">{f.title}</h3>
      <p className="text-xs text-slate-400 leading-snug">{f.desc}</p>
    </div>
  );
}

export default function Home() {
  const { t } = useLanguage();
  const leftFeatures = useMemo(() => getLeftFeatures(t), [t]);
  const rightFeatures = useMemo(() => getRightFeatures(t), [t]);

  return (
    <div className="h-screen overflow-y-auto w-full font-sans relative text-white">

      {/* SFONDO TECNO (FOTO) CON OVERLAY SCURO PER LEGGIBILITÀ */}
      <div className="fixed inset-0 -z-10 bg-[#03060D] overflow-hidden">
        <img
          src="/hero-tech-background.jpg"
          alt=""
          className="w-full h-full object-cover scale-125"
          style={{ filter: 'brightness(1.35) saturate(1.25) contrast(1.05)' }}
        />
        <div className="absolute inset-0 bg-[#03060D]/70" />
      </div>

      {/* Selettore lingua (test infrastruttura i18n zero-impatto) + schermo intero */}
      <div className="fixed top-6 right-6 z-30 flex items-center gap-2">
        <FullscreenToggle color="#ffffff" hoverBackground="rgba(255,255,255,0.12)" />
        <LanguageSelector />
      </div>

      <div className="h-full flex flex-col justify-between">

        {/* HEADER */}
        <header className="pt-10 pb-4 flex justify-center shrink-0">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-white">
            ZEUS<span className="text-indigo-500">X</span>
          </h1>
        </header>

        {/* HERO + FUNZIONI A 3 COLONNE */}
        <main className="flex-1 min-h-0 px-6 flex items-center">
          <div className="max-w-[1800px] mx-auto w-full grid lg:grid-cols-[240px_1fr_240px] gap-12 items-center">

            {/* COLONNA SINISTRA */}
            <div className="hidden lg:block space-y-3">
              {leftFeatures.map((f) => (
                <FeatureCard key={f.title} f={f} />
              ))}
            </div>

            {/* HERO CENTRALE */}
            <section className="px-2 text-center flex flex-col items-center gap-4">

              <h2 className="text-4xl md:text-7xl font-black tracking-tight max-w-4xl leading-tight">
                {t('landing_hero_title')}
              </h2>

              <p className="text-xl md:text-2xl text-slate-300 max-w-2xl font-semibold leading-relaxed">
                {t('landing_subtitle')}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mt-10 w-full sm:w-auto">
                <Link href="/login" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition">
                  {t('start')}
                </Link>
                <Link href="/info" className="bg-slate-800 hover:bg-slate-700 text-white font-semibold px-8 py-4 rounded-xl text-center transition">
                  {t('pricing')}
                </Link>
              </div>

              <div className="mt-4 px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur">
                <p className="text-sm text-slate-300">
                  ⭐ {t('landing_badge_prefix')} <span className="text-indigo-400 font-bold">{t('landing_badge_bold')}</span>
                </p>
              </div>
            </section>

            {/* COLONNA DESTRA */}
            <div className="hidden lg:block space-y-3">
              {rightFeatures.map((f) => (
                <FeatureCard key={f.title} f={f} />
              ))}
            </div>
          </div>
        </main>

        <div className="pb-6 shrink-0" />
      </div>

      {/* BRAND FOOTER FISSO (In alto a sinistra) */}
      <div className="fixed top-6 left-6 z-50 flex flex-col items-center gap-2 pointer-events-none">
        <img
          src="/favicon.png"
          alt="ZeusX"
          className="h-14 w-14 rounded-full object-cover"
        />
        <p className="text-xs font-semibold text-slate-400">{t('sidebar_by')}</p>
      </div>

    </div>
  );
}
