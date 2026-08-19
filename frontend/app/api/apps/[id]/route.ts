import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { looksHashed } from '@/src/lib/password-hash';

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

// Preferenze di notifica per-app (Notifications, Round 2 — migration
// 20260828000000_notification_preferences.sql). Solo {"email": boolean} oggi
// (vedi commento della migration sul perché push non ha un secondo switch a
// livello app): whitelist esplicita per lo stesso motivo di BRANDING_FIELDS.
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

    // Pre-Beta Hardening, Blocco 6: client_password è ora hashato dal
    // momento del primo login/reset successivo a questo cambio — un hash
    // bcrypt non è comunque una password mostrabile, quindi non viene mai
    // restituito qui (il pannello mostra "—" invece di un hash illeggibile,
    // vedi dashboard/app-create/page.tsx). Un account non ancora migrato
    // (valore ancora in chiaro) continua a essere mostrato come oggi.
    const safeApp = { ...app, client_password: looksHashed(app.client_password) ? null : app.client_password };

    return NextResponse.json({ app: safeApp });
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
      .select('id, tenant_id, client_active, expires_at, trial_ends_at')
      .eq('id', id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    // Permetti eliminazione solo se scaduta o dismessa. "Scaduta" considera
    // ENTRAMBE le colonne di scadenza (non solo expires_at): un'app appena
    // creata ha solo trial_ends_at valorizzato (expires_at resta NULL finché
    // non viene assegnato un piano/scadenza commerciale, vedi api/apps/
    // route.ts) — controllare solo expires_at la rendeva "sempre attiva" agli
    // occhi del backend anche a trial scaduto, disallineato dalla UI
    // (dashboard/projects/page.tsx::getStatusBadge, stessa regola qui sotto)
    // che mostrava già "Scaduta" in quel caso: il pulsante cestino compariva
    // ma il DELETE falliva sempre con 400.
    const now = new Date();
    const isExpired =
      (!!app.expires_at && new Date(app.expires_at) < now) ||
      (!!app.trial_ends_at && new Date(app.trial_ends_at) < now);
    const canDelete = isExpired || app.client_active === false;
    if (!canDelete) {
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
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

    // notificationPreferences.email: unico interruttore scrivibile qui.
    // Nessun piano richiesto (a differenza del branding): disattivare le
    // email automatiche non è una feature commerciale, è un controllo
    // operativo disponibile a qualunque owner.
    let notificationPreferencesUpdate: { email: boolean } | null = null;
    if (body.notificationPreferences && typeof body.notificationPreferences === 'object') {
      if (typeof body.notificationPreferences.email !== 'boolean') {
        return NextResponse.json({ error: 'notificationPreferences.email deve essere un booleano' }, { status: 400 });
      }
      notificationPreferencesUpdate = { email: body.notificationPreferences.email };
    }

    if (Object.keys(updates).length === 0 && !brandingUpdate && !notificationPreferencesUpdate) {
      return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 });
    }

    const finalUpdates: Record<string, unknown> = { ...updates };
    if (notificationPreferencesUpdate) {
      finalUpdates.notification_preferences = notificationPreferencesUpdate;
    }

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
      .select('id, client_full_name, client_phone, client_tax_id, client_billing_address, client_notes, config, notification_preferences')
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
