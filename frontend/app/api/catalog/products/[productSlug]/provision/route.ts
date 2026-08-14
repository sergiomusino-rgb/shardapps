// ─── Catalog Provisioning API (App Catalog & Instance Model, STEP 3) ───────
// POST /api/catalog/products/[productSlug]/provision
//
// "Installare un prodotto dal catalogo" NON è un secondo sistema di
// creazione app: è lo stesso identico percorso di /api/creator/publish
// ("prima pubblicazione") — stessa risoluzione auth/tenant, stesso consumo
// atomico di slot (reserveAppSlot, src/lib/creator-server.ts), stesso
// shape di riga in `apps`, stesso ramo auth_mode legacy/rbac con lo stesso
// seed app_credentials/app_rbac_users — l'unica differenza è la provenienza
// del blueprint: qui viene dal catalogo (app_product_versions.blueprint),
// mai dal client. Il risultato è una app ShardApps del tutto normale:
// nessun nuovo runtime, nessuna nuova autenticazione, nessuna nuova tabella
// di dati applicativi (vedi audit FASE 1/2 del piano App Catalog).
//
// Contratto (FASE 2 dell'audit):
// - Input dal client: SOLO `productSlug` (URL) ed eventualmente `version`
//   (body, opzionale — se assente, sceglie la versione attiva più recente).
// - Il client NON può fornire: tenant_id, product_id, blueprint,
//   subscription_status, trial_ends_at — tutti risolti/calcolati qui
//   lato server, mai letti dal body per questi campi.

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
  reserveAppSlot,
  releaseAppSlot,
} from '@/src/lib/creator-server';
import { authorizeCatalogProvision } from '@/src/lib/catalog-provision-authorization';
import { captureError } from '@/src/lib/error-tracking';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// ComandAI (App Catalog: prodotto ComandAI-native) NON usa il motore a
// blueprint dinamico (ViewerProFinal) come ogni altro prodotto Catalog: il
// suo runtime è selezionato da apps.app_type='comandi_ai', invariato,
// esistente da prima del Catalog. Questo prodotto richiede quindi un
// percorso di provisioning dedicato (vedi handleComandiAiProvisioning sotto)
// invece del percorso generico blueprint-based di questa route — nessuna
// nuova colonna di schema per distinguerlo, solo questo confronto sullo slug
// (che identifica un prodotto specifico tanto quanto il suo id).
const COMANDI_AI_PRODUCT_SLUG = 'command-ai';

