import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Helper to get Stripe client (initialized inside handler to ensure env vars are available)
function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY non configurata');
  }
  return new Stripe(secretKey, {
    // 2025-03-31.basil è la versione minima richiesta per Managed Payments
    // (Merchant of Record) — vedi managed_payments sotto.
    apiVersion: '2025-03-31.basil' as any,
  });
}

// Helper to get Supabase clients
function getSupabaseClients() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Variabili Supabase non configurate');
  }

  const authClient = createClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const dbClient = createClient<Database>(
    supabaseUrl,
    supabaseServiceKey || supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  return { authClient, dbClient };
}

// Get recurring fee price ID for a plan
function getFeePriceId(planId: string): string {
  const feePrices: Record<string, string> = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER || 'price_1TmdIgRZR2YaFu2sT5gkrMdx',
    pro: process.env.STRIPE_FEE_PRICE_PRO || 'price_1TmdK0RZR2YaFu2s8pXkLety',
    business: process.env.STRIPE_FEE_PRICE_BUSINESS || 'price_1TmdKuRZR2YaFu2sHeH8fShE',
  };
  return feePrices[planId] || feePrices.starter;
}

// Setup (one-time) price ID for a plan. NON derivare mai questo valore dal
// priceId passato dal client: planId decide quanti slot vengono concessi
// (vedi getSlotsForPlan negli handler dei webhook), quindi il priceId
// addebitato deve essere vincolato lato server allo stesso planId — altrimenti
// un client potrebbe chiedere planId "business" (100 slot) pagando il prezzo
// di un piano più economico.
function getSetupPriceId(planId: string): string | null {
  const setupPrices: Record<string, string> = {
    starter: process.env.STRIPE_SETUP_PRICE_STARTER || 'price_1Ty8ZPRZR2YaFu2s8aFmA4Az',
    pro: process.env.STRIPE_SETUP_PRICE_PRO || 'price_1TyX0yRZR2YaFu2s1nKkKHVw',
    business: process.env.STRIPE_SETUP_PRICE_BUSINESS || 'price_1TyX0yRZR2YaFu2s4veOZc6r',
  };
  return setupPrices[planId] || null;
}

