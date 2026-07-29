'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAppInfo } from '../AppInfoContext';
import { useAuth } from '@/src/lib/AuthContext';

export default function AppRegisterPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const { authMode, appId, appName } = useAppInfo();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);

  if (authMode === 'legacy') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 text-center">
        <p className="text-slate-400">Questa app non supporta la registrazione.</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAlreadyRegistered(false);

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
      const res = await fetch(`/api/a/${slug}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) setAlreadyRegistered(true);
        setError(data.error || 'Errore durante la registrazione.');
        return;
      }

      await login(email, password, appId);
      router.push(`/a/${slug}/dashboard`);
    } catch (err) {
      console.error('[register] errore:', err);
      setError('Errore di connessione. Riprova più tardi.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-8">
          <h1 className="text-2xl font-bold text-white mb-1 text-center">Registrati</h1>
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
                placeholder="l'email che ti è stata comunicata"
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
                  placeholder="almeno 8 caratteri"
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
            <div>
              <label className="block text-sm text-slate-400 mb-1">Conferma password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}{' '}
                {alreadyRegistered && (
                  <a href={`/a/${slug}/login`} className="underline text-red-300">
                    Vai al login
                  </a>
                )}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              Crea account
            </button>
          </form>

          <p className="text-sm text-slate-500 text-center mt-6">
            Hai già un account?{' '}
            <a href={`/a/${slug}/login`} className="text-indigo-400 hover:text-indigo-300">
              Accedi
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
