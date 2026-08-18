'use client';

// Rinominato da app/page.tsx (era il default export "Home") nel pre-launch
// hardening: app/page.tsx è ora un Server Component che esporta `metadata`
// (title/description/canonical/OG/JSON-LD) e renderizza questo componente,
// invariato nella logica/UI.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import { useLanguage } from '@/src/lib/LanguageContext';
import {
  Sparkles,
  ArrowRight,
  Wand2,
  Palette,
  Rocket,
  Database,
  Workflow,
  Smartphone,
  Table2,
  History,
  Users,
  Check,
  MessageSquareText,
  Globe,
  ShieldCheck,
  Tags,
} from 'lucide-react';

// ─── Mockup dashboard (puro CSS/HTML, nessuna immagine): l'unico visual
// dell'hero, deve reggere da solo il "wow" — sidebar, KPI, grafico, tabella,
// badge "AI Generated". ────────────────────────────────────────────────
function DashboardMockup() {
  const { t } = useLanguage();
  const kpis = [
    { label: t('landing_mockup_kpi_orders'), value: '1.284', trend: '+12%' },
    { label: t('landing_mockup_kpi_revenue'), value: '€8.4k', trend: '+6%' },
    { label: t('landing_mockup_kpi_clients'), value: '342', trend: '+3%' },
  ];
  const bars = [40, 65, 50, 80, 55, 90, 70];

  return (
    <div className="relative w-full max-w-lg mx-auto">
      <div className="absolute -inset-8 bg-gradient-to-tr from-indigo-600/30 via-violet-600/20 to-cyan-500/30 blur-3xl rounded-[3rem] -z-10" />

      <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_20px_80px_-20px_rgba(79,70,229,0.5)] overflow-hidden animate-[float_6s_ease-in-out_infinite]">
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 backdrop-blur-md">
          <Sparkles className="w-3 h-3 text-cyan-300" />
          <span className="text-[11px] font-semibold text-cyan-200 tracking-wide">{t('landing_mockup_badge')}</span>
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

// ─── Contenuti: solo capacità realmente presenti in CreatorAI Engine 2.0,
// verificate nel codice (generazione AI, database/CRUD dinamico, workflow,
// custom tables, branding, versioning/rollback) — vedi audit commerciale. ──

// Contenuti tradotti via chiavi i18n (landing_*, vedi messages/simple/*.json):
// gli array restano a livello di modulo (icone/ordine sono statici), solo
// title/text sono chiavi risolte con t() in fase di render — permette la
// localizzazione completa senza spostare questi array dentro il componente.
// ─── Trust / social proof: nessuna metrica numerica non verificabile (niente
// "N app create", "N clienti", percentuali) — solo posizionamento (target,
// mercato europeo/internazionale, affidabilità, modello white-label). ──────
const TRUST_PILLS = [
  { icon: Globe, textKey: 'landing_trust_pill1' },
  { icon: ShieldCheck, textKey: 'landing_trust_pill2' },
  { icon: Tags, textKey: 'landing_trust_pill3' },
];

const HOW_IT_WORKS = [
  { n: '01', icon: MessageSquareText, titleKey: 'landing_how_step1_title', textKey: 'landing_how_step1_text' },
  { n: '02', icon: Wand2, titleKey: 'landing_how_step2_title', textKey: 'landing_how_step2_text' },
  { n: '03', icon: Palette, titleKey: 'landing_how_step3_title', textKey: 'landing_how_step3_text' },
  { n: '04', icon: Rocket, titleKey: 'landing_how_step4_title', textKey: 'landing_how_step4_text' },
];

const FEATURES = [
  { icon: Wand2, titleKey: 'landing_feature_ai_title', descKey: 'landing_feature_ai_desc' },
  { icon: Database, titleKey: 'landing_feature_db_title', descKey: 'landing_feature_db_desc' },
  { icon: Workflow, titleKey: 'landing_feature_workflow_title', descKey: 'landing_feature_workflow_desc' },
  { icon: Table2, titleKey: 'landing_feature_tables_title', descKey: 'landing_feature_tables_desc' },
  { icon: Smartphone, titleKey: 'landing_feature_pwa_title', descKey: 'landing_feature_pwa_desc' },
  { icon: History, titleKey: 'landing_feature_versioning_title', descKey: 'landing_feature_versioning_desc' },
  { icon: Sparkles, titleKey: 'landing_feature_vision_title', descKey: 'landing_feature_vision_desc' },
];

export default function HomeClient() {
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
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="ShardApps" className="h-8 w-8 rounded-lg object-cover" />
            <span className="hidden sm:inline text-lg font-black tracking-tight">
              SHARD<span className="text-indigo-400">APPS</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <a href="#reseller" className="hover:text-white transition-colors">{t('landing_nav_reseller')}</a>
            <a href="#features" className="hover:text-white transition-colors">{t('landing_nav_features')}</a>
            <a href="#pricing" className="hover:text-white transition-colors">{t('landing_nav_pricing')}</a>
            <a href="#faq" className="hover:text-white transition-colors">{t('landing_nav_faq')}</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold px-4 py-2 transition"
            >
              {t('login_button_login')}
            </Link>
            <FullscreenToggle color="#ffffff" hoverBackground="rgba(255,255,255,0.12)" />
            <LanguageSelector />
          </div>
        </div>
      </header>

      <main className="pt-16">
        {/* ─── HERO ───────────────────────────────────────────────────── */}
        <section className="px-4 sm:px-6 min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center py-10">
          <div className="max-w-6xl mx-auto mb-8 text-center w-full">
            <span className="inline-block text-4xl sm:text-7xl lg:text-8xl font-black tracking-tight">
              SHARD<span className="text-indigo-400">APPS</span>
            </span>
          </div>

          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 lg:gap-14 items-center w-full">
            <div className="text-center lg:text-left">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] mb-5">
                {t('landing_hero_title_line1')}
                <br />
                <span className="bg-gradient-to-r from-indigo-400 via-cyan-300 to-violet-400 bg-clip-text text-transparent">
                  {t('landing_hero_title_line2')}
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-md mx-auto lg:mx-0 mb-8">
                {t('landing_hero_description')}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-5">
                <Link
                  href="/login"
                  className="group inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-7 py-3.5 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
                >
                  {t('landing_hero_cta_primary')}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center gap-2 border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold px-7 py-3.5 rounded-xl backdrop-blur transition"
                >
                  {t('landing_hero_cta_secondary')}
                </Link>
              </div>

              <p className="text-xs text-slate-500 font-semibold tracking-widest">
                {t('landing_hero_tagline')}
              </p>
            </div>

            <div>
              <DashboardMockup />
            </div>
          </div>
        </section>

        {/* ─── PROBLEMA → SOLUZIONE ───────────────────────────────────── */}
        <section className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-5">
              {t('landing_problem_title_line1')}
              <br className="hidden sm:block" />
              {t('landing_problem_title_line2')}
            </h2>
            <p className="text-slate-400 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              {t('landing_problem_description')}
            </p>
          </div>
        </section>

        {/* ─── TRUST / SOCIAL PROOF ───────────────────────────────────────
            Nessun numero non verificabile (niente "N app create/clienti"):
            comunica target (agenzie/freelancer/reseller), mercato europeo,
            affidabilità e modello white-label solo tramite posizionamento,
            senza statistiche inventate, loghi cliente o recensioni. ────── */}
        <section className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-4xl mx-auto text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 tracking-wide mb-4">
              <Users className="w-3.5 h-3.5 text-cyan-300" /> {t('landing_trust_eyebrow')}
            </span>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">
              {t('landing_trust_title')}
            </h2>
            <p className="text-slate-400 text-base leading-relaxed max-w-2xl mx-auto mb-10">
              {t('landing_trust_subtitle')}
            </p>

            <div className="grid sm:grid-cols-3 gap-4">
              {TRUST_PILLS.map((p) => (
                <div
                  key={p.textKey}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left"
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/20 to-cyan-400/20 flex items-center justify-center">
                    <p.icon className="w-4 h-4 text-cyan-300" />
                  </div>
                  <span className="text-sm font-semibold text-slate-200">{t(p.textKey)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── COME FUNZIONA ───────────────────────────────────────────── */}
        <section className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10">{t('landing_how_title')}</h2>
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

        {/* ─── RESELLER / WHITE LABEL (sezione principale) ────────────── */}
        <section id="reseller" className="relative px-4 sm:px-6 py-16 border-t border-white/5 overflow-hidden">
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className="w-[36rem] h-[36rem] bg-gradient-to-tr from-violet-600/15 via-indigo-600/10 to-cyan-500/15 rounded-full blur-[120px]" />
          </div>
          <div className="max-w-5xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-semibold text-indigo-300 tracking-wide mb-4">
                  <Users className="w-3.5 h-3.5" /> {t('landing_reseller_badge')}
                </span>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight mb-4">
                  &quot;{t('landing_reseller_quote_line1')}
                  <br />
                  {t('landing_reseller_quote_line2')}&quot;
                </h2>
                <p className="text-slate-400 leading-relaxed mb-6">
                  {t('landing_reseller_description')}
                </p>
                <ul className="space-y-3">
                  {[
                    'landing_reseller_bullet1',
                    'landing_reseller_bullet2',
                    'landing_reseller_bullet3',
                    'landing_reseller_bullet4',
                  ].map((key) => (
                    <li key={key} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center">
                    <Palette className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{t('landing_reseller_card_title')}</p>
                    <p className="text-xs text-slate-500">{t('landing_reseller_card_plan')}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { labelKey: 'landing_reseller_card_row1_label', valueKey: 'landing_reseller_card_row1_value' },
                    { labelKey: 'landing_reseller_card_row2_label', valueKey: 'landing_reseller_card_row2_value' },
                    { labelKey: 'landing_reseller_card_row3_label', valueKey: 'landing_reseller_card_row3_value' },
                  ].map((row) => (
                    <div key={row.labelKey} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-2.5 text-sm">
                      <span className="text-slate-400">{t(row.labelKey)}</span>
                      <span className="font-semibold text-white">{t(row.valueKey)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── FEATURES ───────────────────────────────────────────────── */}
        <section id="features" className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10">
              {t('landing_features_title')}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f) => (
                <div key={f.titleKey} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="w-9 h-9 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/20 to-cyan-400/20 flex items-center justify-center">
                    <f.icon className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">{t(f.titleKey)}</h3>
                    <p className="text-xs text-slate-400 leading-snug mt-0.5">{t(f.descKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── PRICING (riepilogo — dettagli/acquisto su /pricing) ─────── */}
        <section id="pricing" className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-3">{t('landing_nav_pricing')}</h2>
            <p className="text-center text-slate-400 mb-10">{t('landing_pricing_subtitle')}</p>

            <div className="grid sm:grid-cols-3 gap-5">
              {[
                { name: 'Starter', setup: '€10', slotsKey: 'landing_pricing_plan_starter_slots', highlight: false },
                { name: 'Pro', setup: '€79', slotsKey: 'landing_pricing_plan_pro_slots', highlight: true },
                { name: 'Business', setup: '€299', slotsKey: 'landing_pricing_plan_business_slots', highlight: false },
              ].map((p) => (
                <div
                  key={p.name}
                  className={`relative rounded-2xl border p-6 ${
                    p.highlight
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-950/50 to-violet-950/50 shadow-2xl shadow-indigo-500/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  {p.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 px-3 py-0.5 rounded-full text-[11px] font-bold">
                      {t('landing_pricing_badge_popular')}
                    </span>
                  )}
                  <h3 className="text-lg font-black mb-3">{p.name}</h3>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-3xl font-black">{p.setup}</span>
                    <span className="text-xs text-slate-400">{t('landing_pricing_setup_label')}</span>
                  </div>
                  <p className="text-sm text-slate-400 mb-4">{t('pricing_monthly_fee_line').replace('{fee}', '25')}</p>
                  <p className="text-xs font-semibold text-slate-300 bg-white/5 rounded-lg px-3 py-2">{t(p.slotsKey)}</p>
                </div>
              ))}
            </div>

            <div className="text-center mt-8">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 text-indigo-300 hover:text-indigo-200 font-semibold text-sm transition"
              >
                {t('landing_pricing_cta')} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ─── FAQ ────────────────────────────────────────────────────── */}
        <section id="faq" className="px-4 sm:px-6 py-16 border-t border-white/5">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-center mb-10">{t('landing_faq_title')}</h2>
            <div className="space-y-4">
              {[
                { qKey: 'landing_faq_q1', aKey: 'landing_faq_a1' },
                { qKey: 'landing_faq_q2', aKey: 'landing_faq_a2' },
                { qKey: 'landing_faq_q3', aKey: 'landing_faq_a3' },
                { qKey: 'landing_faq_q4', aKey: 'landing_faq_a4' },
                { qKey: 'landing_faq_q5', aKey: 'landing_faq_a5' },
              ].map((item) => (
                <div key={item.qKey} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-bold text-white text-sm mb-1.5">{t(item.qKey)}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{t(item.aKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA FINALE ─────────────────────────────────────────────── */}
        <section className="relative px-4 sm:px-6 py-14 border-t border-white/5 overflow-hidden">
          <div className="absolute inset-0 -z-10 flex items-center justify-center">
            <div className="w-[28rem] h-[28rem] bg-gradient-to-tr from-indigo-600/20 via-violet-600/15 to-cyan-500/20 rounded-full blur-[100px]" />
          </div>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">{t('landing_cta_title')}</h2>
            <p className="text-slate-400 mb-7">{t('landing_cta_subtitle')}</p>
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-8 py-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(99,102,241,0.7)] transition"
            >
              {t('landing_hero_cta_primary')}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>

      {/* ─── FOOTER ─────────────────────────────────────────────────── */}
      <footer className="px-4 sm:px-6 py-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            SHARD<span className="text-indigo-400 font-semibold">APPS</span>
          </span>
          {/* Audit commerciale pre-lancio: /info ospita i Termini e
              Condizioni (uniche presenti nel prodotto) ma non era linkata
              da nessuna pagina — irraggiungibile per un visitatore. */}
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-slate-300 transition-colors">
              {t('login_terms_link')}
            </Link>
            {/* Pre-launch hardening: prima non esisteva alcun link pubblico
                all'Informativa Privacy — vedi app/privacy/page.tsx. Riusa
                login_terms_link/login_privacy_link (stesso testo del checkbox
                di signup) invece di "Privacy Policy" hardcoded in inglese
                anche nelle pagine non-EN. */}
            <Link href="/privacy" className="hover:text-slate-300 transition-colors">
              {t('login_privacy_link')}
            </Link>
          </div>
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
