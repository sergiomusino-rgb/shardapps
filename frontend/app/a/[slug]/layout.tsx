'use client';

import { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { LanguageProvider } from '@/src/lib/LanguageContext';
import { AuthProvider } from '@/src/lib/AuthContext';
import { ThemeProvider } from '@/src/lib/ThemeContext';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser as supabase } from '@/src/lib/supabase-browser';
import TrialPaywallModal from './app/TrialPaywallModal';
import TrialBanner from './app/TrialBanner';
import ZeusXBrandingFooter from '@/components/ZeusXBrandingFooter';
import Link from 'next/link';
import { AppInfoProvider, type AuthMode } from './AppInfoContext';
import { getClientSubscriptionPrice } from '@/lib/pricing';
import { getDesignTokens } from '@/lib/designTokens';
import { getDemoApp } from '@/lib/demoApps';

type AppStatus = 'trial' | 'active' | 'expired' | 'past_due' | 'canceled';

interface AppInfo {
  id: string;
  name: string;
  status: AppStatus;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  client_subscription_price: number | null;
  client_price: number | null;
  auth_mode: AuthMode;
  config: Record<string, unknown> | null;
  tenant_id: string;
  app_type: string | null;
}

// Estrae il settore dell'app dallo schema salvato (blueprint.sector per la
// pipeline Totalum, sector diretto per la pipeline Creator) — stessa logica
// usata da app/page.tsx per guidare getDesignTokens. Serve qui perché questo
// layout avvolge anche gli stati (loading, gate) che page.tsx non controlla.
function extractSector(config: Record<string, unknown> | null | undefined): string {
  if (!config) return '';
  const cfg = config as { blueprint?: { sector?: string }; sector?: string };
  return cfg.blueprint?.sector || cfg.sector || '';
}

