import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Helper to get Stripe client
function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY non configurata');
  }
  return new Stripe(secretKey, {
    apiVersion: '2026-06-24.dahlia',
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

// ShardApps fee di default in centesimi (25€), usata solo se l'app non ha un
// zeusx_fee proprio impostato in DB (vedi stesso pattern in checkout/managed).
const DEFAULT_ZEUSX_FEE_CENTS = 2500;

/**
 * POST /api/apps/checkout
 * Genera una sessione di Stripe Checkout per l'abbonamento mensile di una singola app
 * Usa Stripe Connect in modalità 'subscription' con split payment
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
    console.error('[App Checkout API] Initialization error:', initError);
    return NextResponse.json(
      { error: initError instanceof Error ? initError.message : 'Errore inizializzazione' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { appId, clientEmail } = body;

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

    // Recupera l'app dal database
    const { data: app, error: appError } = await dbClient
      .from('apps')
      .select(`
        id,
        name,
        tenant_id,
        client_price,
        zeusx_fee,
        stripe_connect_id,
        status,
        trial_ends_at
      `)
      .eq('id', appId)
      .single();

    if (appError || !app) {
      console.error('[App Checkout] App non trovata:', appError);
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Verifica che l'utente sia il proprietario del tenant
    const { data: tenant } = await dbClient
      .from('tenants')
      .select('id, owner_id')
      .eq('id', app.tenant_id)
      .single();

    if (!tenant || tenant.owner_id !== user.id) {
      return NextResponse.json({ error: 'Non sei il proprietario di questa app' }, { status: 403 });
    }

    // Blocca solo un'app già attiva (nessun bisogno di ripagare) o cancellata
    // dal reseller stesso. Un'app 'expired'/'past_due' — cioè con trial
    // scaduto, esattamente il caso che questo endpoint deve sbloccare — deve
    // poter completare il checkout: negarlo qui impediva proprio al cliente
    // di riattivare l'app dopo la scadenza del trial (bug riprodotto durante
    // lo stress-test E2E).
    if (app.status === 'active') {
      return NextResponse.json({ error: 'Questa app è già attiva' }, { status: 400 });
    }
    if (app.status === 'canceled') {
      return NextResponse.json({ error: 'Questa app è stata cancellata' }, { status: 400 });
    }

    // Verifica che il reseller abbia configurato Stripe Connect
    if (!app.stripe_connect_id) {
      return NextResponse.json({ 
        error: 'Stripe Connect non configurato', 
        message: 'Il reseller deve prima configurare lo Stripe Connect' 
      }, { status: 400 });
    }

    // Recupera o crea il customer Stripe per il cliente
    const email = clientEmail || user.email;
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: {
          app_id: app.id,
          tenant_id: app.tenant_id,
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;
    }

    // Calcola l'importo in centesimi
    // client_price è in EUR, lo convertiamo in centesimi
    const clientPriceCents = Math.round((app.client_price || 25) * 100);
    
    // L'importo che va al reseller è: client_price - zeusx_fee
    const zeusxFeeCents = Math.round((app.zeusx_fee || 25.00) * 100) || DEFAULT_ZEUSX_FEE_CENTS;
    const amountToResellerCents = clientPriceCents - zeusxFeeCents;
    
    // Se l'importo è negativo o zero, significa che il prezzo è troppo basso
    if (amountToResellerCents <= 0) {
      return NextResponse.json({ 
        error: 'Prezzo non valido', 
        message: 'Il prezzo del cliente deve essere maggiore dell\'importo minimo di 25€' 
      }, { status: 400 });
    }

    // Crea il prezzo per la subscription
    // Usiamo un prezzo dinamico basato sul client_price
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: clientPriceCents,
      recurring: {
        interval: 'month',
      },
      product_data: {
        name: `Abbonamento ${app.name}`,
        metadata: {
          app_id: app.id,
          tenant_id: app.tenant_id,
        },
      },
    });

    // Crea la sessione di checkout con Stripe Connect
    // Usa subscription_data per configurare lo split payment. La versione
    // dell'API Stripe pinnata in questo progetto (2026-06-24.dahlia) non
    // accetta più subscription_data.application_fee_amount su una
    // subscription ricorrente ("Received unknown parameter... Did you mean
    // application_fee_percent?") — va espresso come percentuale. Essendo il
    // prezzo cliente fisso, la percentuale equivalente a 25€ fissi resta
    // costante mese per mese, quindi il risultato economico è identico.
    // application_fee_percent accetta al massimo 2 decimali: arrotondiamo,
    // introduce un'imprecisione trascurabile (frazioni di centesimo) rispetto
    // ai 25€ fissi esatti sui prezzi che non dividono esattamente 2500.
    const zeusxFeePercent = Math.round((zeusxFeeCents / clientPriceCents) * 100 * 100) / 100;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      success_url: `${req.nextUrl.origin}/a/${app.id}?session_id={CHECKOUT_SESSION_ID}&app_checkout=success`,
      cancel_url: `${req.nextUrl.origin}/a/${app.id}?app_checkout=canceled`,
      metadata: {
        app_id: app.id,
        tenant_id: app.tenant_id,
        supabase_user_id: user.id,
        client_price: app.client_price?.toString() || '25.00',
        zeusx_fee: app.zeusx_fee?.toString() || '25.00',
      },
      subscription_data: {
        application_fee_percent: zeusxFeePercent, // equivalente a 25€ fissi al prezzo cliente attuale
        transfer_data: {
          destination: app.stripe_connect_id, // Account Connect del reseller
        },
      },
    });

    // NON impostare qui status:'active': una Checkout Session in modalità
    // subscription valorizza session.subscription solo al termine del
    // pagamento sulla pagina hosted — a questo punto è sempre null, quindi
    // marcare l'app attiva qui equivaleva a sbloccarla senza che il cliente
    // avesse davvero pagato (bug di sicurezza confermato durante lo
    // stress-test E2E). L'attivazione avviene esclusivamente nel webhook
    // Stripe (handleCheckoutSessionCompleted, Caso 0 su metadata.app_id, già
    // impostato sopra) quando checkout.session.completed conferma il
    // pagamento, e viene mantenuta sui rinnovi da handleInvoicePaid.
    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });

  } catch (error) {
    console.error('[App Checkout] Errore:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}