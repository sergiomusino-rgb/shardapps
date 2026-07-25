import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/user/stripe-connect
 * Genera un link di onboarding per Stripe Connect
 */
export async function POST(request: NextRequest) {
  try {
    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = getSupabase();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token non valido' }, { status: 401 });
    }

    // Recupera o crea l'account Stripe Connect
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('user_id', user.id)
      .single();

    let stripeAccountId = profile?.stripe_connect_id;

    // Se non esiste, crea un nuovo account Stripe Connect
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        metadata: {
          user_id: user.id,
          supabase_user_id: user.id,
        },
      });
      stripeAccountId = account.id;

      // Salva l'ID account nel profilo
      await supabase
        .from('profiles')
        .update({ stripe_connect_id: stripeAccountId })
        .eq('user_id', user.id);
    }

    // Genera il link di onboarding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appUrl}/dashboard/settings`,
      return_url: `${appUrl}/dashboard/settings?stripe_connect=success`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    console.error('[Stripe Connect] Errore:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore durante la creazione del link di onboarding' },
      { status: 500 }
    );
  }
}