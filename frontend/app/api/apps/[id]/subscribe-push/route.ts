import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';

// ─── POST /api/apps/[id]/subscribe-push ────────────────────────────────────
// Rotta PUBBLICA (nessuna autenticazione): chi si iscrive è un visitatore
// anonimo della PWA finale (/a/[slug]), non un account ZeusX né un cliente
// loggato in app_users — non ha nessun token da presentare. L'unico controllo
// applicativo è che l'app_id esista davvero: la scrittura vera e propria
// passa dalla service_role key (RLS su app_push_subscriptions nega tutto ad
// anon/authenticated, vedi migrazione 20260808000000).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface PushSubscriptionPayload {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function isValidSubscription(sub: unknown): sub is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as PushSubscriptionPayload;
  return (
    typeof s.endpoint === 'string' &&
    s.endpoint.length > 0 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 10 richieste/minuto per IP: rotta pubblica senza autenticazione, quindi
    // per userId non è possibile — l'IP è l'unico identificatore disponibile.
    const { allowed } = await checkRateLimit(`subscribe-push:${getClientIp(req)}`, 60, 10);
    if (!allowed) {
      return NextResponse.json({ error: 'Troppe richieste, riprova tra poco.' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const subscription = body?.subscription;

    if (!isValidSubscription(subscription)) {
      return NextResponse.json({ error: 'Subscription non valida' }, { status: 400 });
    }

    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: appError } = await adminClient
      .from('apps')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Un browser che richiama questa rotta più volte (reload, click ripetuto
    // sul banner) deve aggiornare la riga esistente invece di duplicarla:
    // l'indice unico app_push_subscriptions_app_endpoint_idx è l'arbitro a
    // livello DB, ma il client Supabase non espone .upsert() su un target di
    // conflitto espressione (subscription->>'endpoint'), quindi verifichiamo
    // esplicitamente prima di scegliere tra update e insert.
    const { data: existing } = await adminClient
      .from('app_push_subscriptions')
      .select('id')
      .eq('app_id', id)
      .eq('subscription->>endpoint', subscription.endpoint)
      .maybeSingle();

    const { error: writeError } = existing
      ? await adminClient
          .from('app_push_subscriptions')
          .update({ subscription })
          .eq('id', existing.id)
      : await adminClient
          .from('app_push_subscriptions')
          .insert({ app_id: id, subscription });

    if (writeError) {
      console.error('[subscribe-push] write error:', writeError);
      return NextResponse.json({ error: 'Errore salvataggio subscription' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[subscribe-push] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
