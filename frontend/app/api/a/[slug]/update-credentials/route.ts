import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { hashPassword } from '@/src/lib/password-hash';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { client_email, client_password } = body;

    // Validazioni base
    if (!client_email || !client_email.includes('@')) {
      return NextResponse.json(
        { success: false, error: 'Email non valida' },
        { status: 400 }
      );
    }

    if (client_password && client_password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'La password deve essere di almeno 8 caratteri' },
        { status: 400 }
      );
    }

    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Usa anon key per autenticare l'utente
    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    // Usa service role per verificare ownership e aggiornare
    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verifica che l'utente appartenga a un tenant
    const { data: memberships } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1);

    const tenantId = memberships?.[0]?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    // Verifica che l'app appartenga al tenant
    const { data: app, error: appError } = await adminClient
      .from('apps')
      .select('id, tenant_id')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    // Pre-Beta Hardening, Blocco 6: solo l'hash viene persistito — il
    // reseller ha appena digitato questa password nel form, non deve essere
    // richiesta indietro da nessuna query dopo questo salvataggio.
    const hashedPassword = client_password ? await hashPassword(client_password) : undefined;

    // Prepara i dati per l'aggiornamento
    const updateData: any = {
      client_email: client_email,
    };

    if (hashedPassword) {
      updateData.client_password = hashedPassword;
    }

    // Aggiorna l'app
    const { error: updateError } = await adminClient
      .from('apps')
      .update(updateData)
      .eq('id', app.id);

    if (updateError) {
      console.error('[update-credentials] Error updating app:', updateError);
      return NextResponse.json(
        { success: false, error: 'Errore durante l\'aggiornamento delle credenziali' },
        { status: 500 }
      );
    }

    // Credenziali anche in app_credentials (mai esposta alla Data API
    // pubblica, vedi 20260808000004_app_credentials_table.sql); dual-write
    // su apps.client_password sopra mantenuto per compatibilità.
    //
    // Validazione live V4 (preview zeusx-zwu8): questo upsert non
    // controllava mai il proprio errore — un fallimento silenzioso qui
    // lasciava apps.client_password aggiornato ma app_credentials con
    // l'hash VECCHIO, e verify-password legge app_credentials per primo
    // (fallback su apps solo se assente): risultato, "Credenziali
    // aggiornate con successo" mostrato al reseller mentre il login con la
    // password nuova falliva con "Password errata". Ora un errore qui
    // blocca la risposta di successo — non c'è ancora un rollback
    // transazionale sull'update già fatto su apps (richiederebbe una RPC
    // dedicata), ma il client non deve mai vedere "successo" se le due
    // tabelle sono rimaste disallineate.
    if (hashedPassword) {
      const { error: credentialsError } = await adminClient
        .from('app_credentials')
        .upsert({ app_id: app.id, client_password: hashedPassword }, { onConflict: 'app_id' });

      if (credentialsError) {
        console.error('[update-credentials] Error updating app_credentials:', credentialsError);
        return NextResponse.json(
          { success: false, error: 'Errore durante l\'aggiornamento delle credenziali' },
          { status: 500 }
        );
      }
    }

    console.log('[update-credentials] Credentials updated for app:', app.id);

    return NextResponse.json({
      success: true,
      message: 'Credenziali aggiornate con successo'
    });

  } catch (error) {
    console.error('[update-credentials] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Errore interno del server' },
      { status: 500 }
    );
  }
}