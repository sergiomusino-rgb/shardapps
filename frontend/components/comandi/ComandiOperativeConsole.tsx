'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Home, LayoutDashboard, Loader2, LogOut, RotateCcw, Settings, ShieldAlert } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';
import VoiceInputWidget from '@/components/comandi/VoiceInputWidget';
import OrderReviewCard from '@/components/comandi/OrderReviewCard';
import type { VoiceOrderExtraction } from '@/types/comandi';

type SessionStatus = 'loading' | 'active' | 'no-tenant' | 'unauthenticated';

export interface ComandiOperativeConsoleProps {
  /** Classi del contenitore esterno: la dashboard ZeusX usa un box centrato,
   * l'istanza standalone (/a/[slug]/app) usa un layout full-screen. */
  className?: string;
  /** Dove mandare un utente senza sessione. La dashboard ZeusX rimanda al
   * login della piattaforma; l'istanza standalone rimanda al login
   * dell'istanza. */
  unauthenticatedRedirect?: string;
  /** Slug dell'istanza standalone (/a/[slug]/app): se presente mostra il
   * menu Landing/Dashboard/Logout. Omesso nella dashboard ZeusX, dove questi
   * link non hanno senso. */
  instanceSlug?: string;
}

export default function ComandiOperativeConsole({
  className = 'p-8',
  unauthenticatedRedirect = '/login',
  instanceSlug,
}: ComandiOperativeConsoleProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isMenuOpen]);

  const handleLogout = async () => {
    await supabaseBrowser.auth.signOut();
    router.push(instanceSlug ? `/a/${instanceSlug}` : '/login');
  };

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
          console.error('[ComandiOperativeConsole] Errore getSession:', sessionErr);
          setSessionError(t('comandi_error_session_fetch'));
          setSessionStatus('unauthenticated');
          return;
        }

        if (!session?.user) {
          setSessionStatus('unauthenticated');
          router.push(unauthenticatedRedirect);
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
        console.error('[ComandiOperativeConsole] Errore verifica sessione/tenant:', err);
        if (!cancelled) {
          setSessionError(t('comandi_error_network'));
          setSessionStatus('unauthenticated');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, t, unauthenticatedRedirect]);

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
    <div className={className}>
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold mb-2">{t('comandi_page_title')}</h1>
            <p className="text-gray-400 text-lg">{t('comandi_page_subtitle')}</p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {instanceSlug && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((v) => !v)}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  aria-label={t('comandi_console_menu_aria')}
                  aria-expanded={isMenuOpen}
                >
                  <Settings className="w-4 h-4" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-gray-700 bg-gray-900 shadow-xl py-1.5 z-20">
                    <Link
                      href={`/a/${instanceSlug}`}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <Home className="w-4 h-4" />
                      {t('comandi_console_menu_back_landing')}
                    </Link>
                    <Link
                      href={`/a/${instanceSlug}/dashboard`}
                      className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      {t('comandi_console_menu_dashboard')}
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('comandi_console_menu_logout')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {sessionStatus === 'loading' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-800 border border-gray-700 text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('comandi_session_checking')}
              </span>
            )}
            {sessionStatus === 'active' && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-500/15 border border-green-700/50 text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                {t('comandi_session_active')}{tenantName ? ` — ${tenantName}` : userEmail ? ` — ${userEmail}` : ''}
              </span>
            )}
            {(sessionStatus === 'unauthenticated' || sessionStatus === 'no-tenant') && (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-500/15 border border-red-700/50 text-red-400">
                <ShieldAlert className="w-3.5 h-3.5" />
                {sessionStatus === 'no-tenant' ? t('comandi_session_no_tenant') : t('comandi_session_unauthenticated')}
              </span>
            )}
          </div>
        </div>

        {sessionError && (
          <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">{sessionError}</div>
        )}

        {sessionStatus === 'no-tenant' && (
          <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
            {t('comandi_no_tenant_banner')}
          </div>
        )}

        {/* Flusso a stati */}
        {sessionStatus === 'active' && (
          confirmedOrderId ? (
            // Stato 4: ordine confermato
            <div className="bg-gray-800 border border-green-700/50 rounded-xl p-8 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <div>
                <p className="text-xl font-semibold text-white">{t('comandi_order_confirmed_title')}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {t('comandi_order_reference_label')} <span className="font-mono text-gray-300">{confirmedOrderId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleNewOrder}
                className="flex items-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                {t('comandi_new_order_button')}
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
