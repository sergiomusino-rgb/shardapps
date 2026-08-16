'use client';

// ─── Pre-launch hardening: prima non esisteva una route pubblica per la
// Privacy Policy — l'unica esistente viveva sotto /dashboard/privacy
// (dietro AuthGuard) e non era mai linkata dal funnel di registrazione
// pubblico (solo i Termini, verso /info). Questa pagina rende raggiungibile
// senza autenticazione lo stesso contenuto legale (stesso loader
// getLegalContentUrl già usato da dashboard/privacy), seguendo lo stesso
// pattern visivo di app/info/page.tsx (header pubblico, non il layout
// dashboard con sidebar).
// Rinominato da app/privacy/page.tsx nel pre-launch hardening (SEO): page.tsx
// è ora un Server Component che esporta `metadata`.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';
import { getLegalContentUrl } from '@/lib/legal-content';

export default function PrivacyClient() {
  const { t, locale } = useLanguage();
  const [content, setContent] = useState<string>('');

  useEffect(() => {
    document.body.style.backgroundColor = '#020617';
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, []);

  useEffect(() => {
    fetch(getLegalContentUrl('privacy', locale))
      .then((res) => res.text())
      .then((text) => setContent(text))
      .catch(() => setContent(''));
  }, [locale]);

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
        <h1 className="text-4xl md:text-5xl font-black mb-4">{t('privacy_title')}</h1>
        <p className="text-slate-400 mb-12 text-lg">{t('privacy_content')}</p>

        <div className="p-6 sm:p-8 bg-slate-900 rounded-2xl border border-slate-800">
          <div className="prose prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-slate-300 leading-relaxed font-sans text-sm">
              {content}
            </pre>
          </div>
        </div>

        <p className="text-sm text-slate-500 mt-8">
          {t('info_back_to_home')} · <Link href="/info" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">Termini e Condizioni</Link>
        </p>
      </div>
    </div>
  );
}