export async function POST(req: NextRequest) {
  // Initialize clients inside handler to ensure env vars are available
  let stripe: any;
  let authClient: any;
  let dbClient: any;

  try {
    stripe = getStripe();
    const clients = getSupabaseClients();
    authClient = clients.authClient;
    dbClient = clients.dbClient;
  } catch (initError) {
    console.error('[Checkout API] Initialization error:', initError);
    return NextResponse.json(
      { error: initError instanceof Error ? initError.message : 'Errore inizializzazione' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    
    const { planId, quantity = 1 } = body;

    if (!planId) {
      return NextResponse.json({ error: 'Parametri mancanti: planId richiesto' }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe non configurato - STRIPE_SECRET_KEY mancante' }, { status: 500 });
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato - header Authorization mancante o invalido' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato: ' + (authError?.message || 'token invalido') }, { status: 401 });
    }

    // Trova il tenant dell'utente - prima per owner_id
    const { data: tenantByOwner } = await dbClient
      .from('tenants')
      .select('id, plan, owner_id')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();

    let tenant = tenantByOwner;

    // Fallback: cerca nelle membership
    if (!tenant) {
      const { data: membership } = await dbClient
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (membership?.tenant_id) {
        const { data: tenantFromMembership } = await dbClient
          .from('tenants')
          .select('id, plan, owner_id')
          .eq('id', membership.tenant_id)
          .single();
        tenant = tenantFromMembership;
      }
    }

    // Se ancora non trovato, crea un nuovo tenant
    if (!tenant) {
      const { data: newTenant, error: createErr } = await dbClient
        .from('tenants')
        .insert({
          owner_id: user.id,
          name: user.email || 'Tenant personale',
          slug: `tenant-${user.id.slice(0, 8)}`,
          plan: 'free',
        })
        .select('id, plan, owner_id')
        .single();

      if (createErr || !newTenant) {
        console.error('[Checkout] Errore creazione tenant:', JSON.stringify(createErr));
        return NextResponse.json({ error: 'Impossibile creare il tenant: ' + JSON.stringify(createErr) }, { status: 500 });
      }

      tenant = newTenant;

      // Aggiungi membership
      await dbClient.from('tenant_members').insert({
        tenant_id: tenant!.id,
        user_id: user.id,
        role: 'owner',
      });
    }

    // At this point, tenant is guaranteed to exist
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant non trovato o creato' }, { status: 500 });
    }

    // Gestione "Ricarica Extra" (15€ → 50 crediti Vision, vedi getCreditsForPlan
    // nel webhook). Il nome della env var è storico (il bottone si chiamava
    // "Slot Extra" e dava +1 slot app): stesso prezzo Stripe da 15€, cambia
    // solo cosa viene accreditato lato webhook, quindi non serve creare un
    // nuovo Price su Stripe né rinominare la env var. Per i piani regolari il
    // priceId NON viene mai preso dal body: è derivato server-side da planId
    // (vedi getSetupPriceId) per evitare che un client paghi un piano
    // economico dichiarando però un planId più costoso nei metadata.
    const CREDIT_TOPUP_PRICE_ID = process.env.NEXT_PUBLIC_EXTRA_SLOT_PRICE_ID || 'price_extra_slot_15';
    const isCreditTopup = planId === 'credit_topup';

    // Modello cumulativo: Pro e Business restano acquistabili a qualunque
    // piano tu abbia già (si sommano sempre agli slot esistenti). Solo
    // Starter va bloccato una volta passati a un piano a pagamento — è
    // pensato come piano d'ingresso, non da ricomprare. Controllo lato
    // server perché il disabled del bottone in pricing/page.tsx è solo UX,
    // non una barriera. Stessa regola in pricing/page.tsx.
    if (planId === 'starter' && tenant.plan !== 'free') {
      return NextResponse.json(
        { error: `Hai già il piano ${tenant.plan}: il piano Starter non è più acquistabile. Usa la Ricarica Extra o passa a Pro/Business.` },
        { status: 400 }
      );
    }

    const effectivePriceId = isCreditTopup ? CREDIT_TOPUP_PRICE_ID : getSetupPriceId(planId);
    const effectiveQuantity = isCreditTopup ? (quantity || 1) : 1;

    if (!effectivePriceId) {
      return NextResponse.json({ error: 'Piano non riconosciuto' }, { status: 400 });
    }

    // Crea o recupera customer Stripe
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
          tenant_id: tenant.id,
        },
      });
      customerId = customer.id;
    }

    // Crea la sessione di checkout
    // Per credit_topup: modalità 'payment' (pagamento una tantum, nessuna subscription)
    // Per piani: modalità 'payment' (setup price) - la subscription viene creata dal webhook

    // Get the recurring fee price ID for the plan
    const feePriceId = getFeePriceId(planId);
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      // payment_method_types NON va passato con Managed Payments: Stripe
      // rifiuta la sessione con "Unsupported parameter: payment_method_types"
      // perché è Managed Payments a decidere i metodi di pagamento disponibili.
      line_items: [
        {
          price: effectivePriceId,
          quantity: effectiveQuantity,
        },
      ],
      // Managed Payments (Merchant of Record): Stripe diventa il venditore
      // di riferimento (gestisce tasse/IVA, chargeback, compliance) al posto
      // dell'account ShardApps. I Product collegati a effectivePriceId hanno già
      // un tax_code impostato (richiesto da Stripe per l'idoneità al MoR).
      managed_payments: {
        enabled: true,
      },
      success_url: `${req.nextUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.nextUrl.origin}/pricing`,
      metadata: {
        tenant_id: tenant.id,
        plan_id: planId,
        price_id: effectivePriceId,
        quantity: effectiveQuantity.toString(),
        supabase_user_id: user.id,
        fee_price_id: feePriceId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[Checkout] Errore:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}
