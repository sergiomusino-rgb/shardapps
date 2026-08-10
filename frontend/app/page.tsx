'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import { useLanguage } from '@/src/lib/LanguageContext';
import {
  Sparkles,
  ArrowRight,
  MessageSquareText,
  Wand2,
  Rocket,
  Bot,
  Share2,
  Smartphone,
} from 'lucide-react';

// ─── Mockup dashboard (puro CSS/HTML, nessuna immagine): l'unico visual
// dell'hero, deve reggere da solo il "wow" — sidebar, KPI, grafico, tabella,
// badge "AI Generated". ────────────────────────────────────────────────
function DashboardMockup() {
  const kpis = [
    { label: 'Ordini', value: '1.284', trend: '+12%' },
    { label: 'Ricavi', value: '€8.4k', trend: '+6%' },
    { label: 'Clienti', value: '342', trend: '+3%' },
  ];
  const bars = [40, 65, 50, 80, 55, 90, 70];

  return (
    <div className="relative w-full max-w-lg mx-auto">
      <div className="absolute -inset-8 bg-gradient-to-tr from-indigo-600/30 via-violet-600/20 to-cyan-500/30 blur-3xl rounded-[3rem] -z-10" />

      <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_20px_80px_-20px_rgba(79,70,229,0.5)] overflow-hidden animate-[float_6s_ease-in-out_infinite]">
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 backdrop-blur-md">
          <Sparkles className="w-3 h-3 text-cyan-300" />
          <span className="text-[11px] font-semibold text-cyan-200 tracking-wide">AI Generated</span>
        </div>

        <div className="flex">
          <div className="hidden sm:flex w-14 flex-col items-center gap-4 border-r border-white/10 bg-black/20 py-5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-6 h-6 rounded-md bg-white/10" />
            ))}
          </div>

          <div className="flex-1 p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="space-y-1.5">
                <div className="h-2.5 w-28 rounded-full bg-white/20" />
                <div className="h-2 w-16 rounded-full bg-white/10" />
              </div>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 ring-2 ring-white/10" />
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                  <p className="text-[10px] text-slate-400">{k.label}</p>
                  <p className="text-sm font-bold text-white">{k.value}</p>
                  <p className="text-[10px] font-semibold text-emerald-400">{k.trend}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-5 gap-2.5">
              <div className="col-span-3 rounded-xl border border-white/10 bg-white/5 p-3 flex items-end gap-1.5 h-24">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm bg-gradient-to-t from-indigo-500 to-cyan-400"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col justify-center gap-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                    <div className="h-1.5 flex-1 rounded-full bg-white/10" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { n: '01', icon: MessageSquareText, title: 'DESCRIVI', text: 'Scrivi cosa deve fare la tua app.' },
  { n: '02', icon: Wand2, title: 'GENERA', text: "L'AI costruisce struttura e interfaccia." },
  { n: '03', icon: Rocket, title: 'PUBBLICA', text: 'Personalizza, pubblica e vendi.' },
];

const VALUE_ITEMS = [
  { icon: Bot, title: 'AI App Builder', desc: 'Gestionali generati da un semplice prompt.' },
  { icon: Share2, title: 'White Label & Reselling', desc: 'Rivendi ciò che crei ai tuoi clienti.' },
  { icon: Smartphone, title: 'PWA & Mobile', desc: 'Pronte su browser e smartphone, subito.' },
];

