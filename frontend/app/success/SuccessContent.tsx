"use client";

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

// Fonte autoritativa per la sincronizzazione del piano dopo il checkout
// Stripe: il backend Express (unico registrato come webhook endpoint per gli
// eventi subscription.updated/deleted e payment_failed, oltre a
// checkout.session.completed — vedi backend/routes/stripe.js). Stessa route
// chiamata anche da dashboard/page.tsx (SyncPlanBanner), invece di duplicarla
// anche qui con un contratto diverso (era session_id/credits_added, il
// backend usa sessionId/creditsAdded).
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get('session_id');
  const appSlug = searchParams.get('appSlug');
  const [, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<string>('');

  useEffect(() => {
    if (sessionId || appSlug) {
      console.log("Pagamento completato con sessione:", sessionId, "o appSlug:", appSlug);
      
      // Se abbiamo session_id, sincronizza il piano con Stripe
      if (sessionId && !appSlug) {
        setSyncStatus('Sincronizzazione del piano in corso...');

        supabaseBrowser.auth.getSession().then(({ data: { session } }) =>
          fetch(`${BACKEND_URL}/api/sync-plan`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ sessionId }),
          })
        )
        .then(res => res.json())
        .then(data => {
          console.log('[Sync Plan] Risultato:', data);
          if (data.paid && !data.plan && data.creditsAdded > 0) {
            // Ricarica Extra (credit_topup): nessun piano/slot coinvolto,
            // solo crediti Vision accreditati.
            setSyncStatus(`+${data.creditsAdded} crediti Vision accreditati!`);
          } else if (data.paid && data.creditsAdded > 0) {
            setSyncStatus(`Piano ${data.plan} attivato con ${data.appLimit} slot e ${data.creditsAdded} crediti Vision!`);
          } else if (data.paid) {
            setSyncStatus(`Piano ${data.plan} attivato con ${data.appLimit} slot!`);
          } else if (data.paid === false) {
            setSyncStatus('Attendi la conferma del pagamento...');
          } else {
            setSyncStatus('Piano sincronizzato con successo!');
          }
        })
        .catch(err => {
          console.error('[Sync Plan] Errore:', err);
          setSyncStatus('Errore nella sincronizzazione del piano');
        })
        .finally(() => {
          setLoading(false);
        });
      } else {
        setLoading(false);
      }

      // Reindirizzamento automatico dopo 4 secondi (per dare tempo alla sync)
      const timer = setTimeout(() => {
        // Se abbiamo appSlug, reindirizza al dettaglio dell'app
        if (appSlug) {
          router.push(`/dashboard/projects/${appSlug}`);
        } else {
          router.push('/dashboard');
        }
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [sessionId, appSlug, router]);

  // Determina l'URL del pulsante principale
  const buttonHref = appSlug ? `/dashboard/projects/${appSlug}` : '/dashboard';

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 p-6 text-center text-white">
      {/* Glow di sfondo, coerente con dashboard/pricing/vision */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-emerald-600/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <svg className="h-8 w-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-white">Pagamento Riuscito!</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">
          {appSlug
            ? "L'app è stata creata con successo! Verrai reindirizzato ai dettagli dell'app a breve..."
            : "Grazie per aver acquistato i crediti ZEUSX. Il tuo account è stato aggiornato. Verrai reindirizzato alla dashboard a breve..."
          }
        </p>

        {syncStatus && (
          <div className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
            <p className="text-sm text-indigo-300">{syncStatus}</p>
          </div>
        )}

        <Link
          href={buttonHref}
          className="block w-full rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-3 font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all hover:-translate-y-0.5 hover:shadow-indigo-600/30"
        >
          {appSlug ? "Vai ai dettagli dell'app" : "Vai subito alla Dashboard"}
        </Link>
      </div>

      <p className="relative mt-6 text-sm text-slate-500">
        {sessionId
          ? `ID Transazione: ${sessionId.substring(0, 15)}...`
          : appSlug
            ? `App Slug: ${appSlug}`
            : "N/A"
        }
      </p>
    </div>
  );
}