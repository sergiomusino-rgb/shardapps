import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// GET /api/a/[slug]/verify-checkout-session?session_id=cs_test_...
//
// Chiamato dal client al ritorno da Stripe Checkout (success_url) per
// sbloccare subito il pulsante "Disdici Abbonamento" nelle Impostazioni,
// senza aspettare il webhook — indispensabile in sviluppo locale, dove
// Stripe non può raggiungere il webhook senza `stripe listen`, ma utile
// anche in produzione come rete di sicurezza contro ritardi di consegna.
// Il webhook resta comunque la fonte di verità per gli eventi successivi
// (rinnovi, mancati pagamenti, disdette).
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sessionId = request.nextUrl.searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id mancante' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, status')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // La sessione deve appartenere a QUESTA app (evita che una sessione
    // valida di un'altra app sblocchi l'abbonamento qui).
    if (session.client_reference_id !== app.id && session.metadata?.app_id !== app.id) {
      return NextResponse.json({ error: 'Sessione non valida per questa app' }, { status: 403 });
    }

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return NextResponse.json({ status: app.status });
    }

    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;

    const { error: updateError } = await supabase
      .from('apps')
      .update({
        status: 'active',
        ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', app.id);

    if (updateError) {
      console.error('[verify-checkout-session] Errore aggiornamento app:', updateError);
      return NextResponse.json({ error: 'Errore aggiornamento stato abbonamento' }, { status: 500 });
    }

    return NextResponse.json({ status: 'active' });
  } catch (err) {
    console.error('[verify-checkout-session] error:', err);
    return NextResponse.json({ error: 'Errore verifica sessione' }, { status: 500 });
  }
}
