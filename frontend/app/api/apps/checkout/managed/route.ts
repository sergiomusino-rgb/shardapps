import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Helper to get Stripe client with Managed Payments API version
function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY non configurata');
  }
  return new Stripe(secretKey, {
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

// ZeusX fee fissa in centesimi (25€)
const ZEUSX_FEE_CENTS = 2500;

/**
 * POST /api/apps/checkout/managed
 * Crea una Stripe Checkout Session in modalità Managed Payments (Merchant of Record).
 * 
 * Flusso:
 * 1. Accetta app_id dalla rotta /checkout
 * 2. Recupera il prezzo dell'abbonamento (client_subscription_price) e i dettagli del reseller
 * 3. Crea una Checkout Session Stripe con managed_payments[enabled]=true
 * 4. L'importo totale = client_subscription_price
 *    - ZeusX trattiene 25€ (Application Fee)
 *    - Il resto viene registrato come credito per il reseller (payout successivo)
 * 5. Redirect a success_url o cancel_url
 */
export async function POST(req: NextRequest) {
  let stripe: any;
  let authClient: any;
  let dbClient: any;

  try {
    stripe = getStripe();
    const clients = getSupabaseClients();
    authClient = clients.authClient;
    dbClient = clients.dbClient;
  } catch (initError) {
    console.error('[Managed Checkout API] Initialization error:', initError);
    return NextResponse.json(
      { error: initError instanceof Error ? initError.message : 'Errore inizializzazione' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { appId, customerEmail } = body;

    if (!appId) {
      return NextResponse.json({ error: 'appId richiesto' }, { status: 400 });
    }

    // Verifica autenticazione
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato - header Authorization mancante o invalido' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato: ' + (authError?.message || 'token invalido') }, { status: 401 });
    }

    // Recupera l'app dal database con i dettagli del reseller
    const { data: app, error: appError } = await dbClient
      .from('apps')
      .select(`
        id,
        name,
        tenant_id,
        client_subscription_price,
        client_price,
        zeusx_fee,
        stripe_connect_id,
        status,
        trial_ends_at,
        slug
      `)
      .eq('id', appId)
      .single();

    if (appError || !app) {
      console.error('[Managed Checkout] App non trovata:', appError);
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Verifica che l'utente sia il proprietario del tenant (reseller)
    const { data: tenant } = await dbClient
      .from('tenants')
      .select('id, owner_id, name')
      .eq('id', app.tenant_id)
      .single();

    if (!tenant || tenant.owner_id !== user.id) {
      return NextResponse.json({ error: 'Non sei il proprietario di questa app' }, { status: 403 });
    }

    // Verifica che l'app sia in trial
    if (app.status !== 'trial') {
      return NextResponse.json({ error: 'Questa app non è in periodo di prova' }, { status: 400 });
    }

    // Determina il prezzo del cliente (usa client_subscription_price o client_price come fallback)
    const clientPrice = app.client_subscription_price || app.client_price || 25.00;
    const clientPriceCents = Math.round(clientPrice * 100);

    // Calcola l'importo che spetta al reseller (client_price - zeusx_fee)
    const zeusxFee = app.zeusx_fee || 25.00;
    const zeusxFeeCents = Math.round(zeusxFee * 100);
    const resellerAmountCents = clientPriceCents - zeusxFeeCents;

    // Verifica che il prezzo sia sufficiente a coprire la fee ZeusX
    if (resellerAmountCents <= 0) {
      return NextResponse.json({ 
        error: 'Prezzo non valido', 
        message: `Il prezzo del cliente (${clientPrice}€) deve essere maggiore della fee ZeusX (${zeusxFee}€)` 
      }, { status: 400 });
    }

    // Recupera o crea il customer Stripe per il cliente finale
    const email = customerEmail || user.email;
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: {
          app_id: app.id,
          tenant_id: app.tenant_id,
          reseller_id: user.id,
        },
      });
      customerId = customer.id;
    }

    // Crea il prezzo per la subscription
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: clientPriceCents,
      recurring: {
        interval: 'month',
      },
      product_data: {
        name: `Abbonamento ${app.name}`,
        // Richiesto da Stripe per l'idoneità a Managed Payments quando il
        // Product viene creato al volo: "SaaS - business use".
        tax_code: 'txcd_10103101',
        metadata: {
          app_id: app.id,
          tenant_id: app.tenant_id,
          reseller_id: user.id,
        },
      },
    });

    // Crea la sessione di checkout con Managed Payments (Merchant of Record)
    // managed_payments[enabled]=true abilita la modalità MoR:
    // - La piattaforma (ZeusX) è il Merchant of Record
    // - I fondi vengono raccolti direttamente da Stripe sulla piattaforma
    // - La ripartizione viene gestita a livello di database per i payout successivi
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      // payment_method_types NON va passato con Managed Payments: Stripe
      // rifiuta la sessione con "Unsupported parameter: payment_method_types"
      // perché è Managed Payments a decidere i metodi di pagamento disponibili.
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      managed_payments: {
        enabled: true,
      },
      success_url: `${req.nextUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}&app_id=${app.id}`,
      cancel_url: `${req.nextUrl.origin}/checkout?app_id=${app.id}&canceled=1`,
      metadata: {
        app_id: app.id,
        tenant_id: app.tenant_id,
        reseller_id: user.id,
        client_price: clientPrice.toString(),
        zeusx_fee: zeusxFee.toString(),
        reseller_amount: (resellerAmountCents / 100).toFixed(2),
        managed_payment: 'true',
      },
    });

    // Registra la transazione nel database per tracciare la suddivisione economica
    const { error: txError } = await dbClient
      .from('transactions')
      .insert({
        app_registry_id: null, // Non abbiamo un app_registry_id, usiamo l'app_id nei metadata
        reseller_id: user.id,
        event_type: 'checkout_session_created',
        event_id: session.id,
        total_amount: clientPrice,
        zeusx_commission: zeusxFee,
        currency: 'EUR',
        status: 'pending',
        metadata: {
          app_id: app.id,
          app_name: app.name,
          tenant_id: app.tenant_id,
          stripe_session_id: session.id,
          stripe_subscription_id: session.subscription,
          reseller_amount: (resellerAmountCents / 100).toFixed(2),
          managed_payment: true,
        },
      });

    if (txError) {
      console.error('[Managed Checkout] Errore registrazione transazione:', txError);
      // Non blocchiamo il flusso, ma logghiamo l'errore
    }

    // NON impostare status:'active' qui: session.subscription è sempre null
    // finché il cliente non completa il pagamento sulla pagina hosted —
    // marcarla attiva a questo punto la sbloccherebbe senza pagamento
    // confermato. L'attivazione avviene solo nel webhook Stripe su
    // checkout.session.completed/invoice.paid (stesso fix applicato a
    // app/api/apps/checkout/route.ts).

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
      clientPrice,
      zeusxFee,
      resellerAmount: (resellerAmountCents / 100).toFixed(2),
    });

  } catch (error) {
    console.error('[Managed Checkout] Errore:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}