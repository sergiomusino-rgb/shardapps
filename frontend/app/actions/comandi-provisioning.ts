'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const TRIAL_DAYS = 30;
const MONTHLY_PRICE = 25.0;

const ProvisionComandiAppInputSchema = z.object({
  // Stesso principio delle altre Server Action del modulo Comandi: la
  // sessione vive solo in localStorage lato client (l'app non usa
  // createBrowserClient di @supabase/ssr), quindi il token va validato
  // esplicitamente con supabase.auth.getUser(accessToken).
  accessToken: z.string().min(1),
  // false (default): comportamento storico, un'unica istanza omaggio per
  // tenant, idempotente, gratuita, nessuno slot consumato.
  // true: crea SEMPRE una nuova istanza (una copia venduta a un cliente
  // diverso), consuma uno slot del piano come le app Creator/Generator e usa
  // zeusx_fee:25 (meccanismo B, ShardApps trattiene la quota dal pagamento del
  // cliente finale) invece di zeusx_fee:0.
  createNew: z.boolean().optional().default(false),
});

// z.input (non z.infer): createNew ha .default(false), quindi nell'input
// (pre-parse, quello che scrivono i chiamanti) resta opzionale — con z.infer
// (output post-parse) risulterebbe obbligatorio e romperebbe i chiamanti
// storici che passano solo { accessToken }.
export type ProvisionComandiAppInput = z.input<typeof ProvisionComandiAppInputSchema>;

export interface ProvisionComandiAppResult {
  success: boolean;
  appId?: string;
  slug?: string;
  /** Credenziali dell'account "cassa" (vero utente Supabase Auth, membro del
   * tenant) da consegnare a chi userà per prima la cassa vocale. Restituite
   * anche quando l'istanza esisteva già (recupero, non solo alla creazione). */
  posEmail?: string;
  posPassword?: string;
  /** true quando questa chiamata ha collegato product_id/product_version_id
   * a un'istanza gratuita preesistente (Catalog "adoption", vedi
   * catalogLink sotto) invece di crearne una nuova o limitarsi a recuperarla. */
  adopted?: boolean;
  error?: string;
}

/**
 * Estensione additiva (App Catalog & Instance Model — ComandAI come
 * prodotto Catalog): usata SOLO dal provisioning del Catalog
 * (app/api/catalog/products/[productSlug]/provision/route.ts) per collegare
 * product_id/product_version_id all'istanza comandi_ai del tenant — la
 * STESSA istanza gratuita già esistente se presente ("adoption in place",
 * mai una seconda app), oppure alla nuova istanza se il tenant non ne ha
 * ancora una. Omesso (undefined) per ogni altro chiamante esistente
 * (/api/tenants/create, bottone "Attiva" nel Creator, ecc.): il
 * comportamento di questa funzione per loro resta IDENTICO a prima di
 * questa estensione, nessun campo Catalog viene mai scritto.
 */
export interface ComandiCatalogLink {
  productId: string;
  productVersionId: string;
}

const UpdatePosPasswordInputSchema = z.object({
  accessToken: z.string().min(1),
  newPassword: z.string().min(6, 'La password deve contenere almeno 6 caratteri'),
  // Con più istanze Comandi AI per tenant serve specificare quale: se omesso,
  // ricade sulla prima trovata (comportamento storico, corretto finché il
  // tenant ne ha una sola).
  appId: z.string().optional(),
});

export type UpdatePosPasswordInput = z.infer<typeof UpdatePosPasswordInputSchema>;

export interface UpdatePosPasswordResult {
  success: boolean;
  error?: string;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function provisionComandiAppAction(
  input: ProvisionComandiAppInput,
  catalogLink?: ComandiCatalogLink
): Promise<ProvisionComandiAppResult> {
  try {
    const validation = ProvisionComandiAppInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: 'Dati non validi' };
    }
    const { accessToken, createNew } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[provisionComandiAppAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per attivare ComandAI' };
    }

    const { data: membership } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const tenantId = membership?.tenant_id as string | undefined;
    if (!tenantId) {
      return { success: false, error: 'Nessun tenant associato all\'utente. Completa prima la configurazione del tuo account.' };
    }

