'use client';

import Link from 'next/link';
import BrandFooter from '@/components/BrandFooter'; // Importa il nuovo componente
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';

export default function Home() {
  const { t } = useLanguage();

  return (
    <div className="bg-slate-950 text-white h-screen w-full font-sans flex flex-col justify-between overflow-hidden relative">

      {/* Selettore lingua (test infrastruttura i18n zero-impatto) */}
      <div className="absolute top-6 right-6 z-30">
        <LanguageSelector />
      </div>

      {/* HEADER */}
      <header className="pt-10 pb-4 flex justify-center">
        <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-white">
          ZEUS<span className="text-indigo-500">X</span>
        </h1>
      </header>

      {/* HERO SECTION */}
      <main className="flex-1 flex items-center justify-center">
        <section className="px-6 max-w-5xl w-full text-center flex flex-col items-center gap-6">
          
          <h2 className="text-4xl md:text-7xl font-black tracking-tight max-w-4xl leading-tight">
            {t('welcome')}
          </h2>
          
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl font-light leading-relaxed">
            {t('landing_subtitle')}
          </p>

          <div className="mt-2 px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur">
            <p className="text-sm text-slate-300">
              ⭐ {t('landing_badge_prefix')} <span className="text-indigo-400 font-bold">{t('landing_badge_bold')}</span>
            </p>
          </div>


          <div className="flex flex-col sm:flex-row gap-4 mt-6 w-full sm:w-auto">
            <Link href="/login" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition">
              {t('start')}
            </Link>
            <Link href="/info" className="bg-slate-800 hover:bg-slate-700 text-white font-semibold px-8 py-4 rounded-xl text-center transition">
              {t('pricing')}
            </Link>
          </div>
        </section>
      </main>

      {/* BRAND FOOTER FISSO (In basso a sinistra) */}
      <div className="fixed bottom-6 left-6 z-50 flex flex-col items-center gap-2 pointer-events-none">
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


