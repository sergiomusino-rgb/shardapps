// ─── Catalog Cancellation API (App Catalog & Instance Model, STEP 4) ───────
// POST /api/catalog/products/[productSlug]/cancel
//
// Disdice l'abbonamento Stripe di una Catalog Instance. Percorso SEPARATO da
// /a/[slug]/cancel-subscription (cliente finale di un'app pubblicata,
// invariato, non toccato da questo file): l'autorizzazione qui è
// tenant-side (tenant_members), MAI app_users — le Catalog Instance nascono
// con auth_mode legacy/rbac (STEP 3), non hanno mai una riga app_users.
//
// Come /a/[slug]/cancel-subscription: imposta SOLO cancel_at_period_end su
// Stripe, non scrive mai apps.status='canceled' direttamente — lo stato
// finale arriva dal webhook esistente (customer.subscription.deleted, o
// customer.subscription.updated se Stripe notifica prima il
// cancel_at_period_end) quando il periodo corrente termina davvero. Nessuna
// seconda fonte di verità introdotta.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getUserFromToken } from '@/src/lib/creator-server';
import { authorizeCatalogCancel } from '@/src/lib/catalog-cancel-authorization';
import { captureError } from '@/src/lib/error-tracking';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

type CatalogInstance = {
  id: string;
  tenant_id: string;
  product_id: string | null;
  status: string;
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

    const { data: product } = await supabase.from('app_products' as any)
      .select('id, slug')
      .eq('slug', productSlug)
      .maybeSingle() as { data: { id: string; slug: string } | null };

    // Tenant risolto SENZA crearlo, stesso motivo del checkout: cancellare
    // non deve mai avere l'effetto collaterale di materializzare un tenant.
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

    // Istanza scoped per tenant_id+product_id nella query stessa: garanzia
    // di cross-tenant isolation strutturale, non un controllo a posteriori —
    // un tenant non può MAI ricevere/toccare l'istanza di un altro tenant,
    // qualunque cosa invii (solo slug nell'URL + Bearer token).
    let instance: CatalogInstance | null = null;
    if (product && tenantId) {
      const { data } = await supabase.from('apps' as any)
        .select('id, tenant_id, product_id, status, stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .eq('product_id', product.id)
        .eq('is_active', true)
        .maybeSingle();
      instance = data as CatalogInstance | null;
    }

    const decision = authorizeCatalogCancel({ token, user, instance });
    if (!decision.ok) {
      return NextResponse.json({ success: false, error: decision.error, code: decision.code }, { status: decision.status });
    }
    if (!instance) {
      return NextResponse.json({ success: false, error: 'Errore interno', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    try {
      await stripe.subscriptions.update(instance.stripe_subscription_id as string, {
        cancel_at_period_end: true,
      });
    } catch (stripeErr) {
      // Idempotenza: una subscription già terminata (status Stripe
      // 'canceled', es. una seconda chiamata dopo che il webhook ha già
      // applicato la cancellazione) fa rifiutare da Stripe un secondo
      // update — non un errore reale per chi chiama, la richiesta ("voglio
      // che questa istanza non sia più abbonata") è già soddisfatta.
      if (instance.status === 'canceled') {
        return NextResponse.json({ success: true, data: { alreadyCanceled: true } });
      }
      throw stripeErr;
    }

    return NextResponse.json({ success: true, data: { cancelAtPeriodEnd: true } });
  } catch (err) {
    captureError('catalog.cancel', err, { url: request.url });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
