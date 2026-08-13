'use client';

// ─── App Catalog UI (App Catalog & Instance Model, STEP 3 — FASE 9) ────────
// Minima di proposito ("NON costruire ancora una marketplace complessa"):
// elenca i prodotti attivi (letti direttamente via RLS, stesso pattern di
// dashboard/projects/page.tsx — supabaseBrowser + SELECT, nessun endpoint
// GET dedicato: la policy "app_products_select_active" (migration
// 20260815000000) esiste apposta per questo) e un solo pulsante "Attiva" per
// prodotto, che chiama POST /api/catalog/products/[productSlug]/provision.
// Nessun filtro/ricerca/categoria, nessuna gestione versioni in UI (la
// route sceglie da sola la versione attiva più recente se non specificata).

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Store } from 'lucide-react';
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

export default function CatalogPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProvisionSuccess>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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
              const activationError = errors[product.slug];
              const isProvisioning = provisioning === product.slug;

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

                  <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', fontSize: '13px', color: '#cbd5e1' }}>
                    <span>
                      {product.price_monthly > 0 ? `€${product.price_monthly.toFixed(2)}/mese` : 'Gratuito'}
                    </span>
                    <span>·</span>
                    <span>{product.trial_days} giorni di prova</span>
                  </div>

                  {result ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#22c55e', fontSize: '14px' }}>
                        <CheckCircle2 size={16} />
                        {result.alreadyProvisioned ? 'Già attivo per la tua organizzazione' : 'Attivato con successo'}
                      </div>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', border: 'none', background: '#6366f1', color: '#fff', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}
                      >
                        <ExternalLink size={16} /> Apri l&apos;app
                      </a>
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
