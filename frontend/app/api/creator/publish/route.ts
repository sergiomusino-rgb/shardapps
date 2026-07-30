// ─── Creator AI Publish API Route (Next.js App Router) ─────────────────────────────
// Persiste e pubblica lo schema del motore Sito/PWA (site-schema.ts) generato/
// modificato in AppEditorView. Se `appId` è assente crea una nuova app
// (consuma uno slot, genera slug e credenziali dedicate); se presente ed è di
// proprietà del tenant dell'utente aggiorna quella esistente senza consumare
// slot né rigenerare slug/credenziali — copre sia "Pubblica" (primo salvataggio)
// sia "Salva Modifiche" (ripubblicazioni successive) dallo stesso bottone.
//
// Le credenziali generate seguono lo stesso schema legacy (password in
// chiaro) già usato dal resto della piattaforma per l'accesso cliente via
// /a/[slug] (vedi backend/routes/client-app.js): scritte in app_credentials,
// mai in apps.client_password, per restare coerenti con il fix di sicurezza
// pre-lancio (20260808000004_app_credentials_table.sql) — la colonna legacy
// su apps viene comunque valorizzata come fallback, stesso pattern usato lì.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { sanitizeSiteBlueprint } from '@/src/lib/site-schema';
import { ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  generateCreatorSlug,
} from '@/src/lib/creator-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

function generateClientPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema: rawSchema, appId: existingAppId, appName: appNameOverride } = body;

    if (!rawSchema || typeof rawSchema !== 'object') {
      return NextResponse.json({ success: false, error: 'schema è richiesto', code: 'MISSING_INPUT' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Non fidarsi del JSON ricevuto dal client: ri-sanitizzato prima di
    // salvarlo, stesso trattamento di /api/creator/create per il vecchio schema.
    const blueprint = sanitizeSiteBlueprint(rawSchema);
    if (!blueprint) {
      return NextResponse.json({ success: false, error: 'Lo schema fornito non è valido', code: 'INVALID_SCHEMA' }, { status: 400 });
    }

    const tenantId = await getOrCreateTenant(supabase, user, token);
    const appName = (appNameOverride && String(appNameOverride).trim()) || blueprint.appName || blueprint.businessConfig.name;
    const configToSave = { ...blueprint, appName };

    // ─── Aggiornamento di un'app già pubblicata in questa sessione di editing ──
    if (existingAppId) {
      const { data: existingApp, error: lookupError } = await supabase
        .from('apps')
        .select('id, tenant_id, slug')
        .eq('id', existingAppId)
        .single();

      if (lookupError || !existingApp) {
        return NextResponse.json({ success: false, error: 'App non trovata' }, { status: 404 });
      }
      if (existingApp.tenant_id !== tenantId) {
        return NextResponse.json({ success: false, error: 'Non autorizzato per questa app' }, { status: 403 });
      }

      const { error: updateError } = await supabase
        .from('apps')
        .update({ name: appName, config: configToSave, updated_at: new Date().toISOString() })
        .eq('id', existingApp.id);

      if (updateError) {
        console.error('[creator/publish] update error:', updateError);
        return NextResponse.json({ success: false, error: 'Errore salvataggio: ' + updateError.message, code: 'DB_ERROR' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        data: {
          appId: existingApp.id,
          slug: existingApp.slug,
          url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${existingApp.slug}`,
          updated: true,
        },
      });
    }

    // ─── Prima pubblicazione: consuma uno slot, come /api/creator/create ───────
    const { allowed, reason, tenant } = await canCreateApp(supabase, tenantId, user.id);
    if (!allowed) {
      if (reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      return NextResponse.json({ success: false, error: reason || 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
    }

    const slug = generateCreatorSlug(appName, blueprint.sector);
    const clientPassword = generateClientPassword();
    const tenantEmail = user.email || `tenant-${user.id.slice(0, 8)}@zeusx.app`;
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: app, error: appError } = await supabase
      .from('apps')
      .insert({
        tenant_id: tenantId,
        name: appName,
        config: configToSave,
        slug,
        is_active: true,
        status: 'trial',
        trial_ends_at: trialEndsAt,
        client_active: true,
        client_email: blueprint.businessConfig.email || tenantEmail,
        client_password: clientPassword, // fallback legacy, vedi nota in testa al file
        auth_mode: 'legacy',
        client_price: ZEUSX_MINIMUM_FEE_EUR,
        client_subscription_price: ZEUSX_MINIMUM_FEE_EUR,
      })
      .select('id, name, slug')
      .single();

    if (appError || !app) {
      console.error('[creator/publish] insert error:', appError);
      return NextResponse.json({ success: false, error: 'Errore pubblicazione: ' + (appError?.message || 'sconosciuto'), code: 'DB_ERROR' }, { status: 500 });
    }

    // Credenziali nella tabella dedicata, mai esposta alla Data API pubblica
    // (vedi 20260808000004_app_credentials_table.sql).
    const { error: credError } = await supabase
      .from('app_credentials')
      .upsert({ app_id: app.id, client_password: clientPassword }, { onConflict: 'app_id' });
    if (credError) {
      console.error('[creator/publish] app_credentials upsert error:', credError);
      // Non blocca la pubblicazione: apps.client_password resta come fallback
      // funzionante (letto da getClientCredentials lato backend/route login).
    }

    // Incrementa il contatore permanente di app create, stesso meccanismo di
    // /api/creator/create e frontend/app/api/apps/route.ts.
    await supabase
      .from('tenants')
      .update({ total_apps_created: (tenant?.total_apps_created || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    return NextResponse.json({
      success: true,
      data: {
        appId: app.id,
        slug: app.slug,
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${app.slug}`,
        clientEmail: blueprint.businessConfig.email || tenantEmail,
        clientPassword,
        updated: false,
      },
    });
  } catch (err) {
    console.error('[creator/publish] error:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
