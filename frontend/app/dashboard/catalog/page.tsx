'use client';

// ─── App Catalog UI (App Catalog & Instance Model, STEP 3 FASE 9 + STEP 4) ──
// Minima di proposito ("NON costruire ancora una marketplace complessa" /
// "NON fare redesign"): elenca i prodotti attivi (letti direttamente via
// RLS, stesso pattern di dashboard/projects/page.tsx — supabaseBrowser +
// SELECT, nessun endpoint GET dedicato: la policy "app_products_select_
// active", migration 20260815000000) e, per ciascuno, lo stato reale
// dell'istanza già attivata dal tenant (apps.status, source of truth STEP 4
// — letta anch'essa via RLS esistente, apps_select_tenant_member, nessuna
// nuova policy). Tre azioni, ciascuna un solo POST verso l'endpoint
// dedicato, nessuna logica di pagamento qui:
// - "Attiva" -> /api/catalog/products/[productSlug]/provision (STEP 3)
// - "Abbonati ora"/"Aggiorna pagamento"/"Riattiva abbonamento" ->
//   /api/catalog/products/[productSlug]/checkout (STEP 4, redirect a Stripe)
// - "Cancella abbonamento" -> /api/catalog/products/[productSlug]/cancel
//   (STEP 4, cancel_at_period_end — lo stato finale arriva dal webhook)
// Nessun filtro/ricerca/categoria, nessuna gestione versioni in UI.

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { Loader2, AlertCircle, ExternalLink, Store } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { useRouter } from 'next/navigation';

interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  price_monthly: number;
  trial_days: number;
}

interface ProvisionSuccess {
  appId: string;
  slug: string;
  url: string;
  alreadyProvisioned: boolean;
}

// Etichetta/colore per apps.status (source of truth, STEP 4) — solo lettura,
// nessuna logica di business qui: la UI riflette lo stato, non lo decide.
const STATUS_META: Record<string, { label: string; color: string }> = {
  trial: { label: 'In prova', color: '#a78bfa' },
  active: { label: 'Abbonamento attivo', color: '#22c55e' },
  past_due: { label: 'Pagamento non riuscito', color: '#f59e0b' },
  canceled: { label: 'Abbonamento cancellato', color: '#ef4444' },
  expired: { label: 'Prova scaduta', color: '#ef4444' },
};

// Istanza già provisionata (STEP 3) di un prodotto per il tenant corrente —
// letta direttamente via RLS (apps_select_tenant_member, invariata: nessuna
// nuova policy per lo STEP 4), stesso pattern di app_products sotto. status
// è la source of truth del lifecycle billing (decisione STEP 4): questa UI
// si limita a rifletterlo, non introduce un secondo stato.
interface Instance {
  id: string;
  slug: string;
  status: string;
  trial_ends_at: string | null;
}

