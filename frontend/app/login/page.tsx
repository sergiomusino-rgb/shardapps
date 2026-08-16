'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import LanguageSelector from '@/components/LanguageSelector';
import { supabase } from '@/src/lib/supabase';
import { validateRegistrationSubmission } from '@/src/lib/terms-acceptance';


// ═══════════════════════════════════════════════════════════════════════════
// LoginForm Component (inner, uses useSearchParams)
// ═══════════════════════════════════════════════════════════════════════════

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Messaggio di redirect dopo registrazione: derivato dal query param al
  // primo render (initializer lazy), non da un useEffect con setState nel
  // corpo (evita cascading render, vedi react-hooks/set-state-in-effect).
  const [successMsg, setSuccessMsg] = useState(() =>
    searchParams.get('registered') === 'true' ? t('login_success_registered') : ''
  );
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // ─── Handle Login ────────────────────────────────────────────────────────
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
        // Login riuscito: redirect alla dashboard o alla returnUrl
        const returnUrl = searchParams.get('returnUrl');
        const target = returnUrl ? decodeURIComponent(returnUrl) : '/dashboard';
        router.push(`${target}?t=${Date.now()}`);
      }
    } catch {
      setError(t('login_error_connection'));
      setLoading(false);
    }
  };

  // ── Handle Register ─────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    // Accettazione Termini e Condizioni obbligatoria: se manca, la
    // registrazione si blocca qui e supabase.auth.signUp non viene MAI
    // chiamata (vedi validateRegistrationSubmission).
    const validation = validateRegistrationSubmission({ password, termsAccepted });
    if (!validation.ok) {
      setError(t(validation.errorKey));
      setLoading(false);
      return;
    }

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login?registered=true`,
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
        // Se l'email confirmation è disabilitata, l'utente è già loggato
        if (data.session) {
          router.push('/dashboard?t=' + Date.now());
        } else {
          setSuccessMsg(t('login_success_register_confirm'));
          setMode('login');
          setTermsAccepted(false);
        }
      }
    } catch {
      setError(t('login_error_connection'));
    } finally {
      setLoading(false);
    }
  };

  // ─── Handle Password Reset ───────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/login` }
      );

      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccessMsg(t('login_success_reset'));
      }
    } catch {
      setError(t('login_error_connection'));
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isReset = mode === 'reset';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-8">
  {/* Language Selector - Top Right */}
        <div className="fixed top-4 right-4 z-50">
          <LanguageSelector />
        </div>

        {/* Logo */}
        <div className="text-center">
          <Link
            href="/"
            className="text-4xl font-black tracking-tighter text-white"
          >
            SHARD<span className="text-blue-400">APPS</span>
          </Link>
          <p className="mt-2 text-sm text-slate-400">
            {isLogin && t('login_title_login')}
            {isRegister && t('login_title_register')}
            {isReset && t('login_title_reset')}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 backdrop-blur">
          {/* Error Message */}
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
              <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={isLogin ? handleLogin : isRegister ? handleRegister : handleResetPassword}
            className="space-y-5"
          >
            {/* Email */}
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
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Password (non mostrata in modalità reset) */}
            {!isReset && (
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
                    placeholder={isRegister ? t('login_placeholder_password_register') : t('login_placeholder_password')}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 pl-4 pr-11 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
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
            )}

            {/* Accettazione Termini e Condizioni (solo registrazione) */}
            {isRegister && (
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="terms-accept"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-0"
                />
                <label htmlFor="terms-accept" className="cursor-pointer select-none text-sm text-slate-400">
                  {t('login_terms_accept_prefix')}{' '}
                  <Link
                    href="/info"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-indigo-400 underline underline-offset-2 transition-colors hover:text-indigo-300"
                  >
                    {t('login_terms_link')}
                  </Link>
                </label>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {isLogin && (loading ? t('login_button_login_loading') : t('login_button_login'))}
              {isRegister && (loading ? t('login_button_register_loading') : t('login_button_register'))}
              {isReset && (loading ? t('login_button_reset_loading') : t('login_button_reset'))}
            </button>
          </form>

          {/* Mode Switcher */}
          <div className="mt-6 space-y-3 text-center text-sm">
            {isLogin && (
              <>
                <button
                  onClick={() => { setMode('reset'); setError(''); setSuccessMsg(''); }}
                  className="block w-full text-slate-400 transition-colors hover:text-indigo-400"
                >
                  {t('login_forgot_password')}
                </button>
                <p className="text-slate-500">
                  {t('login_no_account')}{' '}
                  <button
                    onClick={() => { setMode('register'); setError(''); setSuccessMsg(''); setTermsAccepted(false); }}
                    className="font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
                  >
                    {t('login_register_link')}
                  </button>
                </p>
              </>
            )}

            {isRegister && (
              <p className="text-slate-500">
                {t('login_has_account')}{' '}
                <button
                  onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); setTermsAccepted(false); }}
                  className="font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  {t('login_login_link')}
                </button>
              </p>
            )}

            {isReset && (
              <button
                onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
                className="font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
              >
                ← {t('login_back_to_login')}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600">
          © {new Date().getFullYear()} ShardApps by MUSINO. Tutti i diritti riservati.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LoginPage (outer, wraps LoginForm in Suspense)
// ═══════════════════════════════════════════════════════════════════════════

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}