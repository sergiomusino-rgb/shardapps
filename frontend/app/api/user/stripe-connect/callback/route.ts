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
 * Gestisce il ritorno di Stripe dopo l'onboarding.
 * Verifica lo stato dell'account e aggiorna il profilo.
 *
 * FASE 4B.3 / Fix minimo B (Finding #3): prima di questo fix l'endpoint
 * fidava ciecamente `user_id` dalla query string per decidere quale profilo
 * aggiornare con `account` — anch'esso dalla query string, senza alcun
 * controllo di appartenenza. Chiunque conoscesse un `account` Stripe valido
 * poteva forzare `profiles.stripe_connect_id` per un `user_id` arbitrario
 * (account takeover / manomissione del Merchant of Record collegato a un
 * profilo altrui). Ora:
 * - l'identità del chiamante viene SEMPRE dal Bearer token autenticato
 *   (stesso pattern di stripe-connect/route.ts), mai dalla query string;
 * - `user_id` in query string non viene più letto/usato in alcun modo;
 * - l'`account` fornito viene accettato solo se il suo `metadata.user_id`
 *   (scritto server-side in stripe-connect/route.ts al momento della
 *   creazione dell'account, mai da input utente) corrisponde all'utente
 *   autenticato: `account` da solo non è mai una chiave di autorizzazione.
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

  try {
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

    const searchParams = request.nextUrl.searchParams;
    const accountId = searchParams.get('account');

    if (!accountId) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?stripe_connect=error&reason=no_account', appUrl)
      );
    }

    // Recupera l'account Stripe per verificare lo stato e l'appartenenza.
    const account = await stripe.accounts.retrieve(accountId);

    // L'unica prova di appartenenza accettata: il metadata dell'account,
    // scritto esclusivamente dal nostro backend alla creazione
    // (stripe.accounts.create({ metadata: { user_id: user.id } }) in
    // stripe-connect/route.ts). Se non corrisponde all'utente autenticato,
    // non aggiorniamo nulla: né un `user_id` fornito dal chiamante né il
    // solo possesso di un `account` id valido bastano.
    if (account.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: 'Account non associato a questo utente' }, { status: 403 });
    }

    // Verifica se l'account è completo
    const isComplete = account.charges_enabled && account.payouts_enabled;

    await supabase
      .from('profiles')
      .update({
        stripe_connect_id: accountId,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    // Reindirizza con lo stato dell'onboarding
    const status = isComplete ? 'success' : 'incomplete';

    return NextResponse.redirect(
      new URL(`/dashboard/settings?stripe_connect=${status}`, appUrl)
    );
  } catch (error) {
    console.error('[Stripe Connect Callback] Errore:', error);
    return NextResponse.redirect(
      new URL('/dashboard/settings?stripe_connect=error', appUrl)
    );
  }
}
