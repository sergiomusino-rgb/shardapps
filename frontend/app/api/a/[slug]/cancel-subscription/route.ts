import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

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
    // autenticazione. Stesso modello di ownership già usato da
    // register/route.ts: solo un utente Supabase con una riga app_users
    // (role 'admin') per QUESTA specifica app può gestirne l'abbonamento.
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Autenticazione richiesta' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await getSupabaseAuth().auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token non valido' }, { status: 401 });
    }

    const slug = request.nextUrl.pathname.split('/')[3];

    const supabase = getSupabaseAdmin();

    // Get app info
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, stripe_subscription_id')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Ownership: l'utente autenticato deve essere l'admin registrato di
    // QUESTA app (stesso vincolo imposto alla registrazione), non di un'app
    // qualsiasi — un 'agent'/'viewer'/'editor' non gestisce la fatturazione.
    const { data: appUser } = await supabase
      .from('app_users')
      .select('id')
      .eq('app_id', app.id)
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .eq('is_active', true)
      .maybeSingle();

    if (!appUser) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    if (!app.stripe_subscription_id) {
      return NextResponse.json({ error: 'Nessun abbonamento attivo' }, { status: 400 });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(app.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    return NextResponse.json({ error: 'Errore durante la disdetta' }, { status: 500 });
  }
}
