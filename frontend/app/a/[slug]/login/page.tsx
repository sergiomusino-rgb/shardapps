'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { useAppInfo } from '../AppInfoContext';
import { useAuth } from '@/src/lib/AuthContext';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabase } from '@/src/lib/supabase';

// ─── Login legacy/app_users (app a schema generato da AI, invariato) ───────
function LegacyAppLoginForm() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const { authMode, appId, appName } = useAppInfo();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // App legacy: nessun login Supabase, torna al gate a password storico.
  useEffect(() => {
    if (authMode === 'legacy') {
      router.replace(`/a/${slug}`);
    }
  }, [authMode, slug, router]);

  if (authMode === 'legacy') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Reindirizzamento...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, appId);
      router.push(`/a/${slug}/dashboard`);
    } catch (err: any) {
      const message = err?.message || '';
      if (message.includes('Invalid login credentials')) {
        setError('Email o password non corretti.');
      } else {
        setError('Nessun accesso associato a questa app con queste credenziali.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-8">
          <h1 className="text-2xl font-bold text-white mb-1 text-center">Accedi</h1>
          <p className="text-slate-400 text-sm mb-6 text-center">{appName || 'Area riservata'}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="nome@esempio.com"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Accedi
            </button>
          </form>

          <p className="text-sm text-slate-500 text-center mt-6">
            Non hai ancora un account?{' '}
            <a href={`/a/${slug}/register`} className="text-indigo-400 hover:text-indigo-300">
              Registrati
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Login Comandi AI (Supabase Auth + tenant_members, per-istanza) ────────
// Niente app_users/client_password: l'operatore è già membro del tenant
// proprietario di questa istanza (stesso account con cui l'ha creata dal
// Creator, o un collega aggiunto allo stesso tenant). Non offre
// registrazione qui: l'account esiste già, va creato da /comandi.
function ComandiLoginForm() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const { appName, tenantId } = useAppInfo();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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

      if (!data?.session) {
        setError(t('login_error_connection'));
        setLoading(false);
        return;
      }

      // Verifica che l'account autenticato sia davvero membro del tenant
      // proprietario di QUESTA istanza: senza questo controllo un utente
      // con credenziali valide ma di un tenant diverso rimbalzerebbe in
      // loop contro il gate di app/a/[slug]/layout.tsx.
      const { data: membership } = await supabase
        .from('tenant_members' as any)
        .select('tenant_id')
        .eq('user_id', data.session.user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!membership) {
        await supabase.auth.signOut();
        setError(t('comandi_instance_login_error_wrong_tenant'));
        setLoading(false);
        return;
      }

      // Dopo il login si atterra sulla dashboard di gestione (non più sulla
      // console operativa/cassa): la console con il microfono resta
      // comunque raggiungibile dal menu della dashboard quando serve
      // registrare un ordine a voce.
      router.push(`/a/${slug}/dashboard?t=${Date.now()}`);
    } catch {
      setError(t('login_error_connection'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <span className="text-3xl font-black tracking-tighter text-white">
            Comandi<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
          </span>
          <p className="mt-2 text-sm text-slate-400">{appName || t('login_title_login')}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-8">
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('login_email_label')}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login_placeholder_email')}
                autoComplete="email"
                className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">{t('login_password_label')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login_placeholder_password')}
                  autoComplete="current-password"
                  className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? t('login_button_login_loading') : t('login_button_login')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Entry point della route /a/[slug]/login ───────────────────────────────
export default function AppLoginPage() {
  const { appType } = useAppInfo();

  if (appType === 'comandi_ai') {
    return <ComandiLoginForm />;
  }

  return <LegacyAppLoginForm />;
}
