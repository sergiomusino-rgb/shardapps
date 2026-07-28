'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { useAppInfo } from './AppInfoContext';
import { getDesignTokens, getDesignKeyForSector } from '@/lib/designTokens';
import { getHeroContentForDesignKey } from '@/lib/landingHero';
import { resolveIcon } from './app/iconResolver';
import FullscreenToggle from '@/components/FullscreenToggle';
import InstallAppBanner from '@/components/InstallAppBanner';
import { usePwaSetup } from '@/hooks/usePwaSetup';
import ComandiInstanceLanding from '@/components/comandi/ComandiInstanceLanding';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// ─── Entry point della route /a/[slug] ─────────────────────────────────────
// App legacy: gate a password storico (LegacyLoginGate, invariato).
// App nuove (auth_mode='supabase'): landing pubblica di settore.
function GeneratedAppRootPage() {
  const { authMode } = useAppInfo();
  return authMode === 'supabase' ? <LandingPublic /> : <LegacyLoginGate />;
}

interface CompanyInfo {
  ragione_sociale: string | null;
  indirizzo: string | null;
  telefono: string | null;
  logo: string | null;
}

// ─── Landing pubblica (nuove app) ───────────────────────────────────────────
function LandingPublic() {
  const { slug, appName, config } = useAppInfo();
  const sector = (config?.sector as string) || '';
  const description = (config?.description as string) || '';
  const tables = ((config?.schema as any)?.tables as Array<{ name: string; label: string; labelPlural?: string; icon?: string }>) || [];
  const sectorSignal = `${appName || ''} ${description || ''}`;
  const designKey = getDesignKeyForSector(sector, sectorSignal);
  const designTokens = getDesignTokens(sector, sectorSignal);
  const hero = getHeroContentForDesignKey(designKey);

  // Dati aziendali reali (compilati dal titolare dopo la generazione AI):
  // quando presenti sostituiscono il nome generico creato alla generazione,
  // senza toccare nulla se il titolare non li ha ancora inseriti.
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/a/${slug}/company-info`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCompanyInfo(data))
      .catch(() => {});
  }, [slug]);

  const displayName = companyInfo?.ragione_sociale || appName;

  usePwaSetup(slug, designTokens.colors.primary, companyInfo?.logo || '/icons/icon-192x192.png', displayName);

  // Spezza la tagline sulla keyword di settore per evidenziarla in corsivo/colore primario
  const [taglineBefore, taglineAfter] = hero.tagline.split('{keyword}');

  return (
    <div style={{ minHeight: '100vh', background: designTokens.colors.bg, fontFamily: designTokens.fonts.body }}>
      {/* Header */}
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 32px', borderBottom: `1px solid ${designTokens.colors.border}`,
          background: designTokens.colors.surface,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {companyInfo?.logo && (
            <img src={companyInfo.logo} alt="" style={{ height: '32px', width: '32px', objectFit: 'contain', borderRadius: '6px' }} />
          )}
          <span style={{ fontFamily: designTokens.fonts.headline, fontSize: '20px', fontWeight: 700, color: designTokens.colors.text }}>
            {displayName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FullscreenToggle color={designTokens.colors['text-secondary']} />
          <a
            href={`/a/${slug}/login`}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: designTokens.colors.primary, color: '#fff',
              padding: '10px 20px', borderRadius: designTokens.radii.md,
              fontWeight: 600, fontSize: '14px', textDecoration: 'none',
            }}
          >
            <LogIn size={16} /> Accedi / Area Riservata
          </a>
        </div>
      </header>

      {/* Hero: copertina full-bleed con foto contestuale di settore e testo sovrapposto */}
      <section className="relative flex min-h-[560px] items-end overflow-hidden sm:min-h-[640px]">
        <img
          src={hero.image}
          alt={hero.imageAlt}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
        />
        {/* Overlay: scurisce la foto per leggibilità del testo, sfumato di settore in basso */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(0deg, ${designTokens.colors.bg} 0%, rgba(0,0,0,0.55) 38%, rgba(0,0,0,0.15) 65%, rgba(0,0,0,0.35) 100%)`,
          }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-8 pb-14 pt-24 sm:px-10">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wide backdrop-blur-sm"
            style={{
              border: `1px solid ${designTokens.colors.primary}66`,
              background: `${designTokens.colors.primary}33`,
              color: '#fff',
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: designTokens.colors.success }}
            />
            {hero.badgeLabel}
          </div>

          <h1
            className="max-w-2xl text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl"
            style={{ fontFamily: designTokens.fonts.headline, textShadow: '0 2px 16px rgba(0,0,0,0.35)' }}
          >
            {displayName}
          </h1>

          <p
            className="mt-5 max-w-xl text-lg leading-relaxed text-white/90"
            style={{ fontFamily: designTokens.fonts.body, textShadow: '0 1px 8px rgba(0,0,0,0.35)' }}
          >
            {taglineBefore}
            <em style={{ fontStyle: 'italic', color: '#fff', fontWeight: 700 }}>
              {hero.keyword}
            </em>
            {taglineAfter}
          </p>

          {description && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/75" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.35)' }}>
              {description}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href={`/a/${slug}/register`}
              className="shadow-lg transition-transform duration-200 hover:-translate-y-0.5"
              style={{
                background: designTokens.colors.primary, color: '#fff',
                padding: '14px 28px', borderRadius: designTokens.radii.md,
                fontWeight: 700, fontSize: '15px', textDecoration: 'none',
                boxShadow: `0 8px 24px ${designTokens.colors.primary}66`,
              }}
            >
              Registrati ora
            </a>
            <a
              href={`/a/${slug}/login`}
              className="flex items-center gap-2 transition-colors duration-200 backdrop-blur-sm"
              style={{
                border: '1px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                padding: '14px 24px', borderRadius: designTokens.radii.md,
                fontWeight: 600, fontSize: '15px', textDecoration: 'none',
              }}
            >
              <LogIn size={16} /> Accedi
            </a>

            {tables.length > 0 && (
              <div
                className="ml-2 hidden items-center gap-3 rounded-xl px-4 py-2.5 backdrop-blur-sm sm:flex"
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: '32px', height: '32px', borderRadius: designTokens.radii.md,
                    background: 'rgba(255,255,255,0.15)', color: '#fff',
                  }}
                >
                  {resolveIcon(tables[0]?.icon || '', tables[0]?.name)}
                </div>
                <div>
                  <div style={{ fontFamily: designTokens.fonts.headline, fontWeight: 700, fontSize: '16px', color: '#fff' }}>
                    {tables.length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)' }}>
                    sezioni gestite
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Griglia sezioni (placeholder da schema, nessun dato reale) */}
      <section style={{ padding: '48px 32px', maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ fontFamily: designTokens.fonts.headline, fontSize: '24px', fontWeight: 700, color: designTokens.colors.text, marginBottom: '24px', textAlign: 'center' }}>
          Cosa puoi gestire
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          {tables.map((table) => (
            <div
              key={table.name}
              className="group border border-slate-100/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              style={{
                background: designTokens.colors['card-bg'] || designTokens.colors.surface,
                borderRadius: designTokens.radii.lg,
                padding: '24px',
                boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '44px', height: '44px', borderRadius: designTokens.radii.md,
                background: `${designTokens.colors.primary}1A`, color: designTokens.colors.primary,
                marginBottom: '16px',
              }}>
                {resolveIcon(table.icon || '', table.name)}
              </div>
              <h3 style={{ fontFamily: designTokens.fonts.headline, fontSize: '16px', fontWeight: 600, color: designTokens.colors.text, margin: '0 0 6px 0' }}>
                {table.labelPlural || table.label}
              </h3>
              <p style={{ fontSize: '13px', color: designTokens.colors['text-secondary'], margin: '0 0 14px 0' }}>
                Gestisci i tuoi {(table.labelPlural || table.label).toLowerCase()} in tempo reale.
              </p>
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold transition-transform duration-300 group-hover:translate-x-0.5"
                style={{ color: designTokens.colors.primary }}
              >
                Scopri di più →
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '32px', textAlign: 'center', borderTop: `1px solid ${designTokens.colors.border}`, color: designTokens.colors['text-secondary'], fontSize: '13px' }}>
        <p style={{ margin: '0 0 8px 0' }}>{displayName}</p>
        {(companyInfo?.indirizzo || companyInfo?.telefono) && (
          <p style={{ margin: '0 0 8px 0' }}>
            {[companyInfo.indirizzo, companyInfo.telefono].filter(Boolean).join(' · ')}
          </p>
        )}
        <a href={`/a/${slug}/register`} style={{ color: designTokens.colors.primary, fontWeight: 600, textDecoration: 'none' }}>
          Registrati per accedere all&apos;area riservata
        </a>
      </footer>

      <InstallAppBanner
        appName={displayName}
        slug={slug}
        primaryColor={designTokens.colors.primary}
        textColor={designTokens.colors.text}
        surfaceColor={designTokens.colors.surface}
        borderColor={designTokens.colors.border}
      />
    </div>
  );
}