    // Idempotente SOLO per l'istanza omaggio (createNew:false): se il tenant
    // ha già un'istanza Comandi AI, la restituisce invece di crearne una
    // seconda (evita di bruciare due volte uno slot se l'utente richiama
    // questa action da più punti: /comandi/setup, /dashboard/comandi, il
    // bottone "Attiva" nel Creator). Le credenziali dell'account cassa sono
    // sempre recuperabili qui: questa action usa il service role, quindi non
    // serve passare dall'RPC get_app_client_credentials (pensata per le
    // letture lato client soggette a RLS).
    // Con createNew:true si salta questo lookup: si vuole SEMPRE una nuova
    // istanza (una copia da vendere a un cliente diverso), non recuperare
    // quella già esistente.
    if (!createNew) {
      // Cast (product_id non ancora nei tipi generati da Supabase per
      // `apps`, stesso motivo/pattern già usato in
      // app/api/catalog/products/[productSlug]/provision/route.ts — nessun
      // impatto a runtime).
      const { data: existingApp } = await (supabaseAdmin
        .from('apps') as any)
        .select('id, slug, client_email, client_password, product_id')
        .eq('tenant_id', tenantId)
        .eq('app_type', 'comandi_ai')
        .limit(1)
        .maybeSingle() as {
          data: { id: string; slug: string; client_email: string | null; client_password: string | null; product_id: string | null } | null;
        };

      if (existingApp?.slug) {
        // Catalog "adoption in place" (App Catalog & Instance Model): il
        // chiamante è il provisioning del Catalog e vuole collegare
        // product_id/product_version_id a QUESTA istanza già esistente,
        // mai crearne una seconda. Tre sotto-casi:
        // - già collegata allo stesso prodotto: no-op, idempotente (come il
        //   resto del Catalog per una seconda chiamata a provisioning).
        // - collegata a un prodotto DIVERSO: non deve mai capitare nel
        //   percorso normale (un'istanza comandi_ai ha un solo product_id
        //   possibile, questo), ma se capitasse non si sovrascrive in
        //   silenzio un collegamento esistente — errore esplicito.
        // - non ancora collegata (product_id NULL, il caso atteso per
        //   l'istanza omaggio preesistente): UPDATE mirato, WHERE ripete
        //   anche product_id IS NULL come guardia ottimistica contro una
        //   race con un'altra richiesta di adoption concorrente.
        const existingProductId = existingApp.product_id;
        if (catalogLink && existingProductId && existingProductId !== catalogLink.productId) {
          return {
            success: false,
            error: 'Questa istanza ComandAI risulta già collegata a un altro prodotto del catalogo',
          };
        }
        if (catalogLink && !existingProductId) {
          const { error: adoptError } = await (supabaseAdmin
            .from('apps') as any)
            .update({
              product_id: catalogLink.productId,
              product_version_id: catalogLink.productVersionId,
              subscription_status: 'trialing',
            })
            .eq('id', existingApp.id)
            .is('product_id', null);
          if (adoptError) {
            console.error('[provisionComandiAppAction] Errore adoption Catalog:', adoptError);
            return { success: false, error: 'Errore nel collegamento dell\'istanza al catalogo: ' + adoptError.message };
          }
          return {
            success: true,
            appId: existingApp.id,
            slug: existingApp.slug,
            posEmail: existingApp.client_email || undefined,
            posPassword: existingApp.client_password || undefined,
            adopted: true,
          };
        }

        return {
          success: true,
          appId: existingApp.id,
          slug: existingApp.slug,
          posEmail: existingApp.client_email || undefined,
          posPassword: existingApp.client_password || undefined,
        };
      }
    }

    // Nessun controllo slot per l'istanza omaggio (createNew:false): Comandi
    // AI è inclusa di default in ogni registrazione (vedi auto-provisioning
    // in /api/tenants/create), non un prodotto a pagamento che consuma uno
    // slot del piano. Resta comunque a pagamento (25€/mese) dopo i 30 giorni
    // di trial tramite lo stesso paywall standard (apps.status/trial_ends_at,
    // vedi app/a/[slug]/layout.tsx).
    // Le copie aggiuntive (createNew:true) sono invece un prodotto vero e
    // proprio venduto a un cliente: consumano uno slot come le app
    // Creator/Generator (stesso controllo di generator.ts::generateAppAction).
    if (createNew) {
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('app_limit, total_apps_created')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) {
        return { success: false, error: 'Tenant non trovato' };
      }

