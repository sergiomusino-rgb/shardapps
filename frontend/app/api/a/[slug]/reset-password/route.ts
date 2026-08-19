import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { sendTemplatedEmail } from '@/src/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minuti

// Messaggio generico unico per ogni esito "non procediamo" (app inesistente,
// email non corrispondente, app bloccata): non deve mai rivelare quale di
// questi casi si è verificato, altrimenti l'endpoint torna a essere un oracle
// per enumerare slug/email validi (FASE 4A, Finding #2).
function genericAcceptedResponse() {
  return NextResponse.json({
    success: true,
    message: "Se l'indirizzo è associato a questa app, riceverai un'email con le istruzioni per reimpostare la password.",
  });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Invio centralizzato (Notifications, Pre-Beta Hardening Round 2): prima
// questa funzione faceva una fetch raw verso Resend con un mittente
// hardcoded DIVERSO da RESEND_FROM_EMAIL usato ovunque altrove nel progetto
// ("noreply@zeusx.it" qui, "noreply@zeusx.com" altrove — un bug reale, non
// solo un'inconsistenza), nessun timeout, nessun retry. Ora delega a
// src/lib/email.ts (timeout+retry+template condiviso) — SEMPRE inviata
// indipendentemente da notification_preferences: è l'utente stesso ad averla
// richiesta pochi secondi prima, non una notifica applicativa disattivabile.
async function sendResetEmail(toEmail: string, appName: string | null, slug: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shardapps.com';
  const resetLink = `${appUrl}/a/${slug}/reset-password?token=${token}`;

  const result = await sendTemplatedEmail(toEmail, 'password_reset', { resetLink, appName: appName || undefined }, { route: 'reset-password' });
  if (!result.sent && !result.skipped) {
    console.error('[reset-password] invio email fallito:', result.error);
  } else if (result.skipped) {
    console.log(`[reset-password] ${result.reason}, link di reset per ${toEmail}: ${resetLink}`);
  }
}

// ─── POST /api/a/[slug]/reset-password ─────────────────────────────────────
// Richiesta di reset: NON verifica il possesso della casella email da sola
// (chiunque può fornire una email), quindi non deve mai cambiare la password
// né restituirla. Genera un token monouso a scadenza breve e lo invia
// all'indirizzo registrato (client_email); solo chi ha accesso a quella
// casella può completare il reset via /api/a/[slug]/reset-password/confirm.
// Risposta identica in ogni caso di fallimento per non rivelare se slug/email
// esistono (FASE 4A, Finding #2).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email richiesta' }, { status: 400 });
    }

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, name, client_email, client_active')
      .eq('slug', slug)
      .single();

    // App inesistente, email non corrispondente o app bloccata: stessa
    // risposta generica di successo, nessun dettaglio.
    if (appError || !app || !app.client_email || app.client_email !== email || !app.client_active) {
      return genericAcceptedResponse();
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { error: insertError } = await supabase
      .from('app_password_reset_tokens')
      .insert({ token_hash: tokenHash, app_id: app.id, expires_at: expiresAt });

    if (insertError) {
      console.error('[reset-password] Errore creazione token:', insertError);
      // Non riveliamo l'errore interno al chiamante: stessa risposta generica.
      return genericAcceptedResponse();
    }

    await sendResetEmail(app.client_email, app.name, slug, token);

    return genericAcceptedResponse();
  } catch (err) {
    console.error('[reset-password] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
