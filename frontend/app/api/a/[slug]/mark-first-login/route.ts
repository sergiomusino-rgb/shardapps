import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';
import { authorizeMarkFirstLogin } from '@/src/lib/mark-first-login-authorization';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Client separato (anon key) solo per verificare il JWT del chiamante, come
// in altre route a/[slug] (es. cancel-subscription): non deve mai usare la
// service role per l'auth.getUser().
function getSupabaseAuth() {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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
// ComandiLoginForm in a/[slug]/login/page.tsx).
//
// Fix Finding #7 (audit Fase 4B): l'endpoint era pubblico e senza
// autenticazione — chiunque conoscesse lo slug pubblico dell'app poteva
// impostare owner_trial_ends_at, anticipando l'inizio della fee di 25€/mese
// a carico del tenant. La decisione (401/403/404/200) è delegata ad
// authorizeMarkFirstLogin (src/lib/mark-first-login-authorization.js, stesso
// pattern di cancel-subscription-authorization.js), testata con node:test —
// qui restano solo le query, eseguite nello stesso ordine/short-circuit:
// ogni passaggio successivo viene eseguito solo se il precedente è andato a
// buon fine. Ownership: owner o admin del tenant proprietario dell'app
// (apps.tenant_id -> tenant_members), non app_users, perché le istanze
// Comandi AI non hanno mai righe in app_users (solo tenant_members).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let user: { id: string } | null = null;
    if (token) {
      const { data } = await getSupabaseAuth().auth.getUser(token);
      user = data.user;
    }

    let app: { id: string; tenant_id: string; owner_trial_ends_at: string | null } | null = null;
    if (token && user) {
      const { data } = await supabase
        .from('apps')
        .select('id, tenant_id, owner_trial_ends_at')
        .eq('slug', slug)
        .single();
      app = data;
    }

    let membership: { role: string } | null = null;
    if (app) {
      const { data } = await supabase
        .from('tenant_members')
        .select('role')
        .eq('tenant_id', app.tenant_id)
        .eq('user_id', user!.id)
        .in('role', ['owner', 'admin'])
        .maybeSingle();
      membership = data;
    }

    const decision = authorizeMarkFirstLogin({ token, user, app, membership });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    if (app!.owner_trial_ends_at) {
      return NextResponse.json({ owner_trial_ends_at: app!.owner_trial_ends_at, alreadySet: true });
    }

    const ownerTrialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Filtro is('owner_trial_ends_at', null) per idempotenza atomica: se due
    // richieste arrivano in parallelo al primo login, solo la prima applica
    // l'update, evitando di spostare la scadenza già impostata dall'altra.
    const { error: updateError } = await supabase
      .from('apps')
      .update({ owner_trial_ends_at: ownerTrialEndsAt })
      .eq('id', app!.id)
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
