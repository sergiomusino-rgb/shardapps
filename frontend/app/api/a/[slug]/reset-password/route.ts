import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

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

    // Recupera app tramite slug
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, client_email, client_active, expires_at')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Verifica che l'email corrisponda
    if (app.client_email !== email) {
      return NextResponse.json({ error: 'Email non corretta' }, { status: 401 });
    }

    // Verifica che l'app sia attiva
    if (!app.client_active) {
      return NextResponse.json({ error: 'App bloccata o scaduta' }, { status: 403 });
    }

    // Genera nuova password
    const newPassword = generatePassword();

    // Aggiorna password nel DB (sia client_password che initial_password)
    const { error: updateError } = await supabase
      .from('apps')
      .update({
        client_password: newPassword,
        initial_password: newPassword,
      })
      .eq('id', app.id);

    if (updateError) {
      return NextResponse.json({ error: 'Errore aggiornamento password' }, { status: 500 });
    }

    // Credenziali anche in app_credentials (mai esposta alla Data API
    // pubblica, vedi 20260808000004_app_credentials_table.sql); dual-write
    // su apps.client_password/initial_password sopra mantenuto per
    // compatibilità.
    await supabase
      .from('app_credentials')
      .upsert(
        { app_id: app.id, client_password: newPassword, initial_password: newPassword },
        { onConflict: 'app_id' }
      );

    // Ritorna la nuova password
    return NextResponse.json({ success: true, new_password: newPassword });
  } catch (err) {
    console.error('[reset-password] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
