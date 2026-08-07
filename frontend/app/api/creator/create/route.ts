// ─── Creator AI Create API Route (Next.js App Router) ──────────────────────────────
// Persiste lo schema già generato e mostrato in anteprima da /api/creator/generate
// (DynamicAppPreview). Non richiama l'AI: salva esattamente lo schema confermato
// dall'utente, così l'anteprima e l'app creata coincidono sempre.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { sanitizeBlueprint } from '@/src/lib/blueprint-schema';
import { ZEUSX_MINIMUM_FEE_EUR } from '@/lib/pricing';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  generateCreatorSlug,
  toViewerTables,
  CREATOR_ADMIN_USER_ID,
  getTenantWhiteLabel,
} from '@/src/lib/creator-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// ─── POST /api/creator/create ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // Vedi stesso fix in api/creator/publish/route.ts: JSON malformato deve
    // essere un 400, non finire nel catch generico come 500 INTERNAL_ERROR.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body della richiesta non è JSON valido', code: 'INVALID_JSON' }, { status: 400 });
    }
    const { schema: rawSchema } = body;

    if (!rawSchema || typeof rawSchema !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'schema è richiesto',
        code: 'MISSING_INPUT'
      }, { status: 400 });
    }

    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);

    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'Utente non autenticato',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    // Ri-verifica gli slot al momento della conferma (difesa contro il caso in
    // cui siano stati consumati da un'altra tab/richiesta tra l'anteprima e
    // la conferma).
    const tenantId = await getOrCreateTenant(supabase, user, token);
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
      return NextResponse.json({
        success: false,
        error: reason || 'Errore controllo limite app',
        code: 'SLOTS_CHECK_ERROR',
      }, { status: 500 });
    }

    // Consumo atomico dello slot: canCreateApp() sopra è solo un pre-check
    // (SELECT poi confronto in memoria) per un errore rapido in UI, ma non
    // chiude la finestra di race tra richieste concorrenti sullo stesso
    // tenant — vedi increment_tenant_app_count (migration
    // 20260808000005_atomic_tenant_slot_increment.sql) per i dettagli. Questo
    // è il vero cancello: se non ottiene una riga, lo slot non è più
    // disponibile (consumato nel frattempo da un'altra richiesta) e l'app
    // NON viene creata.
    if (user.id !== CREATOR_ADMIN_USER_ID) {
      // Cast: la RPC non è ancora nei tipi generati (supabase gen types),
      // richiede l'applicazione della migration 20260808000005 al DB remoto.
      const { data: slotResult, error: slotError } = await supabase.rpc('increment_tenant_app_count' as any, {
        p_tenant_id: tenantId,
      }) as { data: unknown[] | null; error: any };
      if (slotError && slotError.code !== 'PGRST202' && slotError.code !== '42883') {
        // Errore reale (non "funzione non ancora deployata"): blocca la creazione.
        console.error('[Creator] increment_tenant_app_count error:', slotError);
        return NextResponse.json({
          success: false,
          error: 'Errore controllo limite app',
          code: 'SLOTS_CHECK_ERROR',
        }, { status: 500 });
      }
      if (slotError) {
        // PGRST202/42883 = la migration 20260808000005 non è ancora stata
        // applicata al DB remoto: fallback al vecchio comportamento
        // (non atomico, stessa race condition di prima) invece di rompere la
        // creazione app per tutti finché la migration non viene deployata.
        console.warn('[Creator] increment_tenant_app_count non disponibile, fallback non atomico:', slotError.message);
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
          .update({ total_apps_created: (tenant.total_apps_created || 0) + 1 })
          .eq('id', tenantId);
      } else if (!slotResult || slotResult.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
    }

    // Non fidarsi ciecamente del JSON ricevuto dal client (è lo stesso schema
    // che gli abbiamo restituito in anteprima, ma potrebbe essere stato
    // manomesso): ri-sanitizza prima di salvarlo.
    const blueprint = sanitizeBlueprint(rawSchema);
    if (!blueprint) {
      return NextResponse.json({
        success: false,
        error: 'Lo schema fornito non è valido',
        code: 'INVALID_SCHEMA'
      }, { status: 400 });
    }

    const schema = {
      ...blueprint,
      schema: { tables: toViewerTables(blueprint.schema.tables) },
    };

    // White label reseller ("Brandizza la tua app", piano Business): stesso
    // meccanismo di /api/creator/publish, qui solo per la prima creazione —
    // questa route non gestisce ripubblicazioni di un'app esistente.
    const whiteLabel = await getTenantWhiteLabel(supabase, tenantId);
    if (whiteLabel) {
      (schema as { branding?: typeof whiteLabel }).branding = whiteLabel;
    }

    const slug = generateCreatorSlug(schema.appName || 'app-creator', blueprint.sector);
    const tenantEmail = user.email || `tenant-${user.id.slice(0, 8)}@zeusx.app`;

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    // auth_mode:'supabase' -> flusso Landing/Login/Register/Dashboard con
    // Supabase Auth reale (vedi /a/[slug]/register): niente password in chiaro,
    // il cliente sceglie lui la propria password al primo accesso, vincolato
    // a client_email.
    const { data: app, error: appError } = await supabase
      .from('apps')
      .insert({
        tenant_id: tenantId,
        name: schema.appName || 'App Creator',
        config: schema,
        slug: slug,
        is_active: true,
        status: 'trial',
        trial_ends_at: trialEndsAt.toISOString(),
        client_active: true,
        client_email: tenantEmail,
        auth_mode: 'supabase',
        client_price: ZEUSX_MINIMUM_FEE_EUR,
        client_subscription_price: ZEUSX_MINIMUM_FEE_EUR,
      })
      .select('id, name, slug, status, trial_ends_at, client_email, auth_mode, client_price')
      .single();

    if (appError) {
      console.error('[Creator] App insert error:', appError);
      return NextResponse.json({
        success: false,
        error: 'Errore salvataggio app: ' + appError.message,
        code: 'DB_ERROR'
      }, { status: 500 });
    }

    // Il contatore è già stato incrementato atomicamente sopra, prima
    // dell'insert (increment_tenant_app_count), quindi non c'è più nulla da
    // fare qui.

    return NextResponse.json({
      success: true,
      data: {
        projectId: app.id,
        schema: schema,
        app: app,
      }
    });

  } catch (err) {
    console.error('[creator/create] error:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}