// ─── Gate a password legacy (app esistenti, invariato) ─────────────────────
function LegacyLoginGate() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useLanguage();

  const [app, setApp] = useState<{ name: string; client_email: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    async function loadApp() {
      const { data, error } = await supabase
        .from('apps')
        .select('name, client_email')
        .eq('slug', slug)
        .eq('client_active', true)
        .single();

      console.log('[Login] loadApp:', { data, error: error?.message });

      if (error || !data) {
        // App non trovata o bloccata
        window.location.href = `/a/${slug}/blocked`;
        return;
      }

      setApp(data);
      setLoading(false);
    }
    loadApp();
  }, [slug]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
    // La password non viene mai letta/confrontata lato client: la RLS su
    // `apps` filtra solo per riga (client_active = true), non per colonna, quindi
    // un client con la sola anon key potrebbe altrimenti leggere client_password/
    // initial_password in chiaro per qualunque app attiva. La verifica avviene
    // invece sull'endpoint backend esistente (client_password confrontata
    // server-side, mai restituita al browser).
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';
    const loginRes = await fetch(`${backendUrl}/api/a/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const loginData = await loginRes.json().catch(() => ({}));

    if (loginRes.status === 404) {
      setError(t('login_error_not_found'));
      setSubmitting(false);
      return;
    }

    if (loginData.blocked) {
      setError(t('login_error_blocked'));
      setSubmitting(false);
      return;
    }

    if (!loginRes.ok || !loginData.appInfo) {
      setError(t('login_error_wrong_password'));
      setSubmitting(false);
      return;
    }

    const appData = { id: loginData.appInfo.id };

      // Se primo accesso, salva email
      if (!app?.client_email && email.trim()) {
        const { error: updateError } = await supabase
          .from('apps')
          .update({ client_email: email.trim() })
          .eq('id', appData.id);

        if (updateError) {
          console.error('Errore salvataggio email:', updateError);
          // Continuiamo comunque il login anche se l'email non si salva
        }
      }

      // Carica TUTTE le info dell'app per la sessione (apps + app_definitions)
      const { data: appInfoData } = await supabase
        .from('apps')
        .select('id, slug, name, config')
        .eq('id', appData.id)
        .single();

      // Carica anche app_definitions per avere le tabelle
      const { data: appDefData, error: appDefError } = await supabase
        .from('app_definitions')
        .select('schema, ui_config')
        .eq('app_id', appData.id)
        .maybeSingle();

      console.log('[Login] appInfoData:', appInfoData?.config);
      console.log('[Login] appDefData:', appDefData);
      console.log('[Login] appDefError:', appDefError?.message);

      // Combina i dati - metti le tabelle da app_definitions in config
      // La struttura deve essere: config.schema.tables per la app page
      // IMPORTANTE: non sovrascrivere schema con {} quando appDefData è null
      const combinedConfig = {
        ...((appInfoData?.config as Record<string, unknown> | null) || {}),
        ...(appDefData?.schema ? { schema: appDefData.schema } : {}),
        ...(appDefData?.ui_config ? { ui_config: appDefData.ui_config } : {}),
      };
      
      console.log('[Login] combinedConfig:', combinedConfig);

       // Estrai la lingua dal config e salvala in localStorage
       const appLang = (combinedConfig as Record<string, unknown>)?.lang as string || 'it';
       if (appLang && ['it', 'en', 'fr', 'de', 'es'].includes(appLang)) {
         localStorage.setItem('zeusx_locale', appLang);
       }
       
       // Salva sessione con appInfo completo (tutti i dati)
       const sessionData = {
         slug,
         password,
         appInfo: {
           id: appData.id,
           slug,
           name: appInfoData?.name,
           config: combinedConfig,
         },
       };
       
       console.log('[Login] Saving session with appInfo:', sessionData.appInfo);
       localStorage.setItem(`app_session_${slug}`, JSON.stringify(sessionData));
       window.location.href = `/a/${slug}/app`;
    } catch {
      setError(t('login_error_connection'));
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setResetMessage('');
    setResetting(true);

    try {
      const res = await fetch(`/api/a/${slug}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResetMessage(`${t('login_error')}: ${data.error}`);
        setResetting(false);
        return;
      }

      setResetMessage(`${t('login_new_password')}: ${data.new_password}`);
      setResetting(false);
    } catch {
      setResetMessage(t('login_error_connection'));
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">{t('login_loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 backdrop-blur-md">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">
            ZEUSX
          </h1>
          <p className="mt-2 text-lg font-semibold text-white">{app?.name}</p>
          <p className="mt-1 text-sm text-slate-400">
            {app?.client_email ? t('login_enter_password') : t('login_configure_access')}
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="text-xs font-semibold text-slate-400">{t('login_email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@esempio.com"
              autoComplete="username"
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400">{t('login_password')}</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login_password_placeholder')}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 pr-11 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300 transition"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {app?.client_email && (
            <button
              type="button"
              onClick={() => {
                setShowReset(true);
                setResetEmail(app.client_email || '');
              }}
              className="text-xs text-slate-400 hover:text-indigo-400 transition underline"
            >
              {t('login_forgot_password')}
            </button>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {submitting ? t('login_verifying') : t('login_access')}
          </button>
        </form>

        {showReset && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full mx-4">
              <h3 className="text-2xl font-bold mb-4">{t('login_recover_password')}</h3>
              <p className="text-sm text-slate-400 mb-6">
                {t('login_recover_password_desc')}
              </p>
              
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400">{t('login_email')}</label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="nome@esempio.com"
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition"
                  />
                </div>

                {resetMessage && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                    {resetMessage}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReset(false);
                      setResetMessage('');
                    }}
                    className="flex-1 rounded-xl border border-slate-800 py-3 text-sm font-medium text-slate-400 hover:bg-slate-800 transition"
                  >
                    {t('login_cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={resetting}
                    className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition disabled:opacity-50"
                  >
                    {resetting ? t('login_generating') : t('login_generate_password')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
// ─── Entry point della route /a/[slug] (landing pubblica) ──────────────────
// Comandi AI ha una landing dedicata a schema fisso, senza il motore
// sector/blueprint dell'AI generator: salta interamente GeneratedAppRootPage.
export default function AppRootPageEntry() {
  const appInfo = useAppInfo();

  if (appInfo.appType === 'comandi_ai') {
    return <ComandiInstanceLanding slug={appInfo.slug} />;
  }

  return <GeneratedAppRootPage />;
}
