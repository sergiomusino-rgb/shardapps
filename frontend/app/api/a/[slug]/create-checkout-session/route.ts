import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getClientSubscriptionPrice, ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: NextRequest) {
  try {
    const slug = request.nextUrl.pathname.split('/')[3];

    const supabase = getSupabaseAdmin();

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, name, tenant_id, client_subscription_price, client_price, zeusx_fee')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Il prezzo NON è fisso a 25€: lo decide il reseller per questa specifica
    // app dalla pagina Management (client_subscription_price / client_price).
    // 25€ è solo il minimo/fallback che spetta a ZeusX se il reseller non ha
    // impostato nulla — se il reseller vende l'app a 70€/mese, il cliente
    // paga 70€, di cui 25€ restano a ZeusX e il resto al reseller.
    const clientPrice = getClientSubscriptionPrice(app);
    const zeusxFee = app.zeusx_fee || ZEUSX_MINIMUM_FEE_EUR;
    const clientPriceCents = Math.round(clientPrice * 100);

    // Prezzo creato inline nella sessione (price_data): evita di dover
    // pre-creare/persistere un Product/Price su Stripe.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: clientPriceCents,
          recurring: { interval: 'month' },
          product_data: {
            name: `Abbonamento ${app.name}`,
            description: 'Abbonamento mensile per continuare a utilizzare il gestionale dopo il periodo di prova',
          },
        },
        quantity: 1,
      }],
      client_reference_id: app.id,
      success_url: `${request.nextUrl.origin}/a/${slug}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.nextUrl.origin}/a/${slug}/dashboard?checkout=cancelled`,
      metadata: {
        app_id: app.id,
        app_slug: slug,
        tenant_id: app.tenant_id,
        client_price: clientPrice.toString(),
        zeusx_fee: zeusxFee.toString(),
        reseller_amount: (clientPrice - zeusxFee).toFixed(2),
      },
      subscription_data: {
        metadata: {
          app_id: app.id,
          app_slug: slug,
          tenant_id: app.tenant_id,
          client_price: clientPrice.toString(),
          zeusx_fee: zeusxFee.toString(),
          reseller_amount: (clientPrice - zeusxFee).toFixed(2),
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    return NextResponse.json({ error: 'Errore durante la creazione del checkout' }, { status: 500 });
  }
}
