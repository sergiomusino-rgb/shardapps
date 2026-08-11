'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SignIn() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Per ora simuliamo l'autenticazione inviando l'utente alla dashboard dopo 1 secondo
    setTimeout(() => {
      setLoading(false);
      window.location.href = '/dashboard';
    }, 1200);
  };

  return (
    <div className="bg-slate-950 text-white min-h-screen font-sans flex flex-col justify-center items-center px-4 relative overflow-hidden">
      
      {/* Sfondo Decorativo soft */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-md z-10">
        {/* Logo ed Header Card */}
        <div className="text-center mb-8">
          <Link href="/" className="text-3xl font-black tracking-tight text-white hover:opacity-90 transition">
            SHARD<span className="text-indigo-400">APPS</span>
          </Link>
          <p className="text-slate-400 mt-2 text-sm">
            {isSignUp ? 'Crea il tuo account definitivo 2.0' : 'Accedi al motore del tuo SaaS AI'}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-slate-900/60 border border-slate-800 p-8 rounded-2xl shadow-xl backdrop-blur-xl">
          <h2 className="text-xl font-bold mb-6 text-slate-100">
            {isSignUp ? 'Registrati' : 'Bentornato'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Indirizzo Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@azienda.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-medium py-3 rounded-xl shadow-lg shadow-indigo-500/10 transition flex items-center justify-center disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Elaborazione...
                </span>
              ) : isSignUp ? (
                'Crea Account'
              ) : (
                'Accedi'
              )}
            </button>
          </form>

          {/* Switcher Login / Registrazione */}
          <div className="mt-6 text-center text-sm text-slate-400 border-t border-slate-800/60 pt-4">
            {isSignUp ? (
              <p>
                Hai già un account?{' '}
                <button onClick={() => setIsSignUp(false)} className="text-indigo-400 hover:underline font-medium">
                  Accedi qui
                </button>
              </p>
            ) : (
              <p>
                Non hai ancora un account?{' '}
                <button onClick={() => setIsSignUp(true)} className="text-indigo-400 hover:underline font-medium">
                  Registrati gratis
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Bottone di ritorno rapido */}
        <div className="text-center mt-6">
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-400 transition">
            ← Torna alla Home
          </Link>
        </div>
      </div>
    </div>
  );
}