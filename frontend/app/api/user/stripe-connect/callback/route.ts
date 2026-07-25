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
 * GET /api/user/stripe-connect/callback
 * Gestisce il ritorno di Stripe dopo l'onboarding
 * Verifica lo stato dell'account e aggiorna il profilo
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const accountId = searchParams.get('account');
    const userId = searchParams.get('user_id');

    if (!accountId) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?stripe_connect=error&reason=no_account', request.nextUrl.origin)
      );
    }

    const supabase = getSupabase();

    // Recupera l'account Stripe per verificare lo stato
    const account = await stripe.accounts.retrieve(accountId);

    // Verifica se l'account è completo
    const isComplete = account.charges_enabled && account.payouts_enabled;

    // Se è fornito l'user_id, aggiorna il profilo
    if (userId) {
      await supabase
        .from('profiles')
        .update({ 
          stripe_connect_id: accountId,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    }

    // Reindirizza con lo stato dell'onboarding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const status = isComplete ? 'success' : 'incomplete';
    
    return NextResponse.redirect(
      new URL(`/dashboard/settings?stripe_connect=${status}`, appUrl)
    );
  } catch (error) {
    console.error('[Stripe Connect Callback] Errore:', error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(
      new URL(`/dashboard/settings?stripe_connect=error&reason=${encodeURIComponent(
        error instanceof Error ? error.message : 'unknown_error'
      )}`, appUrl)
    );
  }
}