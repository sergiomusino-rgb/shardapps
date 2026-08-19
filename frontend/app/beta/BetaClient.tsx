'use client';

// ─── Pagina pubblica /beta — Fase 1 Private Beta reseller ──────────────────
// Riusa deliberatamente lo stesso linguaggio visivo di HomeClient.tsx
// (sfondo #03050D, gradienti indigo/cyan/violet, card border-white/10
// bg-white/[0.03], bottoni gradient indigo→violet) e la stessa struttura di
// header "pagina secondaria" di InfoClient.tsx (torna alla home, logo,
// selettore lingua) — nessun sistema visivo nuovo, nessun componente
// duplicato. Contenuto interamente tradotto via useLanguage()/messages/simple
// (chiavi beta_*), inglese come lingua di riferimento.
import { useEffect } from 'react';
import Link from 'next/link';
import LanguageSelector from '@/components/LanguageSelector';
import { useLanguage } from '@/src/lib/LanguageContext';
import { trackBetaEvent } from '@/lib/beta-tracking';
import BetaApplicationForm from './BetaApplicationForm';
import {
  MessageSquareText,
  Wand2,
  Palette,
  Rocket,
  Smartphone,
  TrendingUp,
  Code2,
  Download,
  History,
  Building2,
  Briefcase,
  Store,
  ArrowRight,
  ArrowDown,
} from 'lucide-react';

const HOW_IT_WORKS = [
  { n: '01', icon: MessageSquareText, titleKey: 'beta_how_step1_title', textKey: 'beta_how_step1_text' },
  { n: '02', icon: Wand2, titleKey: 'beta_how_step2_title', textKey: 'beta_how_step2_text' },
  { n: '03', icon: Palette, titleKey: 'beta_how_step3_title', textKey: 'beta_how_step3_text' },
  { n: '04', icon: Rocket, titleKey: 'beta_how_step4_title', textKey: 'beta_how_step4_text' },
];

// Solo capacità realmente presenti nel prodotto (stessa lista verificata già
// usata in HomeClient FEATURES + white-label/API/export, vedi audit
// commerciale) — nessuna funzionalità inventata.
const WHY_ITEMS = [
  { icon: Wand2, textKey: 'beta_why_item1' },
  { icon: Palette, textKey: 'beta_why_item2' },
  { icon: Smartphone, textKey: 'beta_why_item3' },
  { icon: TrendingUp, textKey: 'beta_why_item4' },
  { icon: Code2, textKey: 'beta_why_item5' },
  { icon: Download, textKey: 'beta_why_item6' },
  { icon: History, textKey: 'beta_why_item7' },
];

const BUILT_FOR = [
  { icon: Building2, textKey: 'beta_builtfor_agencies' },
  { icon: Briefcase, textKey: 'beta_builtfor_freelancers' },
  { icon: Store, textKey: 'beta_builtfor_resellers' },
];

