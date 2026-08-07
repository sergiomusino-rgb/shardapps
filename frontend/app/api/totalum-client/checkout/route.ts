import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';

// Controllo esplicito della chiave Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ ERRORE CRITICO: La variabile STRIPE_SECRET_KEY è undefined nel backend!");
} else {
  console.log("✅ STRIPE_SECRET_KEY rilevata con successo!");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/totalum-client/checkout
 * Crea una sessione di checkout per l'abbonamento del cliente finale
 * Utilizza Stripe Managed Payments (MoR) con application_fee
 * Se is_managed_by_platform è TRUE, crea la sessione direttamente su Stripe (takeover)
 */
export async function POST(request: NextRequest) {
  try {
    // Leggi il body della richiesta
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { totalum_app_id, customer_email } = body;

    // Validazione parametri
    if (!totalum_app_id) {
      return NextResponse.json({ error: 'totalum_app_id è obbligatorio' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Recupera i dati dell'app dal database
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('stripe_connect_id, client_subscription_price, tenant_id')
      .eq('totalum_app_id', totalum_app_id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (!app.client_subscription_price || app.client_subscription_price <= 0) {
      return NextResponse.json({ error: 'Il prezzo dell\'abbonamento non è configurato' }, { status: 400 });
    }

    // Converti il prezzo in centesimi
    const unitAmount = Math.round(app.client_subscription_price * 100);

    // URL per il success e cancel
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

    // Flusso standard: Stripe Connect con application fee
    if (!app.stripe_connect_id) {
      return NextResponse.json({ error: 'L\'app non ha un account Stripe Connect configurato' }, { status: 400 });
    }

    // Fee ShardApps fissa (€25/mese per app, coerente con apps/checkout,
    // apps/checkout/managed e a/[slug]/create-checkout-session — non più il
    // 25% del prezzo cliente, che divergeva dagli altri tre flussi). Stripe
    // però non supporta un application_fee_amount fisso su una subscription
    // a destination charge: si converte il fisso in una percentuale
    // equivalente sul prezzo di questo cliente, così l'incasso netto per
    // ShardApps resta sempre €25 a prescindere da quanto il reseller fa pagare.
    const applicationFeePercent = Math.min(
      100,
      Math.round((ZEUSX_MINIMUM_FEE_EUR / app.client_subscription_price) * 10000) / 100
    );

    // Crea la sessione di checkout per conto dell'account connesso
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Abbonamento App ShardApps',
              description: `Abbonamento per l'app ${totalum_app_id}`,
              metadata: {
                totalum_app_id: totalum_app_id,
                tenant_id: app.tenant_id,
              },
            },
            unit_amount: unitAmount,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      // Destination Charge: trasferisce i fondi all'account connesso
      // e trattiene una application fee per ShardApps
      subscription_data: {
        application_fee_percent: applicationFeePercent,
        transfer_data: {
          destination: app.stripe_connect_id,
        },
      },
      success_url: `${appUrl}/a/${totalum_app_id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/a/${totalum_app_id}?canceled=1`,
      client_reference_id: totalum_app_id,
      metadata: {
        totalum_app_id: totalum_app_id,
        tenant_id: app.tenant_id,
      },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.log('ERRORE STRIPE DETTAGLIATO:', JSON.stringify(error, null, 2));
    console.error('[Totalum Client Checkout] Errore:', error);
    return NextResponse.json(
      { error: 'Errore durante la creazione della sessione di checkout' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/totalum-client/checkout
 * Supporto query parameter per compatibilità
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const totalum_app_id = searchParams.get('totalum_app_id');
  
  if (!totalum_app_id) {
    return NextResponse.json({ error: 'totalum_app_id è obbligatorio' }, { status: 400 });
  }

  // Chiama la logica POST con i parametri dal query
  const mockRequest = new NextRequest(request.nextUrl, {
    method: 'POST',
    body: JSON.stringify({ totalum_app_id }),
    headers: request.headers,
  });

  return POST(mockRequest);
}