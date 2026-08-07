import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/user/update-price
 * Aggiorna il prezzo dell'abbonamento per un'app specifica
 * Con validazione: piano Starter richiede prezzo minimo di 25.00€
 */
export async function POST(request: NextRequest) {
  try {
    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = getSupabase();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Token non valido' }, { status: 401 });
    }

    // Leggi il body della richiesta
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { app_id, totalum_app_id, client_subscription_price } = body;

    // Validazione parametri: serve un identificativo dell'app. Le app create
    // con Creator AI non hanno mai totalum_app_id (campo della vecchia
    // pipeline Totalum), quindi accettiamo anche app_id come identificativo
    // primario e manteniamo totalum_app_id solo per compatibilità legacy.
    if (!app_id && !totalum_app_id) {
      return NextResponse.json({ error: 'app_id o totalum_app_id è obbligatorio' }, { status: 400 });
    }

    if (typeof client_subscription_price !== 'number' || client_subscription_price < 0) {
      return NextResponse.json({ error: 'client_subscription_price deve essere un numero valido' }, { status: 400 });
    }

    // Recupera il piano dell'utente tramite il tenant
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Nessun tenant associato all\'utente' }, { status: 403 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan')
      .eq('id', membership.tenant_id)
      .single();

    // Validazione vincolo prezzo minimo per piano Starter
    if (tenant?.plan === 'starter' && client_subscription_price < 25.00) {
      return NextResponse.json({ 
        error: 'Il piano Starter richiede un prezzo minimo di 25.00€ per gli abbonamenti clienti' 
      }, { status: 400 });
    }

    // Aggiorna il prezzo nell'app. Filtriamo sempre anche per tenant_id:
    // senza questo vincolo un utente autenticato potrebbe modificare il
    // prezzo di un'app di un altro tenant conoscendone/indovinandone l'id.
    let updateQuery = supabase
      .from('apps')
      .update({
        client_subscription_price: client_subscription_price,
        client_price: client_subscription_price,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', membership.tenant_id);

    updateQuery = app_id
      ? updateQuery.eq('id', app_id)
      : updateQuery.eq('totalum_app_id', totalum_app_id);

    const { data: app, error: updateError } = await updateQuery.select().single();

    if (updateError) {
      console.error('[update-price] Errore update:', updateError);
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      app_id: app.id,
      client_subscription_price: app.client_subscription_price 
    });
  } catch (error) {
    console.error('[update-price] Errore:', error);
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    );
  }
}