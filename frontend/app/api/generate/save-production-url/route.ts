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

    const body = await request.json();
    const { appId, appSlug } = body;

    if (!appId || !appSlug) {
      console.error('[save-production-url] Validazione fallita: appId o appSlug mancanti');
      return NextResponse.json({
        success: false,
        error: 'appId e appSlug sono richiesti'
      }, { status: 400 });
    }

    // Costruisce l'URL di produzione reale
    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appSlug}`;
    
    console.log('[save-production-url] URL di produzione generato:', appUrl);

    const supabase = getSupabaseAdmin();

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