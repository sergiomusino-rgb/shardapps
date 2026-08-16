// ─── Save Production URL for Generated App ──────────────────────────────────
// Salva l'URL di produzione reale nella tabella apps

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: NextRequest) {
  try {
    console.log('[save-production-url] === RICHIESTA RICEVUTA ===');

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { appId, appSlug } = body;

    if (!appId || !appSlug) {
      console.error('[save-production-url] Validazione fallita: appId o appSlug mancanti');
      return NextResponse.json({
        success: false,
        error: 'appId e appSlug sono richiesti'
      }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // appId non viene mai fidato dal body senza verifica: si controlla che
    // l'utente autenticato (JWT Supabase reale) appartenga al tenant
    // proprietario dell'app, altrimenti chiunque potrebbe riscrivere
    // production_url di un'app arbitraria.
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ success: false, error: 'Utente non autenticato' }, { status: 401 });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Token non valido' }, { status: 401 });
    }

    const { data: app, error: appLookupError } = await supabase
      .from('apps')
      .select('tenant_id')
      .eq('id', appId)
      .single();
    if (appLookupError || !app) {
      return NextResponse.json({ success: false, error: 'App non trovata' }, { status: 404 });
    }
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', app.tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Non autorizzato per questa app' }, { status: 403 });
    }

    // Costruisce l'URL di produzione reale
    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://shardapps.com'}/a/${appSlug}`;

    console.log('[save-production-url] URL di produzione generato:', appUrl);

    // Aggiorna l'app con l'URL di produzione
    const { error: updateError } = await supabase
      .from('apps')
      .update({
        production_url: appUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', appId);

    if (updateError) {
      console.error('[save-production-url] ERRORE durante update production_url:', updateError);
      return NextResponse.json({
        success: false,
        error: 'Errore nel salvataggio dell\'URL di produzione: ' + updateError.message
      }, { status: 500 });
    }

    console.log('[save-production-url] production_url salvato con successo per app:', appId);

    return NextResponse.json({
      success: true,
      production_url: appUrl
    });

  } catch (err) {
    console.error('[save-production-url] ERRORE IMPREVISTO:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server'
    }, { status: 500 });
  }
}