export default function AppLayout({ children }: PropsWithChildren) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname() || '';
  const slug = params.slug as string;

  // Flag di test per sviluppatori: ?simulate_expired=1 forza il paywall
  // bloccante senza dover aspettare la scadenza reale del trial. Solo fuori
  // produzione, per non essere sfruttabile dai clienti finali. Letto da
  // window.location invece di useSearchParams per evitare il vincolo di
  // Suspense boundary (qui non serve il valore durante il prerendering).
  const [devSimulateExpired, setDevSimulateExpired] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      setDevSimulateExpired(new URLSearchParams(window.location.search).get('simulate_expired') === '1');
    }
  }, []);

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'admin' | 'reseller' | null>(null);
  const [gateDenied, setGateDenied] = useState(false);

  const designTokens = useMemo(() => getDesignTokens(extractSector(appInfo?.config)), [appInfo?.config]);

  // ─── Classificazione della route corrente ───────────────────────────────
  const isRootLanding = pathname === `/a/${slug}`;
  const isBlockedPage = pathname.startsWith(`/a/${slug}/blocked`);
  const isOwnerOnly = pathname.startsWith(`/a/${slug}/settings`) || pathname.startsWith(`/a/${slug}/admin`);
  const isClientProtected =
    pathname.startsWith(`/a/${slug}/dashboard`) ||
    pathname.startsWith(`/a/${slug}/app`) ||
    pathname.startsWith(`/a/${slug}/gestionale`) ||
    pathname.startsWith(`/a/${slug}/fatture`);
  // Solo la shell app/dashboard/gestionale (sidebar + topbar + contenuto) ha
  // bisogno di restare bloccata all'altezza del viewport: sidebar e footer
  // fissi, scroll solo nell'area contenuto. Le altre route (fatture,
  // settings, admin, ecc.) restano a scroll di pagina naturale come prima.
  const isAppShellRoute =
    pathname.startsWith(`/a/${slug}/dashboard`) ||
    pathname.startsWith(`/a/${slug}/app`) ||
    pathname.startsWith(`/a/${slug}/gestionale`);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Slug delle demo dello Showcase (dashboard/showcase): non sono app
      // reali, non esiste alcuna riga in `apps` per questi slug. Costruiamo
      // l'AppInfo localmente per mostrare comunque la landing pubblica reale,
      // senza toccare Supabase né richiedere alcun login/gate.
      const demo = getDemoApp(slug);
      if (demo) {
        if (!cancelled) {
          setAppInfo({
            id: `demo-${slug}`,
            name: demo.name,
            status: 'active',
            trial_ends_at: null,
            stripe_subscription_id: null,
            client_subscription_price: 25,
            client_price: 25,
            auth_mode: 'supabase',
            config: {
              sector: demo.sector,
              description: demo.description,
              appName: demo.name,
              branding: { company_name: demo.name },
              schema: { tables: demo.tables },
            },
            tenant_id: '',
            app_type: null,
          });
          setLoading(false);
        }
        return;
      }

      const [{ data: rawApp }, { data: { user } }] = await Promise.all([
        supabase
          .from('apps')
          .select('id, name, status, trial_ends_at, stripe_subscription_id, client_subscription_price, client_price, auth_mode, config, tenant_id, app_type')
          .eq('slug', slug)
          .single(),
        supabase.auth.getUser(),
      ]);
      const app = rawApp as unknown as AppInfo | null;

      if (cancelled) return;
      setAppInfo(app);

      // Ritorno da Stripe Checkout: verifica subito la sessione e sblocca
      // l'abbonamento senza aspettare il webhook (in locale il webhook non
      // arriva mai senza `stripe listen`, e anche in produzione questo evita
      // di mostrare per qualche secondo il pulsante "Abbonati" già pagato).
      if (app && typeof window !== 'undefined') {
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get('checkout') === 'success' && searchParams.get('session_id')) {
          const sessionId = searchParams.get('session_id')!;
          try {
            const res = await fetch(`/api/a/${slug}/verify-checkout-session?session_id=${encodeURIComponent(sessionId)}`);
            const data = await res.json();
            if (data.status === 'active' && !cancelled) {
              setAppInfo((prev) => (prev ? { ...prev, status: 'active' } : prev));
            }
          } catch {
            // Se la verifica fallisce il webhook rimane comunque la fonte di
            // verità: l'abbonamento risulterà attivo appena arriva l'evento.
          }
          // Rimuove i parametri dall'URL per non ri-verificare ad ogni refresh.
          window.history.replaceState(null, '', window.location.pathname);
        }
      }

      // ─── Gate owner-only (/settings, /admin): invariato, richiede sessione
      // Supabase Auth della piattaforma + ruolo admin/reseller su `profiles`.
      if (isOwnerOnly) {
        if (!user) {
          setGateDenied(true);
          setLoading(false);
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();
        if (profile && ((profile as any).role === 'admin' || (profile as any).role === 'reseller')) {
          setUserRole((profile as any).role);
        }
        setLoading(false);
        return;
      }

      // ─── Gate cliente (dashboard/app/fatture) ────────────────────────────
      // Comandi AI (app_type='comandi_ai'): niente app_users/client_password,
      // gli operatori sono già membri del tenant proprietario (stesso
      // Supabase Auth di /comandi e /dashboard/comandi) — si verifica
      // tenant_members invece di app_users. Flusso landing→login→dashboard
      // dedicato a QUESTA istanza (non il funnel generico /comandi), come le
      // altre app generate: si torna a /a/[slug]/login, non a /comandi.
      if (isClientProtected && app?.app_type === 'comandi_ai') {
        if (!user) {
          router.replace(`/a/${slug}/login`);
          return;
        }
        const { data: membership } = await supabase
          .from('tenant_members')
          .select('tenant_id')
          .eq('user_id', user.id)
          .eq('tenant_id', app.tenant_id)
          .maybeSingle();
        if (!membership) {
          router.replace(`/a/${slug}/login`);
          return;
        }
      } else if (isClientProtected && app?.auth_mode === 'supabase') {
        // App a schema generato con auth_mode='supabase': richiede sessione
        // Supabase Auth + membership attiva in app_users (invariato).
        if (!user) {
          router.replace(`/a/${slug}/login`);
          return;
        }
        const { data: appUser } = await supabase
          .from('app_users')
          .select('id')
          .eq('user_id', user.id)
          .eq('app_id', app.id)
          .eq('is_active', true)
          .maybeSingle();
        if (!appUser) {
          router.replace(`/a/${slug}/login`);
          return;
        }
      }

      // Ruolo owner opzionale (solo per mostrare il link "Torna alla Dashboard"),
      // non blocca mai il rendering delle route pubbliche/cliente.
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();
        if (profile && ((profile as any).role === 'admin' || (profile as any).role === 'reseller')) {
          setUserRole((profile as any).role);
        }
      }

      setLoading(false);
    };

    init();
    return () => { cancelled = true; };
  }, [slug, pathname, isOwnerOnly, isClientProtected, router]);

  // ─── Ripristino da bfcache ──────────────────────────────────────────────
  // I browser moderni possono ripristinare questa pagina dalla back/forward
  // cache quando l'utente torna indietro (tasto Indietro, o un link) da
  // un'altra pagina (es. /dashboard/management dopo aver cambiato il
  // prezzo, o dopo un checkout Stripe) SENZA rieseguire alcun JS: lo stato
  // React resta congelato com'era PRIMA di uscire da questa pagina, quindi
  // `appInfo` mostrerebbe dati ormai superati (prezzo, stato abbonamento)
  // finché non si ricarica manualmente. L'evento `pageshow` con
  // `event.persisted === true` è il segnale standard di un ripristino da
  // bfcache: a quel punto rileggiamo solo i campi che possono cambiare "da
  // fuori" — non l'intera init() sopra, per non ripetere redirect/gate.
  useEffect(() => {
    if (!appInfo?.id) return;

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      supabase
        .from('apps')
        .select('status, trial_ends_at, stripe_subscription_id, client_subscription_price, client_price')
        .eq('id', appInfo.id)
        .single()
        .then(({ data }) => {
          const fresh = data as unknown as Pick<
            AppInfo,
            'status' | 'trial_ends_at' | 'stripe_subscription_id' | 'client_subscription_price' | 'client_price'
          > | null;
          if (fresh) setAppInfo((prev) => (prev ? { ...prev, ...fresh } : prev));
        });
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [appInfo?.id]);

  // ─── LOGICA DI BLOCCO ACCESSO ──────────────────────────────────────────────
  // L'app viene bloccata se:
  // 1. Lo status è 'expired' (trial scaduto e nessun abbonamento attivo)
  // 2. Lo status è 'past_due' o 'canceled' (abbonamento non in regola)
  // 3. Lo status è 'trial' E la data di trial è scaduta E non c'è subscription_id attivo
  const isAppBlocked = (() => {
    if (!appInfo) return false;
    if (devSimulateExpired) return true;
    if (appInfo.status === 'active') return false;
    if (appInfo.status === 'past_due' || appInfo.status === 'canceled') return true;
    if (appInfo.status === 'expired') return true;
    if (appInfo.status === 'trial') {
      if (appInfo.stripe_subscription_id) return false;
      if (appInfo.trial_ends_at && new Date(appInfo.trial_ends_at) < new Date()) return true;
    }
    return false;
  })();

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: designTokens.colors.bg, fontFamily: designTokens.fonts.body }}
      >
        <div className="text-center">
          <div
            className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: designTokens.colors.primary, borderTopColor: 'transparent' }}
          ></div>
          <p style={{ color: designTokens.colors['text-secondary'] }}>Caricamento...</p>
        </div>
      </div>
    );
  }

  // Owner-only non autenticato: unico caso che mostra ancora il gate storico
  // "Accedi o Registrati" verso il login della piattaforma.
  if (gateDenied) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: designTokens.colors.bg, fontFamily: designTokens.fonts.body }}
      >
        <div
          className="max-w-md w-full backdrop-blur-md rounded-2xl p-8"
          style={{ background: designTokens.colors.surface, border: `1px solid ${designTokens.colors.border}` }}
        >
          <h1
            className="text-2xl font-bold mb-6 text-center"
            style={{ color: designTokens.colors.text, fontFamily: designTokens.fonts.headline }}
          >
            Accedi o Registrati
          </h1>
          <p className="mb-6 text-center" style={{ color: designTokens.colors['text-secondary'] }}>
            Accedi per utilizzare questa applicazione
          </p>
          <button
            onClick={() => router.push('/login')}
            className="w-full py-3 px-6 rounded-xl font-semibold transition-colors"
            style={{ background: designTokens.colors.primary, color: '#fff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = designTokens.colors['primary-hover']; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = designTokens.colors.primary; }}
          >
            Accedi / Registrati
          </button>
        </div>
        <ZeusXBrandingFooter />
      </div>
    );
  }

  // Prezzo mensile reale pagato dal cliente finale: deciso dal reseller per
  // questa app in Management (non fisso a 25€, vedi lib/pricing.ts).
  const clientPrice = appInfo ? getClientSubscriptionPrice(appInfo) : 25;

  // Paywall: si applica a tutte le route tranne la landing pubblica e la
  // pagina "app sospesa" (che deve restare visibile per spiegare il blocco).
  // Vale anche per Comandi AI: il blocco per trial scaduto/abbonamento non in
  // regola è logica di business, non "chrome" ZeusX da nascondere.
  if (isAppBlocked && appInfo && !isRootLanding && !isBlockedPage) {
    return <TrialPaywallModal appName={appInfo.name} slug={slug} trialEndsAt={appInfo.trial_ends_at || new Date().toISOString()} price={clientPrice} />;
  }

  // ─── Isolamento full white-label per Comandi AI ────────────────────────
  // Nessun banner trial, nessun link "Torna alla Dashboard", nessun
  // ZeusXBrandingFooter, nessun ThemeProvider/AuthProvider (concetti legati
  // al motore a schema dinamico/app_users, qui non pertinenti): solo il
  // contenitore full-screen, ogni pagina figlia (dashboard, agente, login)
  // gestisce da sé il proprio loading/gate.
  if (appInfo?.app_type === 'comandi_ai') {
    return (
      <LanguageProvider>
        <AppInfoProvider
          value={{
            appId: appInfo.id,
            slug,
            authMode: appInfo.auth_mode,
            appName: appInfo.name,
            config: appInfo.config,
            status: appInfo.status,
            trialEndsAt: appInfo.trial_ends_at,
            stripeSubscriptionId: appInfo.stripe_subscription_id,
            clientPrice,
            appType: appInfo.app_type,
            tenantId: appInfo.tenant_id,
          }}
        >
          <div className="min-h-screen">{children}</div>
        </AppInfoProvider>
      </LanguageProvider>
    );
  }

  // Banner trial: discreto, solo nelle route cliente (dashboard/app/fatture)
  // mentre il trial è ancora attivo e non ancora scaduto.
  const showTrialBanner = isClientProtected && appInfo?.status === 'trial' && !!appInfo.trial_ends_at && new Date(appInfo.trial_ends_at) >= new Date();

  return (
    <LanguageProvider>
      <ThemeProvider slug={slug}>
        <AuthProvider slug={slug} appId={appInfo?.id}>
          <AppInfoProvider
            value={{
              appId: appInfo?.id || '',
              slug,
              authMode: appInfo?.auth_mode || 'legacy',
              appName: appInfo?.name || '',
              config: appInfo?.config || null,
              status: appInfo?.status || null,
              trialEndsAt: appInfo?.trial_ends_at || null,
              stripeSubscriptionId: appInfo?.stripe_subscription_id || null,
              clientPrice,
              appType: appInfo?.app_type || null,
              tenantId: appInfo?.tenant_id || '',
            }}
          >
            <div
              className={isAppShellRoute ? 'flex h-screen flex-col overflow-hidden' : 'flex flex-col min-h-screen'}
              style={{ background: designTokens.colors.bg, fontFamily: designTokens.fonts.body }}
            >
              {showTrialBanner && appInfo?.trial_ends_at && (
                <TrialBanner slug={slug} trialEndsAt={appInfo.trial_ends_at} price={clientPrice} />
              )}
              {userRole && appInfo && (
                <div className="p-4">
                  <Link
                    href={`/dashboard/projects/${appInfo.id}`}
                    className="inline-flex items-center gap-2 text-sm transition-colors"
                    style={{ color: designTokens.colors['text-secondary'] }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = designTokens.colors.primary; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = designTokens.colors['text-secondary']; }}
                  >
                    <span style={{ color: designTokens.colors.primary }}>←</span>
                    <span>Torna alla Dashboard</span>
                  </Link>
                </div>
              )}
              <div className={isAppShellRoute ? 'flex-1 overflow-hidden' : 'flex-1'}>
                {children}
              </div>
              {/* La shell app/dashboard mostra già il brand ZeusX nel footer
                  della sidebar (icona + "ZeusX by MUSINO"): niente striscia
                  duplicata in fondo alla pagina. Nelle altre route (fatture,
                  settings, admin...) resta invariata. */}
              {!isAppShellRoute && <ZeusXBrandingFooter />}
            </div>
          </AppInfoProvider>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
