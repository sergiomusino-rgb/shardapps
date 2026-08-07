import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Nessun fallback alla anon key: questo client deve bypassare la RLS (usato
// dopo i controlli di autorizzazione già fatti in ciascun handler). Degradare
// silenziosamente alla anon key se la service role key manca farebbe fallire
// in modo imprevedibile le query sulle colonne/righe protette da RLS, invece
// di un errore di configurazione chiaro.
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Campi anagrafici dell'acquirente/titolare dell'app (distinti dalle
// credenziali di login gestite da client-access/route.ts). Whitelist
// esplicita così il body della richiesta non può scrivere altre colonne.
const CLIENT_PROFILE_FIELDS = [
  'client_full_name',
  'client_phone',
  'client_tax_id',
  'client_billing_address',
  'client_notes',
] as const;

// White label ("Brandizza la tua app", piano Business): unici campi
// scrivibili dentro config.branding via questa route, whitelist esplicita
// per lo stesso motivo di CLIENT_PROFILE_FIELDS — il body non può scrivere
// altre chiavi di config.branding (es. company_name/logo_url, di pertinenza
// del motore Creator).
const BRANDING_FIELDS = ['footer_logo_url', 'footer_label'] as const;
// Limite dimensione data URL del logo (base64): stesso ordine di grandezza
// del body limit delle Server Actions in next.config.ts (2mb), qui applicato
// lato server perché le route handler non hanno quel limite di default.
const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    const { id } = await params;

    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: memberships } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1);

    const tenantId = memberships?.[0]?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    const { data: app, error: appError } = await adminClient
      .from('apps')
      .select('id, name, slug, tenant_id, status, trial_ends_at, client_email, client_password, auth_mode, config')
      .eq('id', id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    return NextResponse.json({ app });
  } catch (error) {
    console.error('[GET /api/apps/:id] error:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = req.headers.get('authorization');
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

    const { id } = await params;

    // Usa service role per bypassare RLS e verificare ownership
    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: memberships } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1);

    const tenantId = memberships?.[0]?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    const { data: app, error: appError } = await adminClient
      .from('apps')
      .select('id, tenant_id, client_active, expires_at')
      .eq('id', id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    // Permetti eliminazione solo se app non attiva (client_active === false) o scaduta
    const isActive = app.client_active !== false && (!app.expires_at || new Date(app.expires_at) > new Date());
    if (isActive) {
      return NextResponse.json({ error: 'Puoi eliminare solo app dismesse o scadute' }, { status: 400 });
    }

    // Elimina eventuali record associati
    await adminClient
      .from('app_records')
      .delete()
      .eq('app_id', id);

    // Elimina l'app
    const { error: deleteError } = await adminClient
      .from('apps')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[DELETE /api/apps/:id] delete error:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/apps/:id] error:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessione utente in localStorage (non cookie): stesso schema di
    // GET/DELETE qui sopra, il client invia il token via header Authorization.
    const authHeader = req.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { id } = await params;

    const { data: memberships } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1);

    const tenantId = memberships?.[0]?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, string | null> = {};
    for (const field of CLIENT_PROFILE_FIELDS) {
      if (field in body) {
        updates[field] = typeof body[field] === 'string' ? body[field] : null;
      }
    }

    // White label ("Brandizza la tua app"): riservato al piano Business,
    // verificato qui e non solo lato UI perché questa route è l'unico punto
    // di scrittura di config.branding.footer_logo_url/footer_label.
    let brandingUpdate: Record<string, string | null> | null = null;
    if (body.branding && typeof body.branding === 'object') {
      const { data: tenant } = await adminClient
        .from('tenants')
        .select('plan')
        .eq('id', tenantId)
        .single();

      if ((tenant as { plan?: string } | null)?.plan !== 'business') {
        return NextResponse.json(
          { error: 'Il white label è disponibile solo con il piano Business', code: 'PLAN_REQUIRED' },
          { status: 403 }
        );
      }

      brandingUpdate = {};
      for (const field of BRANDING_FIELDS) {
        if (!(field in body.branding)) continue;
        const val = body.branding[field];
        if (field === 'footer_logo_url' && typeof val === 'string' && val.length > MAX_LOGO_DATA_URL_LENGTH) {
          return NextResponse.json({ error: 'Logo troppo grande, usa un\'immagine più leggera' }, { status: 400 });
        }
        brandingUpdate[field] = typeof val === 'string' ? val : null;
      }
    }

    if (Object.keys(updates).length === 0 && !brandingUpdate) {
      return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 });
    }

    const finalUpdates: Record<string, unknown> = { ...updates };

    if (brandingUpdate) {
      // config è un JSONB: niente merge parziale lato DB, va letto e
      // riscritto per intero (stesso pattern già usato dal Creator per
      // salvare lo schema — vedi AppEditorView.tsx) per non perdere il resto
      // di config (schema, businessConfig, altri campi di branding).
      const { data: currentApp } = await adminClient
        .from('apps')
        .select('config')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (!currentApp) {
        return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
      }

      const currentConfig = (currentApp.config as Record<string, unknown>) || {};
      const currentBranding = (currentConfig.branding as Record<string, unknown>) || {};
      finalUpdates.config = { ...currentConfig, branding: { ...currentBranding, ...brandingUpdate } };
    }

    const { data: app, error: updateError } = await adminClient
      .from('apps')
      // finalUpdates è costruito dinamicamente da whitelist (CLIENT_PROFILE_FIELDS/
      // BRANDING_FIELDS): il cast bypassa la corrispondenza esatta col tipo Update generato.
      .update(finalUpdates as any)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, client_full_name, client_phone, client_tax_id, client_billing_address, client_notes, config')
      .single();

    if (updateError || !app) {
      console.error('[PATCH /api/apps/:id] update error:', updateError);
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    return NextResponse.json({ success: true, app });
  } catch (error) {
    console.error('[PATCH /api/apps/:id] error:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}
