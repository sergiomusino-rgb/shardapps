import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// GET /api/a/[slug]/company-info - Dati aziendali reali per la landing page
// pubblica. Nessuna autenticazione richiesta (la landing è pubblica), ma per
// lo stesso motivo ritorna SOLO i campi safe-per-il-pubblico della tabella di
// sistema "Dati Aziendali": mai IBAN/Codice Fiscale/PEC/P.IVA.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    const { data: record } = await supabase
      .from('app_records')
      .select('data')
      .eq('app_id', app.id)
      .eq('table_name', 'dati_aziendali')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const raw = (record?.data || {}) as Record<string, unknown>;

    return NextResponse.json({
      ragione_sociale: typeof raw.ragione_sociale === 'string' ? raw.ragione_sociale : null,
      indirizzo: typeof raw.indirizzo === 'string' ? raw.indirizzo : null,
      telefono: typeof raw.telefono === 'string' ? raw.telefono : null,
      logo: typeof raw.logo === 'string' ? raw.logo : null,
    });
  } catch (error) {
    console.error('[company-info] error:', error);
    return NextResponse.json(
      { error: 'Errore di connessione al server' },
      { status: 500 }
    );
  }
}