export default function Home() {
  const { t } = useLanguage();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen w-full font-sans relative text-white bg-[#03050D] overflow-x-hidden">
      {/* Sfondo: gradiente profondo indigo/cyan/violet, niente foto stock */}
      <div className="fixed inset-0 -z-10 bg-[#03050D]">
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] bg-indigo-700/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/4 -right-40 w-[36rem] h-[36rem] bg-cyan-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 w-[28rem] h-[28rem] bg-violet-700/15 rounded-full blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)] bg-[length:32px_32px]" />
      </div>

      {/* ─── NAVBAR ─────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
          scrolled ? 'bg-[#03050D]/80 backdrop-blur-xl border-b border-white/10' : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="ShardApps" className="h-8 w-8 rounded-lg object-cover" />
            <span className="text-lg font-black tracking-tight">
              SHARD<span className="text-indigo-400">APPS</span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <FullscreenToggle color="#ffffff" hoverBackground="rgba(255,255,255,0.12)" />
            <LanguageSelector />
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 bg-white text-slate-900 hover:bg-slate-200 font-semibold text-sm px-4 py-2 rounded-full transition"
            >
              {t('start')}
            </Link>
          </div>
        </div>
      </header>

      {/* ─── HERO (quasi tutto above-the-fold) ─────────────────────────── */}
      <main className="pt-16">
        <section className="px-4 sm:px-6 min-h-[calc(100vh-4rem)] flex items-center py-10">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 lg:gap-14 items-center w-full">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 mb-5 backdrop-blur">
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                <span className="text-xs font-semibold text-slate-300 tracking-wide">AI App Builder</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] mb-5">
                La tua idea.
                <br />
                La tua app.
                <br />
                <span className="bg-gradient-to-r from-indigo-400 via-cyan-300 to-violet-400 bg-clip-text text-transparent">
                  Un solo prompt.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-md mx-auto lg:mx-0 mb-8">
                ShardApps trasforma una descrizione in un&apos;app gestionale pronta da personalizzare, pubblicare e
                vendere.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-5">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-7 py-3.5 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
                >
                  Crea la tua app
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/info"
                  className="inline-flex items-center justify-center gap-2 border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold px-7 py-3.5 rounded-xl backdrop-blur transition"
                >
                  Scopri i piani
                </Link>
              </div>

              <p className="text-xs text-slate-500 font-semibold tracking-widest">
                AI &bull; PWA &bull; MULTI-LANGUAGE &bull; READY TO SELL
              </p>
            </div>

            <div>
              <DashboardMockup />
            </div>
          </div>
        </section>

        {/* ─── STRIP "COME FUNZIONA" ────────────────────────────────── */}
        <section className="px-4 sm:px-6 py-8 border-t border-white/5">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 sm:gap-2">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-2.5 text-center sm:text-left">
                  <s.icon className="w-4 h-4 text-cyan-300 shrink-0" />
                  <div>
                    <span className="text-sm font-black tracking-wide">
                      <span className="text-indigo-400">{s.n}</span> {s.title}
                    </span>
                    <p className="text-xs text-slate-500 leading-tight">{s.text}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <ArrowRight className="hidden sm:block w-4 h-4 text-slate-600 mx-2 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ─── VALUE PROPOSITION (compatta) ───────────────────────────── */}
        <section className="px-4 sm:px-6 py-10 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-8">
              Non crei solo un&apos;app. Crei un{' '}
              <span className="bg-gradient-to-r from-indigo-400 via-cyan-300 to-violet-400 bg-clip-text text-transparent">
                prodotto
              </span>
              .
            </h2>

            <div className="grid sm:grid-cols-3 gap-4">
              {VALUE_ITEMS.map((v) => (
                <div key={v.title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="w-9 h-9 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/20 to-cyan-400/20 flex items-center justify-center">
                    <v.icon className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">{v.title}</h3>
                    <p className="text-xs text-slate-400 leading-snug">{v.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA FINALE (compatta) ──────────────────────────────────── */}
        <section className="relative px-4 sm:px-6 py-14 border-t border-white/5 overflow-hidden">
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className="w-[28rem] h-[28rem] bg-gradient-to-tr from-indigo-600/20 via-violet-600/15 to-cyan-500/20 rounded-full blur-[100px]" />
          </div>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">Cosa vuoi creare oggi?</h2>
            <p className="text-slate-400 mb-7">Descrivilo. ShardApps farà il resto.</p>
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-8 py-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
            >
              Inizia a creare
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>

      {/* ─── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="px-4 sm:px-6 py-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            SHARD<span className="text-indigo-400 font-semibold">APPS</span>
          </span>
          <span>{t('sidebar_by')}</span>
        </div>
      </footer>

      <style jsx>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      `}</style>
    </div>
  );
}
