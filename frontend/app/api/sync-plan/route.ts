import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import Stripe from 'stripe';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

function getStripe() {
  return new Stripe(stripeSecretKey, {
    apiVersion: '2026-06-24.dahlia' as any,
  });
}

// Mappa piani -> slot
const PLAN_SLOTS: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 5,
  business: 100,
};

// Rango dei piani: questo endpoint può essere chiamato in parallelo al
// webhook Stripe e non c'è garanzia sull'ordine di consegna degli eventi. Se
// arriva prima la sync del vecchio acquisto starter e dopo quella di business
// (o viceversa in ritardo), un update incondizionato di tenants.plan
// farebbe retrocedere il piano. Si applica solo un piano pari o superiore a
// quello già salvato.
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, business: 3 };
function planRank(plan: string | null | undefined): number {
  return PLAN_RANK[plan ?? ''] ?? 0;
}

/**
 * POST /api/sync-plan
 * Sincronizza il piano del tenant dopo checkout Stripe
 * Body: { session_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id } = body;

    if (!session_id) {
      return NextResponse.json({ error: 'session_id richiesto' }, { status: 400 });
    }

    // Questo endpoint usa la service role key (bypassa la RLS) e concede slot
    // e piano al tenant risolto dalla sessione Stripe: senza un controllo di
    // appartenenza, chiunque conoscesse un session_id altrui (es. da una URL
    // di successo condivisa) potrebbe invocarlo. Richiediamo quindi un utente
    // autenticato che sia effettivamente membro del tenant della sessione.
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const stripe = getStripe();

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    // Recupera la sessione Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return NextResponse.json({
        paid: false,
        plan: 'free',
        app_limit: 0
      });
    }

    const tenantId = session.client_reference_id || session.metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id non trovato nella sessione' }, { status: 400 });
    }

    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Tenant non autorizzato' }, { status: 403 });
    }

    // Il piano scelto è già salvato correttamente in metadata.plan_id al
    // momento della creazione della sessione (create-checkout-session/route.ts)
    // — è la stessa fonte usata dal webhook Stripe. Prima si tentava di
    // re-indovinarlo dal nome del prodotto Stripe (business/pro/starter come
    // sottostringa): se il nome conteneva "pro" per qualunque motivo (es. un
    // prefisso di branding condiviso), QUALSIASI piano diverso da "business"
    // veniva salvato come "pro", sovrascrivendo il valore corretto già scritto
    // dal webhook. Il match sul nome resta solo come fallback per sessioni
    // vecchie prive di questo metadata.
    const metadataPlan = session.metadata?.plan_id;
    let plan = PLAN_SLOTS[metadataPlan || ''] !== undefined ? metadataPlan! : 'starter';
    let appLimit = PLAN_SLOTS[plan] ?? 1;

    if (!metadataPlan) {
      // Recupera i dettagli del prodotto per determinare il piano (fallback)
      const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 10 });
      const priceId = lineItems.data[0]?.price?.id;

      if (priceId) {
        const price = await stripe.prices.retrieve(priceId);
        const productId = typeof price.product === 'string' ? price.product : price.product?.id;

        if (productId) {
          const product = await stripe.products.retrieve(productId);
          const name = (product.name || '').toLowerCase();

          if (name.includes('business')) {
            plan = 'business';
            appLimit = PLAN_SLOTS.business;
          } else if (name.includes('pro')) {
            plan = 'pro';
            appLimit = PLAN_SLOTS.pro;
          } else if (name.includes('starter')) {
            plan = 'starter';
            appLimit = PLAN_SLOTS.starter;
          }
        }
      }
    }

    // Modello slot cumulativo: questa sessione può già essere stata
    // processata dal webhook Stripe (fonte autoritativa) o da un'altra
    // chiamata a questo stesso endpoint (es. refresh della pagina /success).
    // La riga in processed_checkout_sessions fa da guardia di idempotenza:
    // solo chi riesce a inserirla per primo somma gli slot, gli altri leggono
    // soltanto lo stato attuale del tenant.
    const { error: insertError } = await supabase
      .from('processed_checkout_sessions')
      .insert({ session_id, tenant_id: tenantId, plan, slots_added: appLimit });

    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }

    if (!insertError) {
      const { error: rpcError } = await supabase.rpc('add_tenant_slots', {
        tenant_id: tenantId,
        slots_to_add: appLimit,
      });
      if (rpcError) throw rpcError;

      const { data: currentTenant } = await supabase
        .from('tenants')
        .select('plan')
        .eq('id', tenantId)
        .single();

      if (planRank(plan) >= planRank(currentTenant?.plan)) {
        const { error: planError } = await supabase
          .from('tenants')
          .update({ plan, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
        if (planError) throw planError;
      } else {
        console.log(`[Sync Plan] piano ${plan} non applicato: tenant ${tenantId} ha già ${currentTenant?.plan}`);
      }
    }

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('plan, app_limit')
      .eq('id', tenantId)
      .single();

    return NextResponse.json({
      success: true,
      paid: true,
      plan: tenantRow?.plan ?? plan,
      app_limit: tenantRow?.app_limit ?? appLimit,
    });

  } catch (error) {
    console.error('[Sync Plan] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