// Stessa identica generazione di /api/creator/publish/route.ts (crypto.randomInt,
// mai Math.random per una password reale di primo accesso).
function generateClientPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars.charAt(randomInt(chars.length))).join('');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ productSlug: string }> }) {
  try {
    const { productSlug } = await params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);

    // Unico input opzionale dal client oltre allo slug nell'URL: la versione
    // (facoltativa). Qualunque altro campo nel body viene ignorato — non
    // letto, non nel tipo, non usato più sotto: non è un "whitelisting" da
    // aggirare, è semplicemente l'unica cosa che questa route legge dal body.
    let body: any = {};
    try { body = await request.json(); } catch { /* body assente o vuoto: va bene, version resta undefined */ }
    const requestedVersion = typeof body?.version === 'string' && body.version.trim() ? body.version.trim() : undefined;

    // Cast (app_products non ancora nei tipi generati da Supabase, stesso
    // motivo/pattern già usato altrove nel progetto per app_rbac_users —
    // richiede di rigenerare types/database.ts dopo la migration
    // 20260815000000, nessun impatto a runtime).
    const { data: product } = await supabase.from('app_products' as any)
      .select('id, slug, name, trial_days, is_active')
      .eq('slug', productSlug)
      .maybeSingle() as { data: { id: string; slug: string; name: string; trial_days: number; is_active: boolean } | null };

    // Versione: se il client ne chiede una specifica, deve esistere per
    // QUESTO prodotto ed essere attiva (mai una versione di un altro
    // prodotto). Se non specificata, sceglie la versione attiva più
    // recente (created_at DESC) — scelta deliberatamente semplice (FASE 4
    // dell'audit): nessuna colonna di ordinamento/"corrente" dedicata in
    // questo step, un catalogo con più versioni attive contemporaneamente
    // per lo stesso prodotto è responsabilità di chi lo gestisce (di norma
    // service_role/admin), non qualcosa che questa route arbitra.
    type ProductVersion = { id: string; product_id: string; version: string; blueprint: unknown; is_active: boolean };
    let version: ProductVersion | null = null;
    if (product) {
      let versionQuery = supabase.from('app_product_versions' as any)
        .select('id, product_id, version, blueprint, is_active')
        .eq('product_id', product.id)
        .eq('is_active', true);
      versionQuery = requestedVersion
        ? versionQuery.eq('version', requestedVersion)
        : versionQuery.order('created_at', { ascending: false }).limit(1);
      const { data: versions } = await versionQuery as { data: ProductVersion[] | null };
      version = versions?.[0] ?? null;
    }

    const decision = authorizeCatalogProvision({ token, user, product, version });
    if (!decision.ok) {
      return NextResponse.json({ success: false, error: decision.error, code: decision.code }, { status: decision.status });
    }
    // authorizeCatalogProvision garantisce già product/version non-null e
    // attivi quando ok:true — questa guardia ridondante stringe il tipo per
    // TypeScript invece di usare asserzioni non-null (`!`) sparse sotto.
    if (!product || !version || !user) {
      return NextResponse.json({ success: false, error: 'Errore interno', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    const tenantId = await getOrCreateTenant(supabase, user, token);

    // ─── ComandAI: percorso di provisioning dedicato ───────────────────────
    // Riusa il runtime/provisioning ComandAI ESISTENTE (comandi-provisioning.ts,
    // invariato per ogni altro chiamante) invece del percorso blueprint
    // generico sotto: nessun blueprint viene mai renderizzato per questo
    // prodotto (app_type='comandi_ai' instrada altrove PRIMA che il blueprint
    // conti, vedi app/a/[slug]/page.tsx). Uscita anticipata dalla route.
    if (product.slug === COMANDI_AI_PRODUCT_SLUG) {
      return handleComandiAiProvisioning({ token, tenantId, product, version });
    }

    // ─── Idempotenza minima (FASE 7 dell'audit) ────────────────────────────
    // Un doppio click su "Attiva" non deve creare una seconda istanza dello
    // stesso prodotto per lo stesso tenant: se ne esiste già una attiva,
    // la restituisce invece di crearne un'altra (e non consuma un secondo
    // slot). Nessun sistema di idempotency-key: la policy è semplicemente
    // "un'istanza attiva per prodotto per tenant", verificabile con una sola
    // query sullo stato già esistente di `apps` — non serve altro per
    // questo step (un tenant che vuole davvero una seconda istanza dello
    // stesso prodotto è un caso non richiesto ora, vedi FASE 11).
    // Cast dell'intera catena (product_id non ancora nei tipi generati,
    // stesso motivo/pattern già usato altrove nel progetto per app_rbac_users).
    const { data: existingInstance } = await supabase.from('apps' as any)
      .select('id, slug, client_email, auth_mode')
      .eq('tenant_id', tenantId)
      .eq('product_id', product.id)
      .eq('is_active', true)
      .maybeSingle();

    if (existingInstance) {
      const existing = existingInstance as any;
      return NextResponse.json({
        success: true,
        data: {
          appId: existing.id,
          slug: existing.slug,
          url: `${getAppBaseUrl()}/a/${existing.slug}`,
          productId: product.id,
          alreadyProvisioned: true,
        },
      });
    }

    // ─── Precheck + consumo atomico dello slot: identico a /api/creator/publish ──
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

    const slotResult = await reserveAppSlot(supabase, tenantId, tenant, user.id);
    if (!slotResult.ok) {
      if (slotResult.reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      console.error('[catalog/provision] reserveAppSlot error:', slotResult.message);
      return NextResponse.json({ success: false, error: 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
    }
    const slotReserved = slotResult.reserved;

    // ─── Blueprint dal catalogo — MAI dal client ───────────────────────────
    // Ri-sanitizzato con lo stesso schema Zod di ogni altro punto
    // d'ingresso del motore (generate/refactor/publish): app_product_versions
    // è scritta solo da service_role, quindi è più fidata di un input
    // utente, ma non fidarsi ciecamente comunque — un blueprint malformato
    // nel catalogo deve fallire qui in modo esplicito, non produrre un'app
    // rotta silenziosamente.
    const blueprint = sanitizeSiteBlueprint(version.blueprint);
    if (!blueprint) {
      if (slotReserved) await releaseAppSlot(supabase, tenantId);
      captureError('catalog.provision', new Error('blueprint di catalogo non valido'), { productId: product.id, productVersionId: version.id });
      return NextResponse.json({ success: false, error: 'Il blueprint di questo prodotto non è valido', code: 'INVALID_PRODUCT_BLUEPRINT' }, { status: 500 });
    }

    const appName = product.name;
    const slug = generateCreatorSlug(appName, blueprint.sector);
    const clientPassword = generateClientPassword();
    const tenantEmail = user.email || `tenant-${user.id.slice(0, 8)}@zeusx.app`;
    const trialDays = product.trial_days ?? 30;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

    // Stessa regola di /api/creator/publish: RBAC solo se il blueprint lo
    // richiede esplicitamente (authConfig.enabled), altrimenti legacy.
    const authMode: 'legacy' | 'rbac' = blueprint.authConfig?.enabled ? 'rbac' : 'legacy';

    const whiteLabel = await getTenantWhiteLabel(supabase, tenantId);
    const configToSave: typeof blueprint & { appName: string; branding?: { footer_logo_url: string; footer_label: string } } = {
      ...blueprint,
      appName,
      ...(whiteLabel ? { branding: whiteLabel } : {}),
    };

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
        client_password: clientPassword,
        auth_mode: authMode,
        client_price: ZEUSX_MINIMUM_FEE_EUR,
        client_subscription_price: ZEUSX_MINIMUM_FEE_EUR,
        // Colonne App Catalog (migration 20260815000000, non ancora nei tipi
        // generati — stesso cast già usato altrove nel progetto per
        // app_rbac_users, nessun impatto a runtime).
        product_id: product.id,
        product_version_id: version.id,
        subscription_status: 'trialing',
      } as any)
      .select('id, name, slug')
      .single();

    if (appError || !app) {
      if (slotReserved) await releaseAppSlot(supabase, tenantId);
      captureError('catalog.provision', appError, { productId: product.id, productVersionId: version.id, tenantId });
      return NextResponse.json({ success: false, error: 'Errore provisioning: ' + (appError?.message || 'sconosciuto'), code: 'DB_ERROR' }, { status: 500 });
    }

    const clientEmail = blueprint.businessConfig.email || tenantEmail;

    if (authMode === 'rbac') {
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
        captureError('catalog.provision', rbacError, { appId: app.id, step: 'app_rbac_users insert' });
      }
    } else {
      const { error: credError } = await supabase
        .from('app_credentials')
        .upsert({ app_id: app.id, client_password: clientPassword }, { onConflict: 'app_id' });
      if (credError) {
        captureError('catalog.provision', credError, { appId: app.id, step: 'app_credentials upsert' });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        appId: app.id,
        slug: app.slug,
        url: `${getAppBaseUrl()}/a/${app.slug}`,
        productId: product.id,
        productVersionId: version.id,
        subscriptionStatus: 'trialing',
        trialEndsAt,
        clientEmail,
        clientPassword,
        ...(authMode === 'rbac' ? { role: 'admin' as const } : {}),
        alreadyProvisioned: false,
      },
    });
  } catch (err) {
    captureError('catalog.provision', err, { url: request.url });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}

// ─── ComandAI: provisioning/adozione dedicati ──────────────────────────────
// Decisione di prodotto (App Catalog: ComandAI): UNA SOLA istanza ComandAI
// per tenant, mai due. Ogni tenant possiede già oggi, di norma, un'istanza
// comandi_ai gratuita creata automaticamente alla registrazione
// (app_type='comandi_ai', product_id NULL — vedi /api/tenants/create). Il
// Catalog non deve MAI crearne una seconda: deve "adottare in place" quella
// esistente (collegare product_id/product_version_id) se c'è, oppure crearne
// una nuova SOLO se il tenant non ne ha ancora nessuna.
//
// Riusa integralmente comandi-provisioning.ts (account cassa, apps,
// app_definitions, app_registry, rollback su errore) tramite il parametro
// catalogLink aggiunto lì: nessuna duplicazione di quella logica qui.
async function handleComandiAiProvisioning({
  token,
  tenantId,
  product,
  version,
}: {
  token: string;
  tenantId: string;
  product: { id: string; slug: string; name: string; trial_days: number; is_active: boolean };
  version: { id: string; product_id: string; version: string; blueprint: unknown; is_active: boolean };
}) {
  try {
    // Ambiguità (FASE 4D dell'audit): un tenant può avere più di un'istanza
    // comandi_ai SOLO tramite il percorso di rivendita esistente
    // (provisionComandiAppAction con createNew:true, pensato per copie da
    // vendere a un cliente finale diverso — non l'istanza gratuita "propria"
    // del tenant). Se càpita, questa route non sceglie arbitrariamente quale
    // collegare al Catalog: si ferma e lo segnala, nessun dato toccato.
    const { data: existingComandiApps, error: lookupError } = await supabase
      .from('apps' as any)
      .select('id, product_id')
      .eq('tenant_id', tenantId)
      .eq('app_type', 'comandi_ai')
      .eq('is_active', true) as { data: Array<{ id: string; product_id: string | null }> | null; error: unknown };

    if (lookupError) {
      captureError('catalog.provision.comandi_ai', lookupError, { tenantId });
      return NextResponse.json({ success: false, error: 'Errore nella verifica delle istanze esistenti', code: 'DB_ERROR' }, { status: 500 });
    }

    const instances = existingComandiApps ?? [];
    if (instances.length > 1) {
      captureError('catalog.provision.comandi_ai', new Error('Più istanze comandi_ai attive per lo stesso tenant'), {
        tenantId,
        appIds: instances.map((a) => a.id),
      });
      return NextResponse.json({
        success: false,
        error: 'Trovate più istanze ComandAI attive per questo tenant: richiede intervento manuale, nessuna collegata automaticamente al catalogo.',
        code: 'AMBIGUOUS_COMANDI_INSTANCES',
      }, { status: 409 });
    }

    // Idempotenza esplicita (oltre a quella già gestita dentro
    // provisionComandiAppAction): se l'unica istanza esistente è GIÀ
    // collegata a questo stesso prodotto, non richiamare nemmeno l'action —
    // stessa policy "un'istanza attiva per prodotto per tenant" del resto
    // del Catalog.
    if (instances.length === 1 && instances[0].product_id === product.id) {
      const { data: app } = await supabase.from('apps' as any)
        .select('id, slug, client_email, client_password')
        .eq('id', instances[0].id)
        .maybeSingle() as { data: { id: string; slug: string; client_email: string | null; client_password: string | null } | null };
      if (!app) {
        return NextResponse.json({ success: false, error: 'Errore interno', code: 'INTERNAL_ERROR' }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: {
          appId: app.id,
          slug: app.slug,
          url: `${getAppBaseUrl()}/a/${app.slug}`,
          productId: product.id,
          productVersionId: version.id,
          subscriptionStatus: 'trialing',
          clientEmail: app.client_email ?? undefined,
          clientPassword: app.client_password ?? undefined,
          alreadyProvisioned: true,
        },
      });
    }

    // Creazione (nessuna istanza) o adozione (istanza esistente con
    // product_id NULL): entrambe delegate a provisionComandiAppAction, che
    // fa già il lookup/rollback necessari — qui si passa solo catalogLink.
    const result = await provisionComandiAppAction(
      { accessToken: token, createNew: false },
      { productId: product.id, productVersionId: version.id }
    );

    if (!result.success || !result.appId || !result.slug) {
      captureError('catalog.provision.comandi_ai', new Error(result.error || 'provisionComandiAppAction fallita'), { tenantId, productId: product.id });
      return NextResponse.json({ success: false, error: result.error || 'Errore nel provisioning di ComandAI', code: 'COMANDI_PROVISION_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        appId: result.appId,
        slug: result.slug,
        url: `${getAppBaseUrl()}/a/${result.slug}`,
        productId: product.id,
        productVersionId: version.id,
        subscriptionStatus: 'trialing',
        clientEmail: result.posEmail,
        clientPassword: result.posPassword,
        alreadyProvisioned: false,
        adopted: !!result.adopted,
      },
    });
  } catch (err) {
    captureError('catalog.provision.comandi_ai', err, { tenantId, productId: product.id });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
