import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { authorizeCancelSubscription } from '@/src/lib/cancel-subscription-authorization';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia' as any,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// Client separato (anon key) solo per verificare il JWT del chiamante, come
// in altre route a/[slug] (es. create-checkout-session): non deve mai usare
// la service role per l'auth.getUser().
function getSupabaseAuth() {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    // Fix cross-tenant (audit Fase 3B, caso 15): prima di questo controllo
    // chiunque conoscesse lo slug pubblico di un'app (visibile nell'URL)
    // poteva cancellare l'abbonamento Stripe del suo cliente, senza alcuna
    // autenticazione. La decisione (401/403/200) è delegata a
    // authorizeCancelSubscription (src/lib/cancel-subscription-authorization.js,
    // Fase 3 Step 1.3) — pura, testata con node:test — mentre qui restano
    // solo le query, nello stesso ordine/short-circuit di prima: ogni
    // passaggio successivo viene eseguito solo se il precedente è andato a
    // buon fine, così una richiesta non autenticata non arriva mai a
    // interrogare app_users.
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let user: { id: string } | null = null;
    if (token) {
      const { data } = await getSupabaseAuth().auth.getUser(token);
      user = data.user;
    }

    const slug = request.nextUrl.pathname.split('/')[3];
    const supabase = getSupabaseAdmin();

    let app: { id: string; stripe_subscription_id: string | null } | null = null;
    if (token && user) {
      const { data } = await supabase
        .from('apps')
        .select('id, stripe_subscription_id')
        .eq('slug', slug)
        .single();
      app = data;
    }

    let appUser: { id: string } | null = null;
    if (app) {
      const { data } = await supabase
        .from('app_users')
        .select('id')
        .eq('app_id', app.id)
        .eq('user_id', user!.id)
        .eq('role', 'admin')
        .eq('is_active', true)
        .maybeSingle();
      appUser = data;
    }

    const decision = authorizeCancelSubscription({ token, user, app, appUser });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(app!.stripe_subscription_id!, {
      cancel_at_period_end: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    return NextResponse.json({ error: 'Errore durante la disdetta' }, { status: 500 });
  }
}
