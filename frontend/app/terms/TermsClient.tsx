'use client';

// ─── Pre-launch hardening: prima /terms non esisteva come route pubblica —
// i Termini e Condizioni erano raggiungibili solo incorporati dentro /info
// (sezione in fondo alla pagina prezzi) o da /dashboard/terms (dietro
// AuthGuard). Questa pagina rende raggiungibile senza autenticazione, con un
// URL diretto, la stessa fonte canonica già condivisa da /info e
// /dashboard/terms: components/legal/TermsContent.tsx. Stesso pattern
// visivo di app/privacy/PrivacyClient.tsx (header pubblico, non il layout
// dashboard con sidebar), nessun nuovo testo introdotto.
import Link from 'next/link';
import { useEffect } from 'react';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';
import TermsContent from '@/components/legal/TermsContent';

export default function TermsClient() {
  const { t } = useLanguage();

  useEffect(() => {
    document.body.style.backgroundColor = '#020617';
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
        <Link href="/" className="text-sm font-medium text-slate-400 transition-colors hover:text-white">
          {t('info_back_to_home')}
        </Link>
        <Link href="/" className="text-2xl font-black tracking-tight text-white">
          SHARD<span className="text-indigo-400">APPS</span>
        </Link>
        <LanguageSelector />
      </header>

      <div className="max-w-4xl mx-auto px-6 pt-20 pb-20">
        <h1 className="text-4xl md:text-5xl font-black mb-4">{t('terms_title')}</h1>
        <p className="text-slate-400 mb-12 text-lg">{t('terms_content')}</p>

        <TermsContent />

        <p className="text-sm text-slate-500 mt-8">
          {t('info_back_to_home')} · <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