export default function CatalogPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [instances, setInstances] = useState<Record<string, Instance>>({}); // keyed by product_id
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<string | null>(null); // slug in checkout/cancel
  const [results, setResults] = useState<Record<string, ProvisionSuccess>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      // Cast mirato: frontend/types/database.ts non copre ancora
      // app_products (richiede di rigenerare i tipi dopo la migration
      // 20260815000000, nessun impatto a runtime) — stesso pattern già
      // usato altrove nel progetto (es. dashboard/projects/page.tsx per
      // tenant_members).
      const { data, error: queryError } = await (supabaseBrowser.from('app_products' as any) as any)
        .select('id, slug, name, description, icon, category, price_monthly, trial_days')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (queryError) {
        setError(queryError.message || 'Errore caricamento catalogo');
      } else {
        setProducts((data as Product[]) || []);
      }

      // Istanze già attivate dal tenant (STEP 4): serve a mostrare lo stato
      // reale (trial/active/past_due/canceled/expired) invece di perderlo
      // ad ogni refresh della pagina — prima dello STEP 4 questa pagina non
      // leggeva mai `apps`, solo la risposta in-memory dell'ultima
      // provisioning fatta nella stessa sessione. RLS (apps_select_tenant_
      // member) scopes già alle sole app del tenant corrente, nessun filtro
      // tenant_id lato client necessario o possibile da falsificare.
      const { data: instanceRows, error: instanceError } = await (supabaseBrowser.from('apps' as any) as any)
        .select('id, slug, status, trial_ends_at, product_id')
        .not('product_id', 'is', null)
        .eq('is_active', true);

      if (!instanceError && instanceRows) {
        const byProduct: Record<string, Instance> = {};
        for (const row of instanceRows as Array<Instance & { product_id: string }>) {
          byProduct[row.product_id] = { id: row.id, slug: row.slug, status: row.status, trial_ends_at: row.trial_ends_at };
        }
        setInstances(byProduct);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore imprevisto');
    }
    setLoading(false);
  }

  async function handleActivate(slug: string) {
    setProvisioning(slug);
    setErrors((prev) => ({ ...prev, [slug]: '' }));
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setErrors((prev) => ({ ...prev, [slug]: 'Devi effettuare il login.' }));
        return;
      }

      const res = await fetch(`/api/catalog/products/${slug}/provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success && data.data) {
        setResults((prev) => ({
          ...prev,
          [slug]: {
            appId: data.data.appId,
            slug: data.data.slug,
            url: data.data.url,
            alreadyProvisioned: !!data.data.alreadyProvisioned,
          },
        }));
        // Rientra subito nella stessa fonte (`instances`) usata dopo un
        // refresh: senza questo, il pulsante "Attiva" resterebbe visibile
        // finché l'utente non ricarica la pagina, nonostante l'istanza
        // esista già.
        setInstances((prev) => ({
          ...prev,
          [data.data.productId]: { id: data.data.appId, slug: data.data.slug, status: 'trial', trial_ends_at: data.data.trialEndsAt || null },
        }));
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        setErrors((prev) => ({ ...prev, [slug]: data.message || 'Slot esauriti.' }));
        router.push(data.redirectTo || '/pricing');
      } else {
        setErrors((prev) => ({ ...prev, [slug]: data.error || 'Errore durante l\'attivazione.' }));
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [slug]: err instanceof Error ? err.message : 'Errore di connessione.' }));
    } finally {
      setProvisioning(null);
    }
  }

  // STEP 4: avvia il checkout Stripe per far passare l'istanza (già
  // provisionata) da trial a un vero abbonamento — riusa esclusivamente
  // /api/catalog/products/[productSlug]/checkout, nessuna logica di
  // pagamento qui, solo il redirect alla pagina Stripe hosted (stesso
  // pattern di TrialBanner in a/[slug]).
  async function handleCheckout(slug: string) {
    setBillingAction(slug);
    setErrors((prev) => ({ ...prev, [slug]: '' }));
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setErrors((prev) => ({ ...prev, [slug]: 'Devi effettuare il login.' }));
        return;
      }

      const res = await fetch(`/api/catalog/products/${slug}/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success && data.data?.url) {
        window.location.href = data.data.url;
      } else {
        setErrors((prev) => ({ ...prev, [slug]: data.error || 'Errore durante l\'avvio del pagamento.' }));
        setBillingAction(null);
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [slug]: err instanceof Error ? err.message : 'Errore di connessione.' }));
      setBillingAction(null);
    }
  }

  // STEP 4: disdice l'abbonamento (cancel_at_period_end su Stripe) — lo
  // stato finale (status='canceled') arriva dal webhook esistente quando il
  // periodo corrente termina davvero, questa azione non lo forza mai qui.
  async function handleCancel(slug: string) {
    setBillingAction(slug);
    setErrors((prev) => ({ ...prev, [slug]: '' }));
    setNotices((prev) => ({ ...prev, [slug]: '' }));
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setErrors((prev) => ({ ...prev, [slug]: 'Devi effettuare il login.' }));
        return;
      }

      const res = await fetch(`/api/catalog/products/${slug}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        setNotices((prev) => ({
          ...prev,
          [slug]: 'Disdetta registrata: resterà attiva fino alla fine del periodo corrente già pagato.',
        }));
      } else {
        setErrors((prev) => ({ ...prev, [slug]: data.error || 'Errore durante la disdetta.' }));
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [slug]: err instanceof Error ? err.message : 'Errore di connessione.' }));
    } finally {
      setBillingAction(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#94a3b8' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <span>{t('header_loading')}...</span>
        </div>
        <style jsx global>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Store size={26} color="#6366f1" />
          <h1 style={{ color: '#ffffff', fontSize: '32px', fontWeight: 700, margin: 0 }}>{t('nav_catalog')}</h1>
        </div>
        <p style={{ color: '#94a3b8', fontSize: '15px', margin: 0 }}>
          Prodotti ShardApps pronti all&apos;attivazione — installa un&apos;istanza dedicata per la tua organizzazione.
        </p>
      </div>

      {error && (
        <div style={{ maxWidth: '1200px', margin: '0 auto 24px', padding: '16px', borderRadius: '12px', background: '#ef444415', border: '1px solid #ef444440', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AlertCircle size={20} style={{ color: '#ef4444' }} />
          <span style={{ color: '#ef4444' }}>{error}</span>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛍️</div>
            <h2 style={{ color: '#ffffff', fontSize: '20px', fontWeight: 600 }}>Nessun prodotto disponibile al momento</h2>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {products.map((product) => {
              const result = results[product.slug];
              const instance = instances[product.id];
              const activationError = errors[product.slug];
              const notice = notices[product.slug];
              const isProvisioning = provisioning === product.slug;
              const isBillingBusy = billingAction === product.slug;
              const statusMeta = instance ? STATUS_META[instance.status] : null;
              // Relativo, non l'URL assoluto restituito da /provision: dashboard
              // e /a/[slug] vivono nello stesso Next.js app, un percorso
              // relativo funziona identico e non dipende da NEXT_PUBLIC_APP_URL.
              const appHref = instance ? `/a/${instance.slug}` : result ? `/a/${result.slug}` : null;
              // "Abbonati ora"/"Aggiorna pagamento"/"Riattiva" hanno tutti lo
              // stesso significato per questa UI: avvia un checkout Stripe per
              // questa istanza. Nascosto per i prodotti placeholder a 0€ (STEP
              // 3 seed): checkout li rifiuterebbe comunque con FREE_PRODUCT.
              const canCheckout = product.price_monthly > 0 && instance && instance.status !== 'active';

              return (
                <div
                  key={product.id}
                  style={{ background: '#1e293b', borderRadius: '16px', border: '1px solid #334155', padding: '24px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '28px' }}>{product.icon || '📦'}</span>
                    <div>
                      <h3 style={{ color: '#ffffff', fontSize: '18px', fontWeight: 600, margin: 0 }}>{product.name}</h3>
                      {product.category && (
                        <span style={{ color: '#64748b', fontSize: '12px' }}>{product.category}</span>
                      )}
                    </div>
                  </div>

                  {product.description && (
                    <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>{product.description}</p>
                  )}

                  <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '13px', color: '#cbd5e1' }}>
                    <span>
                      {product.price_monthly > 0 ? `€${product.price_monthly.toFixed(2)}/mese` : 'Gratuito'}
                    </span>
                    <span>·</span>
                    <span>{product.trial_days} giorni di prova</span>
                  </div>

                  {statusMeta && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '999px', background: `${statusMeta.color}20`, color: statusMeta.color, fontSize: '12px', fontWeight: 600, marginBottom: '16px' }}>
                      {statusMeta.label}
                    </div>
                  )}

                  {instance ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {appHref && (
                        <a
                          href={appHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', border: 'none', background: '#6366f1', color: '#fff', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}
                        >
                          <ExternalLink size={16} /> Apri l&apos;app
                        </a>
                      )}

                      {canCheckout && (
                        <button
                          onClick={() => handleCheckout(product.slug)}
                          disabled={isBillingBusy}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontSize: '14px', fontWeight: 600, cursor: isBillingBusy ? 'not-allowed' : 'pointer' }}
                        >
                          {isBillingBusy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                          {instance.status === 'trial' ? 'Abbonati ora' : instance.status === 'past_due' ? 'Aggiorna pagamento' : 'Riattiva abbonamento'}
                        </button>
                      )}

                      {instance.status === 'active' && (
                        <button
                          onClick={() => handleCancel(product.slug)}
                          disabled={isBillingBusy}
                          style={{ width: '100%', background: 'transparent', border: 'none', color: '#64748b', fontSize: '12px', cursor: isBillingBusy ? 'not-allowed' : 'pointer', padding: '4px' }}
                        >
                          {isBillingBusy ? 'Attendere...' : 'Cancella abbonamento'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleActivate(product.slug)}
                      disabled={isProvisioning}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', border: 'none', background: isProvisioning ? '#334155' : '#6366f1', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: isProvisioning ? 'not-allowed' : 'pointer' }}
                    >
                      {isProvisioning ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                      {isProvisioning ? 'Attivazione...' : 'Attiva'}
                    </button>
                  )}

                  {notice && (
                    <p style={{ color: '#a5b4fc', fontSize: '13px', marginTop: '8px' }}>{notice}</p>
                  )}
                  {activationError && (
                    <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '8px' }}>{activationError}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
