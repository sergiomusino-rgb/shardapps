'use client';

// ─── Pre-launch hardening: /pricing era avvolto incondizionatamente in
// DashboardLayoutClient, che applica <AuthGuard requireTenant
// redirectTo="/login">. Risultato verificato in browser: un visitatore
// anonimo che apriva /pricing (incluso dal link "Vedi i piani" e dalla CTA
// "Vedi tutti i dettagli e attiva un piano" della landing pubblica) veniva
// rediretto a /login PRIMA di vedere un solo prezzo — il funnel pubblico
// landing → pricing → checkout era di fatto rotto per chiunque non avesse
// già un account, nonostante /pricing/page.tsx gestisca già correttamente
// lo stato "nessuna sessione" (mostra i piani, il bottone di acquisto porta
// a /login solo al click). Fix mirato: qui, non in AuthGuard/
// DashboardLayoutClient (condivisi da tutta l'area autenticata, blast
// radius molto più ampio) — un visitatore senza sessione vede la pagina
// nuda, senza redirect; un utente autenticato continua a vedere l'identico
// chrome dashboard di prima (sidebar, header) invariato.
import { useEffect, useState } from 'react';
import DashboardLayoutClient from '@/app/dashboard/DashboardLayoutClient';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<'loading' | 'guest' | 'authed'>('loading');

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setStatus(session?.user ? 'authed' : 'guest');
    });
    const { data: listener } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setStatus(session?.user ? 'authed' : 'guest');
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="text-slate-400">Caricamento...</div>
      </div>
    );
  }

  if (status === 'authed') {
    return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
  }

  // Visitatore senza sessione: pagina pubblica, nessun AuthGuard/sidebar.
  return <div className="min-h-screen bg-slate-950">{children}</div>;
}
