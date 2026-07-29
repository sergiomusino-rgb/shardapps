import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient<Database>(
    supabaseUrl || '',
    supabaseServiceKey || ''
  );
}

// GET /a/:slug/api/invoices - Get all invoices for the app
export async function GET(request: NextRequest) {
  try {
    // Get slug from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const slug = pathParts[pathParts.indexOf('a') + 1];

    // Verify authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Token di autorizzazione mancante' },
        { status: 401 }
      );
    }

    const password = authHeader.substring(7);
    const supabase = getSupabase();

    // Find app by slug and verify password
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, tenant_id, client_password, client_active, expires_at')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json(
        { error: 'App non trovata' },
        { status: 404 }
      );
    }

    if (app.client_active === false) {
      return NextResponse.json(
        { error: 'App bloccata' },
        { status: 403 }
      );
    }

    if (app.expires_at && new Date(app.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'App scaduta' },
        { status: 403 }
      );
    }

    if (app.client_password !== password) {
      return NextResponse.json(
        { error: 'Password errata' },
        { status: 401 }
      );
    }

    // Load invoices from database
    const { data: fatture, error: fattureError } = await supabase
      .from('fatture')
      .select('*')
      .eq('tenant_id', app.tenant_id)
      .order('created_at', { ascending: false });

    if (fattureError) {
      console.error('Errore caricamento fatture:', fattureError);
      return NextResponse.json(
        { error: 'Errore nel caricamento delle fatture' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      fatture: fatture || [],
    });
  } catch (error) {
    console.error('Errore API fatture:', error);
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    );
  }
}

// POST /a/:slug/api/invoices - Create new invoice
export async function POST(request: NextRequest) {
  try {
    // Get slug from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const slug = pathParts[pathParts.indexOf('a') + 1];

    // Verify authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Token di autorizzazione mancante' },
        { status: 401 }
      );
    }

    const password = authHeader.substring(7);
    const supabase = getSupabase();

    // Find app by slug and verify password
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, tenant_id, client_password, client_active, expires_at')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json(
        { error: 'App non trovata' },
        { status: 404 }
      );
    }

    if (app.client_active === false) {
      return NextResponse.json(
        { error: 'App bloccata' },
        { status: 403 }
      );
    }

    if (app.expires_at && new Date(app.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'App scaduta' },
        { status: 403 }
      );
    }

    if (app.client_password !== password) {
      return NextResponse.json(
        { error: 'Password errata' },
        { status: 401 }
      );
    }

    const body = await request.json();

    const tipoDocumento: 'fattura' | 'ricevuta' = body.tipo_documento === 'ricevuta' ? 'ricevuta' : 'fattura';
    // La ricevuta non richiede la P.IVA del cliente (spesso un privato); la
    // fattura sì, per restare un documento fiscale valido.
    if (tipoDocumento === 'fattura' && !body.cliente_piva) {
      return NextResponse.json(
        { error: 'La P.IVA/Codice Fiscale del cliente è obbligatoria per una fattura' },
        { status: 400 }
      );
    }

    const anno: number = body.anno || new Date().getFullYear();

    // Numero progressivo reale (non generato lato client): conta i documenti
    // dello stesso tenant+tipo+anno e assegna il prossimo, zero-padded.
    const { count, error: countError } = await supabase
      .from('fatture')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', app.tenant_id)
      .eq('tipo_documento', tipoDocumento)
      .eq('anno', anno);

    if (countError) {
      console.error('Errore conteggio fatture per numerazione:', countError);
      return NextResponse.json(
        { error: 'Errore nella generazione del numero documento' },
        { status: 500 }
      );
    }

    const numeroProgressivo = String((count || 0) + 1).padStart(4, '0');

    // Create new invoice
    const { data: nuovaFattura, error: insertError } = await supabase
      .from('fatture')
      .insert({
        tenant_id: app.tenant_id,
        numero_fattura: numeroProgressivo,
        anno,
        data_emissione: body.data_emissione,
        cliente_nome: body.cliente_nome,
        cliente_piva: body.cliente_piva,
        cliente_indirizzo: body.cliente_indirizzo,
        stato: body.stato || 'bozza',
        metodo_pagamento: body.metodo_pagamento,
        tipo_documento: tipoDocumento,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Errore creazione fattura:', insertError);
      return NextResponse.json(
        { error: 'Errore nella creazione della fattura' },
        { status: 500 }
      );
    }

    // Save righe if provided
    if (body.righe && Array.isArray(body.righe)) {
      interface RigaInput {
        descrizione: string;
        quantita: number;
        prezzo_unitario: number;
        aliquota_iva?: number;
      }
      const righeToInsert = (body.righe as RigaInput[]).map((r) => ({
        fattura_id: nuovaFattura.id,
        descrizione: r.descrizione,
        quantita: r.quantita,
        prezzo_unitario: r.prezzo_unitario,
        aliquota_iva: r.aliquota_iva || 22,
      }));

      const { error: righeError } = await supabase
        .from('righe_fattura')
        .insert(righeToInsert);

      if (righeError) {
        console.error('Errore creazione righe fattura:', righeError);
        // Non bloccare la creazione della fattura, ma loggiamo l'errore
      }
    }

    return NextResponse.json({
      fattura: nuovaFattura,
    });
  } catch (error) {
    console.error('Errore creazione fattura:', error);
    return NextResponse.json(
      { error: 'Errore nella creazione della fattura' },
      { status: 500 }
    );
  }
}