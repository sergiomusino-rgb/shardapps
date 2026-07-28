'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { daysRemaining } from './subscription-status';

interface TrialBannerProps {
  slug: string;
  trialEndsAt: string;
  /** Prezzo mensile (€) deciso dal reseller per questa app (min. 25€). */
  price: number;
}

// Banner discreto mostrato in cima alla dashboard durante il trial attivo
// (status 'trial', non ancora scaduto): conteggio giorni + CTA verso il
// checkout Stripe. Quando il trial scade, questo banner sparisce e
// TrialPaywallModal (gestito da layout.tsx) prende il suo posto bloccando
// l'accesso.
export default function TrialBanner({ slug, trialEndsAt, price }: TrialBannerProps) {
  const [loading, setLoading] = useState(false);
  const days = daysRemaining(trialEndsAt);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/a/${slug}/create-checkout-session`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        flexWrap: 'wrap', padding: '8px 16px',
        background: 'linear-gradient(90deg, #7c3aed, #6366f1)',
        color: '#fff', fontSize: '13px', fontWeight: 600,
      }}
    >
      <Sparkles size={14} />
      <span>
        Periodo di prova: {days} {days === 1 ? 'giorno rimanente' : 'giorni rimanenti'}
      </span>
      <button
        type="button"
        onClick={handleUpgrade}
        disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '999px',
          color: '#fff', fontSize: '12px', fontWeight: 700,
          padding: '4px 12px', cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading && <Loader2 size={12} className="animate-spin" />}
        Attiva il rinnovo mensile · {price}€/mese
      </button>
    </div>
  );
}