export default function BetaClient() {
  const { t } = useLanguage();

  useEffect(() => {
    trackBetaEvent('beta_page_view');
  }, []);

  return (
    <div className="min-h-screen w-full font-sans relative text-white bg-[#03050D] overflow-x-hidden">
      {/* Sfondo: stesso trattamento di HomeClient (nessuna foto stock) */}
      <div className="fixed inset-0 -z-10 bg-[#03050D]">
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] bg-indigo-700/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/4 -right-40 w-[36rem] h-[36rem] bg-cyan-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 w-[28rem] h-[28rem] bg-violet-700/15 rounded-full blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)] bg-[length:32px_32px]" />
      </div>

      {/* ─── HEADER — stesso pattern di InfoClient.tsx ─────────────────── */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-[#03050D]/90 backdrop-blur-xl px-4 sm:px-6">
        <Link href="/" className="text-sm font-medium text-slate-400 transition-colors hover:text-white">
          {t('info_back_to_home')}
        </Link>
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg sm:text-xl font-black tracking-tight text-white">
            SHARD<span className="text-indigo-400">APPS</span>
          </span>
        </Link>
        <LanguageSelector />
      </header>

      <main>
        {/* ─── HERO ───────────────────────────────────────────────────── */}
        <section className="px-4 sm:px-6 pt-16 pb-14 text-center">
          <div className="max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-bold text-indigo-300 tracking-widest mb-6">
              {t('beta_eyebrow')}
            </span>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.1] mb-5">
              {t('beta_hero_title')}
            </h1>
            <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto mb-8">
              {t('beta_hero_subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="#apply"
                className="group inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-7 py-3.5 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
              >
                {t('beta_hero_cta_primary')}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold px-7 py-3.5 rounded-xl backdrop-blur transition"
              >
                {t('beta_hero_cta_secondary')}
                <ArrowDown className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS ───────────────────────────────────────────── */}
        <section id="how-it-works" className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10">{t('beta_how_title')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {HOW_IT_WORKS.map((s) => (
                <div key={s.n} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/20 to-cyan-400/20 flex items-center justify-center">
                      <s.icon className="w-4 h-4 text-cyan-300" />
                    </div>
                    <span className="text-xs font-black text-indigo-400 tracking-wide">{s.n}</span>
                  </div>
                  <h3 className="font-bold text-white mb-1.5">{t(s.titleKey)}</h3>
                  <p className="text-sm text-slate-400 leading-snug">{t(s.textKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── WHY AGENCIES CHOOSE SHARDAPPS ──────────────────────────── */}
        <section className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10">{t('beta_why_title')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {WHY_ITEMS.map((item) => (
                <div key={item.textKey} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="w-9 h-9 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/20 to-cyan-400/20 flex items-center justify-center">
                    <item.icon className="w-4 h-4 text-cyan-300" />
                  </div>
                  <span className="text-sm font-semibold text-slate-200">{t(item.textKey)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── BUILT FOR ──────────────────────────────────────────────── */}
        <section className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-8">{t('beta_builtfor_title')}</h2>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {BUILT_FOR.map((item) => (
                <span
                  key={item.textKey}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold tracking-wide text-white"
                >
                  <item.icon className="w-4 h-4 text-indigo-300" />
                  {t(item.textKey)}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ─── PRIVATE BETA — blocco forte ────────────────────────────── */}
        <section className="relative px-4 sm:px-6 py-16 border-t border-white/5 overflow-hidden">
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className="w-[36rem] h-[36rem] bg-gradient-to-tr from-indigo-600/20 via-violet-600/15 to-cyan-500/20 rounded-full blur-[120px]" />
          </div>
          <div className="max-w-3xl mx-auto text-center rounded-3xl border border-indigo-500/40 bg-gradient-to-br from-indigo-950/60 to-violet-950/60 p-8 sm:p-12 shadow-2xl shadow-indigo-500/10">
            <span className="inline-block text-xs font-bold text-indigo-300 tracking-widest mb-3">{t('beta_cta_eyebrow')}</span>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-4">{t('beta_cta_title')}</h2>
            <p className="text-slate-300 leading-relaxed max-w-xl mx-auto mb-7">{t('beta_cta_text')}</p>
            <a
              href="#apply"
              className="group inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-8 py-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
            >
              {t('beta_cta_button')}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        </section>

        {/* ─── FORM ───────────────────────────────────────────────────── */}
        <section id="apply" className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">{t('beta_form_title')}</h2>
              <p className="text-slate-400 text-sm sm:text-base">{t('beta_form_subtitle')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
              <BetaApplicationForm />
            </div>
          </div>
        </section>
      </main>

      {/* ─── FOOTER — identico a HomeClient.tsx ────────────────────────── */}
      <footer className="px-4 sm:px-6 py-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            SHARD<span className="text-indigo-400 font-semibold">APPS</span>
          </span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-slate-300 transition-colors">
              {t('login_terms_link')}
            </Link>
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">
              {t('login_privacy_link')}
            </Link>
          </div>
          <span>{t('sidebar_by')}</span>
        </div>
      </footer>
    </div>
  );
}
