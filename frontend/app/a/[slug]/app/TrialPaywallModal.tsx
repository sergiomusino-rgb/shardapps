'use client';

import { useState } from 'react';
import { AlertTriangle, CreditCard, Check, Loader2 } from 'lucide-react';
import ZeusXBrandingFooter from '@/components/ZeusXBrandingFooter';

interface TrialPaywallModalProps {
  appName: string;
  slug: string;
  trialEndsAt: string;
  /** Prezzo mensile (€) deciso dal reseller per questa app (min. 25€). */
  price: number;
}

const BENEFITS = [
  'Accesso illimitato a tutte le sezioni del gestionale',
  'Dati sempre al sicuro e sincronizzati in tempo reale',
  'Fatture e dati aziendali sempre a portata di mano',
  'Supporto e aggiornamenti inclusi',
];

// Pop-up bloccante mostrato quando il trial e' scaduto e la subscription non
// e' attiva (status 'expired' | 'past_due' | 'canceled'): l'utente non puo'
// interagire con la dashboard finche' non si abbona.
export default function TrialPaywallModal({ appName, slug, trialEndsAt, price }: TrialPaywallModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/a/${slug}/create-checkout-session`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Errore durante la creazione del checkout');
        setLoading(false);
      }
    } catch {
      setError('Errore di connessione');
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'radial-gradient(circle at 50% 0%, rgba(139,92,246,0.15), transparent 60%), #020617',
      }}
    >
      <div className="max-w-md w-full">
        <div
          className="rounded-2xl p-6 sm:p-8 text-center"
          style={{
            background: 'rgba(15,23,42,0.6)',
            border: '1px solid rgba(51,65,85,0.8)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          }}
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-400" />
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4">
            Periodo di prova terminato
          </h1>

          <p className="text-gray-400 mb-5 sm:mb-6 text-sm">
            Il periodo di prova per &quot;{appName}&quot; è terminato il{' '}
            {new Date(trialEndsAt).toLocaleDateString('it-IT')}. Attiva l&apos;abbonamento per continuare.
          </p>

          <ul className="text-left mb-6 sm:mb-8 space-y-2.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm text-gray-300">
                <Check className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>

          <p className="text-yellow-400 text-xs mb-5">
            I tuoi dati sono al sicuro e restano disponibili subito dopo l&apos;attivazione.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {error}
            </div>
          )}

          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white py-3 sm:py-3.5 px-4 sm:px-6 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 text-sm sm:text-base shadow-lg shadow-violet-600/30"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {loading ? 'Attendere...' : `Abbonati Ora - ${price}€/mese`}
          </button>
        </div>
      </div>

      <ZeusXBrandingFooter />
    </div>
  );
}
