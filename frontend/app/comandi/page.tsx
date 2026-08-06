'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, AlertTriangle, CheckCircle, Mic, Share2, Package, X } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import LanguageSelector from '@/components/LanguageSelector';
import { supabase } from '@/src/lib/supabase';

// Ogni account Comandi ha ora un'istanza dedicata su /a/{slug} (landing,
// login, cassa e dashboard per-istanza): il vecchio /dashboard/comandi resta
// solo come rete di sicurezza (redirect automatico) se la risoluzione
// dell'istanza qui sotto fallisce per qualche motivo.
const FALLBACK_REDIRECT = '/dashboard/comandi';
const ONBOARDING_REDIRECT = '/comandi/setup';

type AuthMode = 'login' | 'register';

// Un utente senza riga in tenant_members non ha ancora completato lo Step 2
// (dati aziendali): lo mandiamo in onboarding, dove viene creato anche il
// tenant. Un utente con tenant ma senza istanza Comandi ancora provisionata
// (es. tenant creato da un altro flusso ShardApps) torna anch'esso in onboarding,
// che ora provisiona pure l'istanza (vedi comandi/setup/page.tsx).
async function resolvePostAuthDestination(userId: string): Promise<string> {
  try {
    // Cast mirato: stesso motivo di dashboard/comandi/page.tsx — il client
    // Supabase qui non ha un generic Database che copre tenant_members/apps.
    const membershipQuery = await supabase
      .from('tenant_members' as any)
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    const membership = membershipQuery.data as { tenant_id: string } | null;

    if (!membership?.tenant_id) {
      return ONBOARDING_REDIRECT;
    }

    const appQuery = await supabase
      .from('apps' as any)
      .select('slug')
      .eq('tenant_id', membership.tenant_id)
      .eq('app_type', 'comandi_ai')
      .limit(1)
      .maybeSingle();
    const app = appQuery.data as { slug: string } | null;

    if (app?.slug) {
      return `/a/${app.slug}`;
    }

    return ONBOARDING_REDIRECT;
  } catch (err) {
    console.error('[ComandiLandingPage] Errore risoluzione istanza:', err);
    return FALLBACK_REDIRECT;
  }
}

export default function ComandiLandingPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setError('');
    setSuccessMsg('');
    setIsAuthOpen(true);
  };

  const closeAuth = () => {
    setIsAuthOpen(false);
    setLoading(false);
  };

  // Chiudi il modale con Esc
  useEffect(() => {
    if (!isAuthOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuth();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (loginError) {
        if (loginError.message.includes('Invalid login credentials')) {
          setError(t('login_error_invalid_credentials'));
        } else if (loginError.message.includes('Email not confirmed')) {
          setError(t('login_error_email_not_confirmed'));
        } else {
          setError(loginError.message);
        }
        setLoading(false);
        return;
      }

      if (data?.session) {
        const destination = await resolvePostAuthDestination(data.session.user.id);
        router.push(`${destination}?t=${Date.now()}`);
      }
    } catch {
      setError(t('login_error_connection'));
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    if (password.length < 6) {
      setError(t('login_error_password_length'));
      setLoading(false);
      return;
    }

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/comandi`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError(t('login_error_already_registered'));
        } else {
          setError(signUpError.message);
        }
        setLoading(false);
        return;
      }

      if (data?.user) {
        if (data.session) {
          // Una registrazione appena completata non ha mai un tenant: si va
          // sempre in onboarding, senza bisogno di verificarlo.
          router.push(`${ONBOARDING_REDIRECT}?t=${Date.now()}`);
        } else {
          setSuccessMsg(t('login_success_register_confirm'));
          setAuthMode('login');
          setLoading(false);
        }
      }
    } catch {
      setError(t('login_error_connection'));
      setLoading(false);
    }
  };

  const isLogin = authMode === 'login';

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

      {/* HEADER */}
      <header className="pt-10 pb-4 flex justify-center">
        <Link href="/comandi" className="text-4xl md:text-5xl font-black tracking-tighter text-white">
          Comand<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
        </Link>
      </header>

      {/* HERO SECTION */}
      <main className="flex flex-col items-center px-6 pb-24">
        <section className="max-w-4xl w-full text-center flex flex-col items-center gap-6 pt-8">
          <div className="px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 backdrop-blur">
            <p className="text-sm text-amber-400 font-semibold">{t('comandi_landing_tagline')}</p>
          </div>

          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">
            {t('comandi_landing_hero_title')}
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl font-light leading-relaxed">
            {t('comandi_landing_hero_subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => openAuth('register')}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-8 py-4 rounded-xl text-center shadow-lg transition-colors"
            >
              {t('comandi_landing_cta_register')}
            </button>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="bg-slate-800 hover:bg-slate-700 text-white font-semibold px-8 py-4 rounded-xl text-center transition-colors"
            >
              {t('comandi_landing_cta_login')}
            </button>
          </div>
        </section>

        {/* FEATURES */}
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

      {/* FOOTER */}
      <div className="flex flex-col items-center gap-2 pb-10">
        <img src="/favicon.png" alt="Comand AI" className="h-10 w-10 rounded-full object-cover" />
        <p className="text-xs text-slate-600">{t('login_footer').replace('{year}', String(new Date().getFullYear()))}</p>
      </div>

      {/* AUTH MODAL */}
      {isAuthOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={closeAuth}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 backdrop-blur p-8 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeAuth}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label={t('comandi_auth_close_aria')}
            >
              <X size={18} />
            </button>

            <div className="text-center mb-6">
              <p className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-2xl font-black tracking-tight text-transparent">
                Comand AI
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {isLogin ? t('login_title_login') : t('login_title_register')}
              </p>
            </div>

            {error && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
                <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('login_email_label')}
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('login_placeholder_email')}
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('login_password_label')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLogin ? t('login_placeholder_password') : t('login_placeholder_password_register')}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 pl-4 pr-11 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                {isLogin
                  ? loading
                    ? t('login_button_login_loading')
                    : t('login_button_login')
                  : loading
                    ? t('login_button_register_loading')
                    : t('login_button_register')}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              {isLogin ? (
                <p className="text-slate-500">
                  {t('login_no_account')}{' '}
                  <button
                    type="button"
                    onClick={() => openAuth('register')}
                    className="font-semibold text-amber-400 transition-colors hover:text-amber-300"
                  >
                    {t('login_register_link')}
                  </button>
                </p>
              ) : (
                <p className="text-slate-500">
                  {t('login_has_account')}{' '}
                  <button
                    type="button"
                    onClick={() => openAuth('login')}
                    className="font-semibold text-amber-400 transition-colors hover:text-amber-300"
                  >
                    {t('login_login_link')}
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
