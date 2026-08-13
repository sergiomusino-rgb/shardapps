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
import { randomInt } from 'node:crypto';
import type { Database } from '@/types/database';
import { sanitizeSiteBlueprint } from '@/src/lib/site-schema';
import { ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  generateCreatorSlug,
  getAppBaseUrl,
  getTenantWhiteLabel,
  CREATOR_ADMIN_USER_ID,
} from '@/src/lib/creator-server';
import { captureError } from '@/src/lib/error-tracking';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// crypto.randomInt (Fase 6B, audit Fase 6) al posto di Math.random(): è la
// password reale di primo accesso del cliente finale (auth_mode:'legacy').
function generateClientPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars.charAt(randomInt(chars.length))).join('');
}

export async function POST(request: NextRequest) {
  try {
    // Body non-JSON/malformato: senza questo catch dedicato, request.json()
    // rilancia e cade nel catch generico sotto come 500 INTERNAL_ERROR —
    // corretto per un errore nostro, fuorviante per un input malformato del
    // client, che va segnalato come 400.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body della richiesta non è JSON valido', code: 'INVALID_JSON' }, { status: 400 });
    }
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
        .select('id, tenant_id, slug, config')
        .eq('id', existingAppId)
        .single();

      if (lookupError || !existingApp) {
        return NextResponse.json({ success: false, error: 'App non trovata' }, { status: 404 });
      }
      if (existingApp.tenant_id !== tenantId) {
        return NextResponse.json({ success: false, error: 'Non autorizzato per questa app' }, { status: 403 });
      }

      // White label reseller: se l'app ha già un logo custom (impostato qui o
      // da dashboard/projects/[id]) lo mantiene invariato a ogni ripubblicazione
      // — solo le app senza branding proprio ricevono il default del tenant.
      const existingBranding = (existingApp.config as { branding?: { footer_logo_url?: string; footer_label?: string } } | null)?.branding;
      if (!existingBranding?.footer_logo_url) {
        const whiteLabel = await getTenantWhiteLabel(supabase, tenantId);
        if (whiteLabel) {
          (configToSave as { branding?: typeof whiteLabel }).branding = whiteLabel;
        }
      } else {
        (configToSave as { branding?: typeof existingBranding }).branding = existingBranding;
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
          url: `${getAppBaseUrl()}/a/${existingApp.slug}`,
          updated: true,
        },
      });
    }

    // ─── Prima pubblicazione: consuma uno slot, come /api/creator/create ───────
    // Precheck rapido (SELECT + confronto in memoria, NON atomico): serve solo
    // a dare un errore immediato in UI senza spendere la RPC quando il tenant
    // ha già visibilmente esaurito gli slot. Non è il cancello reale — vedi
    // consumo atomico subito sotto.
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

    // Consumo atomico dello slot: stesso identico meccanismo/RPC di
    // /api/creator/create (increment_tenant_app_count, migration
    // 20260808000005_atomic_tenant_slot_increment.sql). Prima di questo fix
    // questa route consumava lo slot con un UPDATE non atomico DOPO l'insert
    // dell'app (nessun cancello reale, solo il precheck sopra) — la stessa
    // race condition tra pubblicazioni concorrenti dello stesso tenant che
    // era già stata chiusa in create/route.ts ma non qui (vedi commento in
    // 20260809000002_fix_increment_tenant_app_count_ambiguous_column.sql, che
    // la segnalava esplicitamente come gap non ancora risolto in questa
    // route). Se la RPC non ottiene una riga, lo slot non è più disponibile
    // (consumato nel frattempo da un'altra richiesta) e l'app NON viene
    // creata: nessuna scrittura su `apps` avviene prima di questo controllo.
    let slotReserved = false;
    if (user.id !== CREATOR_ADMIN_USER_ID) {
      const { data: slotResult, error: slotError } = await supabase.rpc('increment_tenant_app_count' as any, {
        p_tenant_id: tenantId,
      }) as { data: unknown[] | null; error: any };

      if (slotError && slotError.code !== 'PGRST202' && slotError.code !== '42883') {
        // Errore reale (non "funzione non ancora deployata"): blocca la pubblicazione.
        console.error('[creator/publish] increment_tenant_app_count error:', slotError);
        return NextResponse.json({ success: false, error: 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
      }

      if (slotError) {
        // PGRST202/42883 = la migration 20260808000005 non è ancora applicata
        // al DB remoto: fallback al vecchio comportamento non atomico invece
        // di rompere la pubblicazione per tutti finché non viene deployata
        // (stesso fallback di create/route.ts).
        console.warn('[creator/publish] increment_tenant_app_count non disponibile, fallback non atomico:', slotError.message);
        if (!tenant || (tenant.total_apps_created ?? 0) >= (tenant.app_limit ?? 1)) {
          return NextResponse.json({
            success: false,
            error: 'SlotsExhausted',
            message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
            redirectTo: '/pricing',
            code: 'SLOTS_EXHAUSTED',
          }, { status: 403 });
        }
        await supabase
          .from('tenants')
          .update({ total_apps_created: (tenant.total_apps_created || 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', tenantId);
      } else if (!slotResult || slotResult.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      } else {
        slotReserved = true;
      }
    }

    const slug = generateCreatorSlug(appName, blueprint.sector);
    const clientPassword = generateClientPassword();
    const tenantEmail = user.email || `tenant-${user.id.slice(0, 8)}@zeusx.app`;
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fase 3 — auth multi-utente: solo se lo schema lo richiede esplicitamente
    // (authConfig.enabled, vedi site-schema.ts). Default assente/false ->
    // 'legacy', esattamente come prima di questo campo: nessuna app pubblicata
    // finora ha mai avuto authConfig, quindi questo ramo è puramente additivo,
    // non cambia comportamento per nessuno schema già esistente.
    const authMode: 'legacy' | 'rbac' = blueprint.authConfig?.enabled ? 'rbac' : 'legacy';

    // White label reseller: prima pubblicazione, nessun branding esistente da
    // preservare, applica direttamente il default del tenant se presente.
    const whiteLabel = await getTenantWhiteLabel(supabase, tenantId);
    if (whiteLabel) {
      (configToSave as { branding?: typeof whiteLabel }).branding = whiteLabel;
    }

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
        auth_mode: authMode,
        client_price: ZEUSX_MINIMUM_FEE_EUR,
        client_subscription_price: ZEUSX_MINIMUM_FEE_EUR,
      })
      .select('id, name, slug')
      .single();

    if (appError || !app) {
      console.error('[creator/publish] insert error:', appError);
      // Lo slot è già stato consumato atomicamente sopra: se l'insert
      // dell'app fallisce dopo averlo riservato, lo rilasciamo per non
      // "bruciare" uno slot pagato senza che sia mai stata creata un'app.
      // Best-effort (fetch+update, non un'unica operazione atomica): questo è
      // il ramo di errore di un insert che normalmente non fallisce, non il
      // cancello principale — quello resta la RPC sopra. Un fallimento qui
      // resta solo loggato, non deve mascherare l'errore reale già restituito.
      if (slotReserved) {
        try {
          const { data: freshTenant } = await supabase
            .from('tenants')
            .select('total_apps_created')
            .eq('id', tenantId)
            .single();
          if (freshTenant) {
            await supabase
              .from('tenants')
              .update({ total_apps_created: Math.max(0, (freshTenant.total_apps_created || 0) - 1), updated_at: new Date().toISOString() })
              .eq('id', tenantId);
          }
        } catch (rollbackErr) {
          console.error('[creator/publish] slot rollback error:', rollbackErr);
        }
      }
      return NextResponse.json({ success: false, error: 'Errore pubblicazione: ' + (appError?.message || 'sconosciuto'), code: 'DB_ERROR' }, { status: 500 });
    }

    const clientEmail = blueprint.businessConfig.email || tenantEmail;

    if (authMode === 'rbac') {
      // App multi-utente: il titolare diventa il primo utente 'admin' in
      // app_rbac_users (migration 20260812000000) — tabella dedicata,
      // indipendente da app_credentials (che resta il modello "1 password
      // condivisa per app" delle app legacy, vedi nota lì per il perché non
      // sono la stessa tabella). Altri utenti (operator/viewer) si
      // aggiungono in seguito da un'interfaccia di gestione utenti — non
      // ancora costruita in questa fase, vedi riepilogo.
      // Cast 'as any' (stesso pattern già usato altrove nel progetto, es.
      // src/lib/AuthContext.tsx per app_users): app_rbac_users non è ancora
      // nei tipi generati da Supabase (types/database.ts), richiede di
      // rigenerarli dopo l'applicazione della migration 20260812000000 al DB
      // remoto — nessun impatto a runtime, solo sul type-checking.
      const { error: rbacError } = await supabase
        .from('app_rbac_users' as any)
        .insert({
          app_id: app.id,
          tenant_id: tenantId,
          client_email: clientEmail,
          client_password: clientPassword,
          role: 'admin',
        } as any);
      if (rbacError) {
        console.error('[creator/publish] app_rbac_users insert error:', rbacError);
        // Non blocca la pubblicazione (stessa scelta del ramo legacy sotto):
        // l'app è comunque creata, ma senza un utente admin il titolare non
        // potrebbe accedervi — a differenza del ramo legacy non c'è un
        // fallback equivalente da cui il login possa comunque funzionare,
        // quindi qui l'errore va segnalato più esplicitamente nel log.
      }
    } else {
      // Credenziali nella tabella dedicata, mai esposta alla Data API
      // pubblica (vedi 20260808000004_app_credentials_table.sql).
      const { error: credError } = await supabase
        .from('app_credentials')
        .upsert({ app_id: app.id, client_password: clientPassword }, { onConflict: 'app_id' });
      if (credError) {
        console.error('[creator/publish] app_credentials upsert error:', credError);
        // Non blocca la pubblicazione: apps.client_password resta come fallback
        // funzionante (letto da getClientCredentials lato backend/route login).
      }
    }

    // Il contatore slot è già stato incrementato atomicamente sopra
    // (increment_tenant_app_count), prima dell'insert: nessun secondo
    // incremento da fare qui (evita di contare due volte la stessa app).

    return NextResponse.json({
      success: true,
      data: {
        appId: app.id,
        slug: app.slug,
        url: `${getAppBaseUrl()}/a/${app.slug}`,
        clientEmail,
        clientPassword,
        // Presente solo per app rbac: 'admin' è sempre il ruolo del titolare
        // seedato qui sopra. Assente per le app legacy, comportamento
        // invariato per chi legge questa risposta senza aspettarselo.
        ...(authMode === 'rbac' ? { role: 'admin' as const } : {}),
        updated: false,
      },
    });
  } catch (err) {
    captureError('creator.publish', err, { url: request.url });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
