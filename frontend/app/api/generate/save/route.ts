// ─── Save Generated App to Supabase ───────────────────────────────────────────────
// Salva lo schema generato da Totalium nella tabella apps

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin user ID - bypassa tutti i limiti
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// Genera slug univoco
function generateSlug(name: string): string {
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const randomSuffix = Math.random().toString(36).slice(-6);
  return `${slugBase}-${randomSuffix}`;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[save-generated-app] === RICHIESTA RICEVUTA ===');
    
    const body = await request.json();
    const { schema, appName, sector, userId } = body;
    
    console.log('[save-generated-app] Input ricevuti:', {
      appName,
      sector,
      userId,
      hasSchema: !!schema,
      schemaKeys: schema ? Object.keys(schema) : [],
      hasTables: schema?.tables ? schema.tables.length : 0
    });

    if (!schema || !appName) {
      console.error('[save-generated-app] Validazione fallita: schema o appName mancanti');
      return NextResponse.json({
        success: false,
        error: 'Schema e appName sono richiesti'
      }, { status: 400 });
    }

    // Verifica che l'utente sia autenticato
    if (!userId) {
      console.error('[save-generated-app] Validazione fallita: userId mancante');
      return NextResponse.json({
        success: false,
        error: 'Utente non autenticato'
      }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    console.log('[save-generated-app] Supabase admin client creato');

    // Ottieni il tenant dell'utente
    console.log('[save-generated-app] Ricerca tenant per userId:', userId);
    const { data: membership, error: membershipError } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .single();

    console.log('[save-generated-app] Risultato query tenant_members:', {
      membershipError: membershipError?.message,
      hasMembership: !!membership,
      tenantId: membership?.tenant_id
    });

    if (!membership || !membership.tenant_id) {
      console.error('[save-generated-app] Nessun tenant trovato per userId:', userId);
      return NextResponse.json({
        success: false,
        error: 'Nessun tenant associato all\'utente'
      }, { status: 400 });
    }

    const tenantId = membership.tenant_id;
    console.log('[save-generated-app] Tenant ID estratto:', tenantId);

    // Genera slug
    const slug = generateSlug(appName);
    console.log('[save-generated-app] Slug generato:', slug);

    // Calcola la data di fine trial (30 giorni)
    const trialEndAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    console.log('[save-generated-app] Date trial:', { trialEndAt });

    // Genera credenziali client se non fornite
    let clientEmail = body.client_email;
    let clientPassword = body.client_password;
    
    if (!clientEmail || !clientPassword) {
      // Recupera l'email del tenant owner. `tenants` non ha mai avuto colonne
      // `owner_email`/`email` (bug pre-esistente: quella select falliva
      // sempre silenziosamente, facendo cadere ogni volta sul fallback
      // client-<timestamp>@zeusx.app) — l'unico modo corretto è risolvere
      // l'email tramite owner_id su auth.users.
      const { data: tenant } = await supabase
        .from('tenants')
        .select('owner_id')
        .eq('id', tenantId)
        .single();

      let ownerEmail: string | undefined;
      if (tenant?.owner_id) {
        const { data: ownerUser } = await supabase.auth.admin.getUserById(tenant.owner_id);
        ownerEmail = ownerUser?.user?.email;
      }

      clientEmail = ownerEmail || `client-${Date.now()}@zeusx.app`;
      
      // Genera password casuale di 12 caratteri
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
      clientPassword = Array.from({ length: 12 }, () => 
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
      
      console.log('[save-generated-app] Credenziali generate:', {
        email: clientEmail,
        password: clientPassword
      });
    }

    // Prepara i dati per l'inserimento
    const productionAppUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}`;
    const appData = {
      name: appName,
      slug,
      tenant_id: tenantId,
      production_url: productionAppUrl,
      config: {
        schema,
        ui: schema.ui || {},
        is_published: true,
        appName,
        sector: sector || 'generale',
        description: schema.description || ''
      },
      client_email: clientEmail,
      client_password: clientPassword,
      client_active: true,
      status: 'trial',
      trial_ends_at: trialEndAt
    };
    
    console.log('[save-generated-app] Dati app da inserire:', {
      name: appData.name,
      slug: appData.slug,
      tenant_id: appData.tenant_id,
      status: appData.status
    });

    // Salva l'app nella tabella apps
    console.log('[save-generated-app] Esecuzione INSERT nella tabella apps...');
    const { data: newApp, error: appError } = await supabase
      .from('apps')
      .insert(appData)
      .select('id, slug')
      .single();

    console.log('[save-generated-app] Risultato INSERT apps:', {
      appError: appError ? {
        message: appError.message,
        details: appError.details,
        hint: appError.hint,
        code: appError.code
      } : null,
      hasNewApp: !!newApp,
      newAppId: newApp?.id,
      newAppSlug: newApp?.slug
    });

    if (appError || !newApp) {
      console.error('[save-generated-app] ERRORE durante INSERT in apps:', appError);
      return NextResponse.json({
        success: false,
        error: 'Errore nel salvataggio dell\'app: ' + (appError?.message || 'unknown'),
        details: appError ? {
          message: appError.message,
          details: appError.details,
          hint: appError.hint,
          code: appError.code
        } : undefined
      }, { status: 500 });
    }

    console.log('[save-generated-app] App creata con successo:', newApp.id);

    // Registra l'app nella app_registry per la Management Console
    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${newApp.slug}`;
    const { error: registryError } = await supabase
      .from('app_registry')
      .insert({
        reseller_id: userId,
        app_name: appName,
        app_url: appUrl,
        status: 'active',
        monthly_fee: 0.00,
        zeusx_share: 0.00,
      });

    if (registryError) {
      console.error('[save-generated-app] ERRORE durante INSERT in app_registry:', registryError);
    } else {
      console.log('[save-generated-app] app_registry creata con successo');
    }

    // Crea anche la definizione nella tabella app_definitions
    const definitionData = {
      app_id: newApp.id,
      tenant_id: tenantId,
      schema,
      ui_config: schema.ui || {},
      is_published: true,
    };
    
    console.log('[save-generated-app] Inserimento app_definitions con dati:', {
      app_id: definitionData.app_id,
      tenant_id: definitionData.tenant_id,
      hasSchema: !!definitionData.schema
    });
    
    const { error: definitionError } = await supabase
      .from('app_definitions')
      .upsert(definitionData, { onConflict: 'app_id' });

    if (definitionError) {
      console.error('[save-generated-app] ERRORE durante INSERT in app_definitions:', definitionError);
    } else {
      console.log('[save-generated-app] app_definitions creata/aggiornata con successo');
    }

  console.log('[save-generated-app] === RISPOSTA FINALE ===', {
    success: true,
    appId: newApp.id,
    slug: newApp.slug,
    clientEmail: clientEmail,
    clientPassword: clientPassword
  });

  return NextResponse.json({
    success: true,
    appId: newApp.id,
    slug: newApp.slug,
    clientEmail: clientEmail,
    clientPassword: clientPassword
  });

  } catch (err) {
    console.error('[save-generated-app] ERRORE IMPREVISTO:', err);
    console.error('[save-generated-app] Stack trace:', err instanceof Error ? err.stack : 'N/A');
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server'
    }, { status: 500 });
  }
}
