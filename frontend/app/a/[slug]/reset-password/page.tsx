'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

// ─── /a/[slug]/reset-password ───────────────────────────────────────────────
// Secondo passo del reset password self-service (auth legacy a password
// statica, vedi app/a/[slug]/page.tsx / LegacyLoginGate). Raggiunta dal link
// inviato via email da POST /api/a/[slug]/reset-password: il token nella
// query string prova il possesso della casella, l'utente sceglie qui la
// nuova password (mai generata server-side, mai mostrata in chiaro altrove).
// Token letto da window.location invece di useSearchParams per evitare il
// vincolo di Suspense boundary (stesso motivo già documentato in
// app/a/[slug]/layout.tsx per simulate_expired).
export default function ResetPasswordPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [token, setToken] = useState('');
  const [tokenChecked, setTokenChecked] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setToken(new URLSearchParams(window.location.search).get('token') || '');
    }
    setTokenChecked(true);
  }, []);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('La password deve avere almeno 8 caratteri.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Le password non coincidono.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/a/${slug}/reset-password/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Errore durante il reset della password.');
        setSubmitting(false);
        return;
      }

      setDone(true);
      setSubmitting(false);
    } catch {
      setError('Errore di connessione. Riprova più tardi.');
      setSubmitting(false);
    }
  }

  if (!tokenChecked) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center px-4">
        <p className="text-sm text-slate-500">Caricamento...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-600">Link di reset non valido.</p>
          <a href={`/a/${slug}`} className="text-sm text-indigo-600 underline">
            Torna al login
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-emerald-700">Password aggiornata. Ora puoi accedere con la nuova password.</p>
          <a href={`/a/${slug}`} className="inline-block text-sm text-indigo-600 underline">
            Vai al login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900">Reimposta la password</p>
          <p className="mt-1 text-sm text-slate-500">Scegli la nuova password per accedere.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="text-xs font-semibold text-slate-500">Nuova password</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="almeno 8 caratteri"
                autoComplete="new-password"
                className="w-full rounded-xl border border-slate-300 bg-white p-3 pr-11 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500">Conferma password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {submitting ? 'Aggiornamento...' : 'Aggiorna password'}
          </button>
        </form>
      </div>
    </div>
  );
}
