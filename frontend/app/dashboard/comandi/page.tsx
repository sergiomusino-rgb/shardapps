'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, RotateCcw, ShieldAlert } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import VoiceInputWidget from '@/components/comandi/VoiceInputWidget';
import OrderReviewCard from '@/components/comandi/OrderReviewCard';
import type { VoiceOrderExtraction } from '@/types/comandi';

type SessionStatus = 'loading' | 'active' | 'no-tenant' | 'unauthenticated';

export default function ComandiPage() {
  const router = useRouter();

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [extraction, setExtraction] = useState<VoiceOrderExtraction | null>(null);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  // Integrazione dati reali: verifica sessione Supabase e recupera il
  // tenant dell'utente. La sicurezza vera resta lato server (le Server
  // Action ri-derivano tenant_id/agent_id dalla sessione), qui serve solo a
  // dare un feedback chiaro all'operatore prima ancora che tenti di
  // registrare un ordine.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabaseBrowser.auth.getSession();

        if (cancelled) return;

        if (sessionErr) {
          console.error('[ComandiPage] Errore getSession:', sessionErr);
          setSessionError('Errore nel recupero della sessione utente');
          setSessionStatus('unauthenticated');
          return;
        }

        if (!session?.user) {
          setSessionStatus('unauthenticated');
          router.push('/login');
          return;
        }

        setUserEmail(session.user.email ?? null);

        // Cast mirato: frontend/types/database.ts non è ancora lo schema
        // generato da Supabase (manca tenant_members/tenants), quindi il
        // client tipizzato risolverebbe qui a `never` come in altri punti
        // già esistenti del progetto (es. dashboard/projects/page.tsx).
        const membershipQuery = await supabaseBrowser
          .from('tenant_members' as any)
          .select('tenant_id, tenants ( name )')
          .eq('user_id', session.user.id)
          .limit(1)
          .single();

        if (cancelled) return;

        const membership = membershipQuery.data as { tenant_id: string; tenants: { name?: string } | null } | null;

        if (membershipQuery.error || !membership?.tenant_id) {
          setSessionStatus('no-tenant');
          return;
        }

        setTenantName(membership.tenants?.name || null);
        setSessionStatus('active');
      } catch (err) {
        console.error('[ComandiPage] Errore verifica sessione/tenant:', err);
        if (!cancelled) {
          setSessionError('Errore di rete nel recupero della sessione');
          setSessionStatus('unauthenticated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleOrderParsed = useCallback((data: VoiceOrderExtraction) => {
    setExtraction(data);
  }, []);

  const handleOrderConfirmed = useCallback((orderId: string) => {
    setConfirmedOrderId(orderId);
  }, []);

  const handleNewOrder = useCallback(() => {
    setExtraction(null);
    setConfirmedOrderId(null);
  }, []);

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold mb-2">Raccolta Ordini Vocale (Comandi)</h1>
            <p className="text-gray-400 text-lg">
              Detta l&apos;ordine del cliente: l&apos;AI lo riconcilia con il catalogo prima di salvarlo.
            </p>
          </div>

          <div className="shrink-0">
            {sessionStatus === 'loading' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-800 border border-gray-700 text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Verifica sessione…
              </span>
            )}
            {sessionStatus === 'active' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-500/15 border border-green-700/50 text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Sessione attiva{tenantName ? ` — ${tenantName}` : userEmail ? ` — ${userEmail}` : ''}
              </span>
            )}
            {(sessionStatus === 'unauthenticated' || sessionStatus === 'no-tenant') && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/15 border border-red-700/50 text-red-400">
                <ShieldAlert className="w-3.5 h-3.5" />
                {sessionStatus === 'no-tenant' ? 'Nessun tenant associato' : 'Sessione non attiva'}
              </span>
            )}
          </div>
        </div>

        {sessionError && (
          <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">{sessionError}</div>
        )}

        {sessionStatus === 'no-tenant' && (
          <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
            Il tuo utente non è associato a nessun tenant. Contatta il supporto prima di registrare ordini vocali.
          </div>
        )}

        {/* Flusso a stati */}
        {sessionStatus === 'active' && (
          confirmedOrderId ? (
            // Stato 4: ordine confermato
            <div className="bg-gray-800 border border-green-700/50 rounded-xl p-8 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <div>
                <p className="text-xl font-semibold text-white">Ordine confermato e salvato</p>
                <p className="text-sm text-gray-400 mt-1">
                  Riferimento ordine: <span className="font-mono text-gray-300">{confirmedOrderId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleNewOrder}
                className="flex items-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Nuovo Ordine Vocale
              </button>
            </div>
          ) : extraction ? (
            // Stato 3: revisione ordine estratto dall'AI
            <OrderReviewCard extraction={extraction} onOrderConfirmed={handleOrderConfirmed} />
          ) : (
            // Stato 1 + 2: registrazione in attesa / elaborazione (feedback gestito internamente dal widget)
            <VoiceInputWidget onOrderParsed={handleOrderParsed} />
          )
        )}
      </div>
    </div>
  );
}
