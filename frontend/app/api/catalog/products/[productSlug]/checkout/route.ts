// ─── Catalog Checkout API (App Catalog & Instance Model, STEP 4) ───────────
// POST /api/catalog/products/[productSlug]/checkout
//
// Crea una Stripe Checkout Session per far passare una Catalog Instance già
// provisionata (STEP 3) da 'trial' a un vero abbonamento pagante. Riutilizza
// ESCLUSIVAMENTE il billing/webhook Stripe esistente (backend/lib/
// stripe-webhook-handler.js): nessun nuovo webhook, nessuna nuova
// subscription-architecture. Il ramo 'app' del webhook (già usato da
// /a/[slug]/create-checkout-session per il paywall trial cliente-finale)
// riconosce QUALUNQUE checkout.session.completed con metadata.app_id — qui
// basta impostarlo sull'id della Catalog Instance, nessuna modifica al
// routing (classifyStripeEvent) è stata necessaria.
//
// Differenze deliberate rispetto a /a/[slug]/create-checkout-session (il
// checkout "app-cliente" esistente, NON toccato da questo file):
// - qui il pagante è il TENANT stesso (autenticato, dashboard ShardApps),
//   non un cliente finale anonimo del reseller che apre /a/{slug} — quindi
//   questo endpoint richiede un Bearer token, l'altro no (per design, non
//   una svista: vedi commento in create-checkout-session/route.ts).
// - prezzo ESCLUSIVAMENTE da app_products.price_monthly: nessuno split
//   client_price/zeusx_fee/reseller_amount (qui non esiste un reseller da
//   pagare, ShardApps vende il prodotto del catalogo direttamente).
// - Stripe è il merchant diretto dell'account ShardApps per questa
//   subscription: niente Stripe Connect, niente managed_payments (quella
//   funzionalità esiste per delegare a Stripe il ruolo di Merchant of
//   Record quando il vero venditore è il reseller, non ShardApps stessa —
//   qui non si applica).
//
// Contratto: input dal client SOLO productSlug (URL), nessun body richiesto.
// tenant_id/app_id/product_id/prezzo sono TUTTI risolti/calcolati qui lato
// server, mai letti da un body.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getUserFromToken } from '@/src/lib/creator-server';
import { authorizeCatalogCheckout } from '@/src/lib/catalog-checkout-authorization';
import { captureError } from '@/src/lib/error-tracking';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

type CatalogProduct = { id: string; slug: string; name: string; price_monthly: number; is_active: boolean };
type CatalogInstance = {
  id: string;
  tenant_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ productSlug: string }> }) {
  try {
    const { productSlug } = await params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);

    // Cast (app_products non ancora nei tipi generati da Supabase, stesso
    // motivo/pattern dello STEP 3 — richiede di rigenerare types/database.ts,
    // nessun impatto a runtime).
    const { data: product } = await supabase.from('app_products' as any)
      .select('id, slug, name, price_monthly, is_active')
      .eq('slug', productSlug)
      .maybeSingle() as { data: CatalogProduct | null };

    // Tenant risolto SENZA crearlo (a differenza del provisioning STEP 3):
    // un checkout non deve mai avere l'effetto collaterale di creare un
    // tenant — se l'utente non ne ha già uno, non può avere nemmeno
    // un'istanza da pagare, quindi la richiesta finirà comunque in 404
    // sotto, non serve materializzare un tenant vuoto solo per arrivarci.
    let tenantId: string | null = null;
    if (user) {
      const { data: membership } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      tenantId = membership?.tenant_id ?? null;
    }

    // Istanza già scoped per tenant_id+product_id nella query stessa: questa
    // è la garanzia di cross-tenant isolation, non un controllo a posteriori
    // — un'istanza di un altro tenant non può MAI essere restituita qui,
    // qualunque cosa il client abbia inviato (non ha inviato nulla: slug e
    // Bearer token sono gli unici input).
    let instance: CatalogInstance | null = null;
    if (product && tenantId) {
      const { data } = await supabase.from('apps' as any)
        .select('id, tenant_id, status, stripe_customer_id, stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .eq('product_id', product.id)
        .eq('is_active', true)
        .maybeSingle();
      instance = data as CatalogInstance | null;
    }

    const decision = authorizeCatalogCheckout({ token, user, product, instance });
    if (!decision.ok) {
      return NextResponse.json({ success: false, error: decision.error, code: decision.code }, { status: decision.status });
    }
    // authorizeCatalogCheckout garantisce già product/instance/user non-null
    // quando ok:true — guardia ridondante per stringere il tipo TypeScript.
    if (!product || !instance || !user) {
      return NextResponse.json({ success: false, error: 'Errore interno', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    const priceCents = Math.round(product.price_monthly * 100);

    // Trial: nessun trial_period_days passato a Stripe, stessa convenzione
    // di /a/[slug]/create-checkout-session — il trial è già gestito
    // interamente a livello applicativo (apps.trial_ends_at, STEP 3), non
    // duplicato lato Stripe. Chi arriva a fare checkout paga da subito: è
    // una scelta esplicita di "attiva ora", non un secondo trial.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: priceCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `Abbonamento ${product.name}`,
            description: `Abbonamento mensile a ${product.name} — ShardApps`,
            tax_code: 'txcd_10103101',
          },
        },
        quantity: 1,
      }],
      // Riusa il customer Stripe già associato a questa istanza (scritto dal
      // webhook su un tentativo precedente, es. checkout abbandonato poi
      // ripreso) invece di farne creare uno nuovo ad ogni tentativo.
      ...(instance.stripe_customer_id
        ? { customer: instance.stripe_customer_id }
        : { customer_email: user.email || undefined }),
      client_reference_id: instance.id,
      success_url: `${request.nextUrl.origin}/dashboard/catalog?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.nextUrl.origin}/dashboard/catalog?checkout=cancelled`,
      // metadata.app_id sulla SESSION (non solo su subscription_data): è
      // quello che classifyStripeEvent legge per checkout.session.completed
      // (backend/lib/stripe-webhook-logic.js) — nessuna modifica al webhook
      // esistente è stata necessaria per farlo funzionare con le Catalog
      // Instance, riconosce già qualunque app_id valido.
      metadata: {
        app_id: instance.id,
        product_id: product.id,
        product_slug: product.slug,
        tenant_id: tenantId as string,
      },
      subscription_data: {
        metadata: {
          app_id: instance.id,
          product_id: product.id,
          product_slug: product.slug,
          tenant_id: tenantId as string,
        },
      },
    });

    return NextResponse.json({ success: true, data: { url: session.url } });
  } catch (err) {
    captureError('catalog.checkout', err, { url: request.url });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
