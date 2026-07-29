import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getWebPush, WebPushConfigError } from '@/src/lib/web-push';

// ─── /api/apps/[id]/send-push ───────────────────────────────────────────────
// Riservata all'owner dell'app (Bearer del suo access token + verifica
// tenant_members, stesso schema di /api/apps/[id]/records).
// GET: numero di iscritti attivi (per il contatore in /a/[slug]/settings).
// POST: invia il payload in broadcast a tutte le subscription salvate;
// quelle scadute/revocate (410 Gone o 404 dal push service) vengono rimosse
// invece di continuare a fallire ad ogni invio.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface WebPushSendError extends Error {
  statusCode?: number;
}

function adminClient() {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifica che il chiamante sia un membro del tenant proprietario di `appId`.
 * Ritorna una NextResponse d'errore da propagare subito, oppure null se autorizzato. */
async function requireOwner(req: NextRequest, appId: string): Promise<NextResponse | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  }

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  }

  const admin = adminClient();
  const { data: app, error: appError } = await admin
    .from('apps')
    .select('id, tenant_id')
    .eq('id', appId)
    .single();

  if (appError || !app) {
    return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
  }

  const { data: membership } = await admin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('tenant_id', app.tenant_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
  }

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await requireOwner(req, id);
  if (denied) return denied;

  const { count, error } = await adminClient()
    .from('app_push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', id);

  if (error) {
    console.error('[send-push GET] error:', error);
    return NextResponse.json({ error: 'Errore lettura iscritti' }, { status: 500 });
  }

  return NextResponse.json({ count: count || 0 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const denied = await requireOwner(req, id);
    if (denied) return denied;

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const url = typeof body?.url === 'string' ? body.url.trim() : '/';

    if (!title || !message) {
      return NextResponse.json({ error: 'Titolo e messaggio sono richiesti' }, { status: 400 });
    }

    const admin = adminClient();
    const { data: subscriptions, error: subsError } = await admin
      .from('app_push_subscriptions')
      .select('id, subscription')
      .eq('app_id', id);

    if (subsError) {
      console.error('[send-push] error reading subscriptions:', subsError);
      return NextResponse.json({ error: 'Errore lettura iscritti' }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ success: true, sent: 0, failed: 0, removed: 0 });
    }

    let webpush;
    try {
      webpush = getWebPush();
    } catch (err) {
      if (err instanceof WebPushConfigError) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
      throw err;
    }

    const payload = JSON.stringify({ title, body: message, url });
    const staleIds: string[] = [];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(
            row.subscription as unknown as Parameters<typeof webpush.sendNotification>[0],
            payload
          );
          sent += 1;
        } catch (err) {
          const status = (err as WebPushSendError).statusCode;
          // 404/410: la subscription non esiste più lato browser (utente ha
          // disinstallato l'app, revocato il permesso o svuotato i dati) —
          // continuare a inviarle sarebbe solo rumore nei log ad ogni invio.
          if (status === 404 || status === 410) {
            staleIds.push(row.id);
          } else {
            console.error('[send-push] invio fallito:', err);
          }
        }
      })
    );

    if (staleIds.length > 0) {
      await admin.from('app_push_subscriptions').delete().in('id', staleIds);
    }

    return NextResponse.json({
      success: true,
      sent,
      failed: subscriptions.length - sent - staleIds.length,
      removed: staleIds.length,
    });
  } catch (error) {
    console.error('[send-push] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
