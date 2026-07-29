import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// POST /api/a/[slug]/mark-first-login
//
// Segna il primo accesso a questa app impostando apps.owner_trial_ends_at a
// NOW() + 30 giorni, SOLO se è ancora NULL (idempotente: chiamate successive
// non spostano la scadenza). Da questa data, se l'app non viene rivenduta a
// un cliente pagante (status resta diverso da 'active'), backend/routes/
// stripe.js::/update-app-fee inizia a contarla nella fee di 25€/mese del
// tenant — vedi commento lì per il modello completo.
//
// Chiamata da: verify-password/route.ts (gate legacy a client_password) e
// dal client dopo un login riuscito via Supabase Auth (AuthContext.tsx,
// ComandiLoginForm in a/[slug]/login/page.tsx) — non richiede autenticazione
// perché non espone né modifica nulla di sensibile: si limita ad avviare un
// trial che parte comunque da un identificativo pubblico (lo slug).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    const { data: app, error: findError } = await supabase
      .from('apps')
      .select('id, owner_trial_ends_at')
      .eq('slug', slug)
      .single();

    if (findError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.owner_trial_ends_at) {
      return NextResponse.json({ owner_trial_ends_at: app.owner_trial_ends_at, alreadySet: true });
    }

    const ownerTrialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Filtro is('owner_trial_ends_at', null) per idempotenza atomica: se due
    // richieste arrivano in parallelo al primo login, solo la prima applica
    // l'update, evitando di spostare la scadenza già impostata dall'altra.
    const { error: updateError } = await supabase
      .from('apps')
      .update({ owner_trial_ends_at: ownerTrialEndsAt })
      .eq('id', app.id)
      .is('owner_trial_ends_at', null);

    if (updateError) {
      console.error('[mark-first-login] errore update:', updateError);
      return NextResponse.json({ error: 'Errore aggiornamento trial' }, { status: 500 });
    }

    return NextResponse.json({ owner_trial_ends_at: ownerTrialEndsAt, alreadySet: false });
  } catch (err) {
    console.error('[mark-first-login] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
