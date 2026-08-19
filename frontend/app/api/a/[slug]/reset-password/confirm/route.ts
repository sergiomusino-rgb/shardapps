import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { hashPassword } from '@/src/lib/password-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ─── POST /api/a/[slug]/reset-password/confirm ─────────────────────────────
// Secondo passo del reset (vedi POST /api/a/[slug]/reset-password): il token
// ricevuto via email è la sola prova di possesso della casella. Verifica che
// esista, non sia scaduto, non sia già stato usato e sia associato all'app
// dello slug richiesto, poi imposta la password scelta dall'utente.
// Nessuna password viene mai generata server-side o restituita nella
// risposta HTTP.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { token, password } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token mancante o non valido' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'La password deve avere almeno 8 caratteri' }, { status: 400 });
    }

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, client_active')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'Link di reset non valido o scaduto' }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const { data: resetToken, error: tokenError } = await supabase
      .from('app_password_reset_tokens')
      .select('token_hash, app_id, expires_at, used_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (
      tokenError ||
      !resetToken ||
      resetToken.app_id !== app.id ||
      resetToken.used_at !== null ||
      new Date(resetToken.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: 'Link di reset non valido o scaduto' }, { status: 400 });
    }

    if (!app.client_active) {
      return NextResponse.json({ error: 'App bloccata o scaduta' }, { status: 403 });
    }

    // Consuma il token PRIMA di applicare la nuova password, e solo se non è
    // ancora stato usato (guardia anti-riuso in caso di richieste
    // concorrenti sullo stesso token): se il consumo non tocca nessuna riga,
    // qualcun altro lo ha già usato nel frattempo.
    const { data: consumed, error: consumeError } = await supabase
      .from('app_password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .select('token_hash')
      .maybeSingle();

    if (consumeError || !consumed) {
      return NextResponse.json({ error: 'Link di reset non valido o scaduto' }, { status: 400 });
    }

    // Pre-Beta Hardening, Blocco 6: client_password (usato per il confronto
    // ad ogni login) viene hashato; initial_password resta VOLUTAMENTE in
    // chiaro (copia mostrata al reseller, mai usata per autenticare — vedi
    // stesso principio in client-access/route.ts::regenerate-password).
    const hashedPassword = await hashPassword(password);

    const { error: updateError } = await supabase
      .from('apps')
      .update({ client_password: hashedPassword, initial_password: password })
      .eq('id', app.id);

    if (updateError) {
      return NextResponse.json({ error: 'Errore aggiornamento password' }, { status: 500 });
    }

    // Dual-write in app_credentials, mai esposta alla Data API pubblica
    // (vedi 20260808000004_app_credentials_table.sql), stesso pattern già
    // usato da verify-password/route.ts in lettura.
    await supabase
      .from('app_credentials')
      .upsert(
        { app_id: app.id, client_password: hashedPassword, initial_password: password },
        { onConflict: 'app_id' }
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[reset-password/confirm] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
