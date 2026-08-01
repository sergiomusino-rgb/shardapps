'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { Loader2, ShieldAlert } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface AuthGuardProps {
  children: React.ReactNode;
  /** Se true, richiede anche che l'utente abbia un tenant associato */
  requireTenant?: boolean;
  /** Pagina di redirect se non autenticato (default: /login) */
  redirectTo?: string;
  /** Mostra uno spinner durante il caricamento */
  showLoader?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// AuthGuard Component
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Componente di protezione rotte.
 * Avvolge le pagine che richiedono autenticazione.
 *
 * Flusso:
 * 1. Verifica la sessione Supabase (getSession)
 * 2. Se non autenticato → redirect a /login (con returnUrl)
 * 3. Se requireTenant=true → verifica che l'utente abbia membership in un tenant
 * 4. Se tutto ok → renderizza children
 */
export default function AuthGuard({
  children,
  requireTenant = false,
  redirectTo = '/login',
  showLoader = true,
}: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        // Use shared browser client to avoid multiple GoTrueClient instances
        const supabase = supabaseBrowser;

        // ── Step 1: Verifica sessione ──────────────────────────────────
        // First try to get session from storage (faster, synchronous check)
        const stored = getStoredSession();
        
        // Then verify with server (async)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (cancelled) return;

        // If no session from server but we have stored session, wait a bit and retry
        let currentSession = session;
        
        if ((sessionError || !currentSession?.user) && stored) {
          // Give it a moment for the session to sync
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Try again
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          
          if (cancelled) return;
          
          if (!retrySession?.user) {
            // Still no valid session after retry
            const returnUrl = encodeURIComponent(pathname);
            router.replace(`${redirectTo}?returnUrl=${returnUrl}`);
            return;
          }
          
          // Use the retry session
          currentSession = retrySession;
        } else if (sessionError || !currentSession?.user) {
          // No session at all
          const returnUrl = encodeURIComponent(pathname);
          router.replace(`${redirectTo}?returnUrl=${returnUrl}`);
          return;
        }

        // ── Step 2: Verifica tenant (opzionale) ────────────────────────
        if (requireTenant) {
          const userId = currentSession?.user?.id;
          if (!userId) {
            const returnUrl = encodeURIComponent(pathname);
            router.replace(`${redirectTo}?returnUrl=${returnUrl}`);
            return;
          }

          const { data: membership, error: memberError } = await supabase
            .from('tenant_members')
            .select('tenant_id')
            .eq('user_id', userId)
            .limit(1)
            .single();

          if (cancelled) return;

          if (memberError || !membership) {
            // Prova a creare automaticamente il tenant per l'utente tramite API
            if (userId && currentSession?.access_token) {
              try {
                const response = await fetch('/api/tenants/create', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentSession.access_token}`,
                  },
                  body: JSON.stringify({
                    name: currentSession.user.email ? `Workspace di ${currentSession.user.email}` : 'Il mio Workspace',
                    slug: `workspace-${userId.slice(0, 8)}`,
                  }),
                });

                if (response.ok) {
                  // Tenant creato con successo, continua
                  if (!cancelled) {
                    setIsAuthorized(true);
                    setIsLoading(false);
                  }
                  return;
                }
              } catch (createErr) {
                console.error('[AuthGuard] Errore creazione tenant:', createErr);
              }
            }
            
            setAuthError(
              'Nessun workspace trovato. Completa la registrazione o crea un nuovo tenant.'
            );
            setIsLoading(false);
            return;
          }
        }

        // ── Step 3: Autorizzato ────────────────────────────────────────
        if (!cancelled) {
          setIsAuthorized(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[AuthGuard] Unexpected error:', err);
          setAuthError('Errore di autenticazione. Riprova.');
          setIsLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [pathname, requireTenant, redirectTo, router]);

  // ─── Loading State ───────────────────────────────────────────────────────
  if (isLoading && showLoader) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto mb-3 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-400">Verifica accesso...</p>
        </div>
      </div>
    );
  }

  // ─── Auth Error State ────────────────────────────────────────────────────
  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="mb-4 inline-flex rounded-full bg-red-500/10 p-4">
            <ShieldAlert size={32} className="text-red-400" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-white">Accesso Negato</h2>
          <p className="mb-6 text-sm leading-relaxed text-slate-400">{authError}</p>
          <div className="flex flex-col gap-3">
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Vai al Login
            </a>
            <a
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
            >
              Vedi Piani
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ─── Authorized ─────────────────────────────────────────────────────────
  if (isAuthorized) {
    return <>{children}</>;
  }

  // Fallback: non mostrare nulla durante il redirect
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Recupera sessione da localStorage (evita race condition)
// ═══════════════════════════════════════════════════════════════════════════

function getStoredSession(): boolean {
  try {
    // Supabase salva la sessione in localStorage con chiave specifica
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1];
    if (!projectRef) return false;

    const key = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    return Boolean(parsed?.access_token);
  } catch {
    return false;
  }
}