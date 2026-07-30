import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: 'Password obbligatoria' }, { status: 400 });
    }

    const { data: app, error } = await supabase
      .from('apps')
      .select('id, client_password, client_active, expires_at, config, owner_trial_ends_at')
      .eq('slug', slug)
      .single();

    if (error || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (!app.client_active) {
      return NextResponse.json({ error: 'App bloccata', blocked: true }, { status: 403 });
    }

    // Le credenziali vivono ora in app_credentials (mai esposta alla Data
    // API pubblica, vedi 20260808000004_app_credentials_table.sql), con
    // apps.client_password come fallback finché non viene azzerata.
    const { data: creds } = await supabase
      .from('app_credentials')
      .select('client_password')
      .eq('app_id', app.id)
      .maybeSingle();
    if ((creds?.client_password ?? app.client_password) !== password) {
      return NextResponse.json({ error: 'Password errata' }, { status: 401 });
    }

    // Primo accesso: avvia il trial di 30 giorni sulla fee di 25€/mese
    // dell'owner (vedi mark-first-login/route.ts per il modello completo).
    if (!app.owner_trial_ends_at) {
      await supabase
        .from('apps')
        .update({ owner_trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
        .eq('id', app.id)
        .is('owner_trial_ends_at', null);
    }

    return NextResponse.json({
      success: true,
      app: {
        id: app.id,
        name: (app.config as { appName?: string } | null)?.appName || '',
        config: app.config,
        expires_at: app.expires_at,
      },
    });
  } catch (err) {
    console.error('[verify-password] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
