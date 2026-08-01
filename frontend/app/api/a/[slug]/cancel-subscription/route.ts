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

export async function POST(request: NextRequest) {
  try {
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