      const slotsAvailable = (tenant.app_limit as number) - (tenant.total_apps_created as number);
      if (slotsAvailable <= 0) {
        return { success: false, error: 'Slot esauriti. Aggiorna il tuo piano per creare nuove istanze.' };
      }
    }

    const slug = `comandi-${Date.now().toString(36)}`;
    const productionUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}`;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    // ─── Account "cassa" ────────────────────────────────────────────────────
    // Vero utente Supabase Auth (non un gate a password condivisa storico):
    // serve perché il catalogo/ordini sono protetti da RLS su auth.uid(), non
    // funzionerebbero con una sessione fittizia. Email sintetica sul dominio
    // ShardApps: non deve ricevere posta reale, il reset avviene da dentro l'app
    // (updatePosCredentialsAction), non via email di conferma.
    const posEmail = `pos-${slug}@zeusxapps.com`;
    const posPassword = generatePassword();

    const { data: posUserResult, error: posUserError } = await supabaseAdmin.auth.admin.createUser({
      email: posEmail,
      password: posPassword,
      email_confirm: true,
    });

    if (posUserError || !posUserResult?.user) {
      console.error('[provisionComandiAppAction] Errore creazione account cassa:', posUserError);
      return { success: false, error: 'Errore nella creazione dell\'account di accesso: ' + (posUserError?.message || 'unknown') };
    }

    const posUserId = posUserResult.user.id;

    const { error: posMemberError } = await supabaseAdmin
      .from('tenant_members')
      .insert({ tenant_id: tenantId, user_id: posUserId, role: 'member' });

    if (posMemberError) {
      console.error('[provisionComandiAppAction] Errore membership account cassa:', posMemberError);
      await supabaseAdmin.auth.admin.deleteUser(posUserId);
      return { success: false, error: 'Errore nella configurazione dell\'account di accesso' };
    }

    // Cast (product_id/product_version_id/subscription_status non ancora nei
    // tipi generati da Supabase per `apps`, stesso motivo/pattern già usato
    // in app/api/catalog/products/[productSlug]/provision/route.ts — nessun
    // impatto a runtime, e SOLO quando catalogLink è presente questi tre
    // campi vengono effettivamente scritti, vedi sotto).
    const { data: newApp, error: appError } = await (supabaseAdmin
      .from('apps') as any)
      .insert({
        name: 'ComandAI',
        slug,
        tenant_id: tenantId,
        app_type: 'comandi_ai',
        auth_mode: 'legacy',
        client_email: posEmail,
        client_password: posPassword,
        initial_password: posPassword,
        client_active: true,
        is_active: true,
        status: 'trial',
        trial_start: now.toISOString(),
        trial_end: trialEnd.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        client_price: MONTHLY_PRICE,
        zeusx_fee: createNew ? MONTHLY_PRICE : 0,
        production_url: productionUrl,
        // Collegamento al Catalog SOLO se questa chiamata viene dal
        // provisioning Catalog (catalogLink presente): per ogni altro
        // chiamante (auto-provisioning gratuito, createNew:true) questi tre
        // campi restano assenti/ai default di schema, comportamento
        // invariato rispetto a prima di questa estensione.
        ...(catalogLink
          ? {
              product_id: catalogLink.productId,
              product_version_id: catalogLink.productVersionId,
              subscription_status: 'trialing',
            }
          : {}),
        config: {
          appType: 'comandi_ai',
          appName: 'ComandAI',
          sector: 'comandi',
          description: 'Cassa vocale AI per ristorazione e commercio',
          is_published: true,
          posUserId,
        },
      })
      .select('id')
      .single();

    if (appError || !newApp) {
      console.error('[provisionComandiAppAction] Errore creazione app:', appError);
      await supabaseAdmin.auth.admin.deleteUser(posUserId);
      return { success: false, error: 'Errore nella creazione dell\'istanza: ' + (appError?.message || 'unknown') };
    }

    // L'istanza omaggio (createNew:false) non consuma uno slot, quindi non
    // incrementa total_apps_created — a differenza di generateAppAction. Le
    // copie vendute a un cliente (createNew:true) invece sì, stesso
    // contatore usato per le app Creator/Generator (i slot sono condivisi
    // fra tutti i tipi di app del piano).
    if (createNew) {
      const { data: tenantData, error: tenantCountError } = await supabaseAdmin
        .from('tenants')
        .select('total_apps_created')
        .eq('id', tenantId)
        .single();

      if (!tenantCountError && tenantData) {
        await supabaseAdmin
          .from('tenants')
          .update({ total_apps_created: (tenantData.total_apps_created as number || 0) + 1 })
          .eq('id', tenantId);
      }
    }

    // app_definitions: schema vuoto, la console Comandi non usa il motore a
    // tabelle dinamiche, ma la riga è comunque attesa dal resto della
    // piattaforma per ogni app in `apps` (stesso pattern di generateAppAction).
    const { error: definitionError } = await supabaseAdmin
      .from('app_definitions')
      .upsert(
        {
          app_id: newApp.id,
          tenant_id: tenantId,
          schema: { tables: [] },
          ui_config: {},
          is_published: true,
        },
        { onConflict: 'app_id' }
      );

    if (definitionError) {
      console.error('[provisionComandiAppAction] Errore creazione app_definitions:', definitionError);
      await supabaseAdmin.from('apps').delete().eq('id', newApp.id);
      await supabaseAdmin.auth.admin.deleteUser(posUserId);
      return { success: false, error: 'Errore nel salvataggio della definizione: ' + definitionError.message };
    }

    // Registro per la Management Console
    const { error: registryError } = await supabaseAdmin.from('app_registry').insert({
      reseller_id: userId,
      app_name: 'ComandAI',
      app_url: productionUrl,
      status: 'active',
      monthly_fee: MONTHLY_PRICE,
      zeusx_share: 0,
    });

    if (registryError) {
      console.error('[provisionComandiAppAction] Errore registrazione app_registry:', registryError);
      // Non bloccante: non deve impedire l'attivazione dell'app
    }

    return { success: true, appId: newApp.id as string, slug, posEmail, posPassword };
  } catch (err) {
    console.error('[provisionComandiAppAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}

// ─── Cambio password account cassa ─────────────────────────────────────────

export async function updatePosCredentialsAction(input: UpdatePosPasswordInput): Promise<UpdatePosPasswordResult> {
  try {
    const validation = UpdatePosPasswordInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
    }
    const { accessToken, newPassword, appId: targetAppId } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[updatePosCredentialsAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login' };
    }

    const { data: membership } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const tenantId = membership?.tenant_id as string | undefined;
    if (!tenantId) {
      return { success: false, error: 'Nessun tenant associato all\'utente' };
    }

    let appQuery = supabaseAdmin
      .from('apps')
      .select('id, config')
      .eq('tenant_id', tenantId)
      .eq('app_type', 'comandi_ai');
    appQuery = targetAppId ? appQuery.eq('id', targetAppId) : appQuery.limit(1);
    const { data: app } = await appQuery.maybeSingle();

    const posUserId = (app?.config as { posUserId?: string } | null)?.posUserId;
    if (!app?.id || !posUserId) {
      return { success: false, error: 'Account di accesso non trovato per questa istanza' };
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(posUserId, {
      password: newPassword,
    });

    if (updateAuthError) {
      console.error('[updatePosCredentialsAction] Errore aggiornamento password:', updateAuthError);
      return { success: false, error: 'Errore nell\'aggiornamento della password' };
    }

    // client_password riflette sempre la password corrente (initial_password
    // resta quella originale generata al provisioning, come per le app legacy).
    await supabaseAdmin.from('apps').update({ client_password: newPassword }).eq('id', app.id);

    return { success: true };
  } catch (err) {
    console.error('[updatePosCredentialsAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
