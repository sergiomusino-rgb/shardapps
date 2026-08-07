import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sanitizeBlueprint, normalizeSector } from '@/src/lib/blueprint-schema';
import type { Database } from '@/types/database';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

function getServiceSupabase() {
  return createClient<Database>(supabaseUrl, serviceRoleKey);
}

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { user: null, token: null };

  const supabase = createClient<Database>(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { user: null, token: null };
  return { user, token };
}

async function getOrCreateTenant(supabase: any, user: { id: string; email?: string }, accessToken?: string | null) {
  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1) as any;

  if (membershipError) {
    console.error('[getOrCreateTenant] membership error:', membershipError);
  }

  if (memberships?.[0]?.tenant_id) return memberships[0].tenant_id;

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      owner_id: user.id,
      name: user.email ? `Tenant di ${user.email}` : 'Tenant personale',
      slug: `tenant-${user.id.slice(0, 8)}`,
      plan: 'free',
      app_limit: 0,
      total_apps_created: 0,
    })
    .select('id')
    .single() as any;

  if (tenantError || !tenant) {
    throw new Error('Errore creazione tenant');
  }

  await supabase.from('tenant_members').insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: 'owner',
  } as any);

  // Comandi AI è un'app omaggio inclusa di default in ogni tenant (non
  // consuma slot, vedi comandi-provisioning.ts). Best-effort, solo al
  // momento della creazione del tenant: un fallimento qui non deve mai
  // impedire la creazione dell'app che l'utente ha effettivamente richiesto.
  if (accessToken) {
    try {
      const result = await provisionComandiAppAction({ accessToken });
      if (!result.success) {
        console.error('[getOrCreateTenant] Provisioning Comandi AI non riuscito:', result.error);
      }
    } catch (err) {
      console.error('[getOrCreateTenant] Errore provisioning Comandi AI:', err);
    }
  }

  return tenant.id;
}

const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

async function canCreateApp(supabase: any, tenantId: string, userId?: string): Promise<{ allowed: boolean; reason?: string; slotsAvailable?: number; tenant?: any }> {
  // Admin: app illimitate
  if (userId === ADMIN_USER_ID) {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('plan, app_limit, total_apps_created')
      .eq('id', tenantId)
      .single() as any;
    if (tenantError || !tenant) {
      // Crea tenant se non esiste
      const { data: newTenant } = await supabase
        .from('tenants')
        .insert({
          owner_id: userId,
          name: 'Admin Tenant',
          slug: `admin-${userId.slice(0, 8)}`,
          plan: 'free',
          app_limit: 0,
          total_apps_created: 0,
        })
        .select('plan, app_limit, total_apps_created')
        .single() as any;
      console.log('[canCreateApp] admin tenant created:', newTenant);
      return { allowed: true, slotsAvailable: Infinity, tenant: newTenant };
    }
    return { allowed: true, slotsAvailable: Infinity, tenant };
  }

  console.log('[canCreateApp] tenantId:', tenantId);

  // Conta app totali create (incluso quelle cancellate, lo slot non si libera mai)
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('plan, app_limit, total_apps_created')
    .eq('id', tenantId)
    .single() as any;

  console.log('[canCreateApp] tenant:', tenant, 'error:', tenantError);

    if (tenantError || !tenant) {
      return { allowed: false, reason: 'Tenant non trovato' };
    }

    const planLimits: Record<string, number> = {
      free: 0,
      starter: 1,
      pro: 5,
      business: 100,
    };

    const appLimit = tenant.app_limit ?? planLimits[tenant.plan] ?? 1;
    const totalCreated = tenant.total_apps_created || 0;
    const slotsAvailable = appLimit - totalCreated;

  if (slotsAvailable <= 0) {
    return { allowed: false, reason: 'SlotsExhausted', slotsAvailable: 0, tenant };
  }

  return { allowed: true, slotsAvailable, tenant };
}

function generateSlug(name: string, sector: string): string {
  const base = `${sector}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${base}-${suffix}`;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function POST(req: Request) {
  try {
    const { user, token } = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { sector, prompt, logo, name: userAppName } = body;

    if (!sector || typeof sector !== 'string') {
      return NextResponse.json({ error: 'Settore richiesto' }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const tenantId = await getOrCreateTenant(supabase, user, token);

    // Controlla limite 5 app
    const { allowed, reason, tenant } = await canCreateApp(supabase, tenantId, user.id);
    console.log('[API /apps] canCreateApp:', allowed, reason);

    if (!allowed) {
      if (reason === 'SlotsExhausted') {
        return NextResponse.json(
          { error: 'SlotsExhausted', message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.', redirectTo: '/pricing' },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: reason || 'Errore controllo limite app' }, { status: 500 });
    }

    // Genera blueprint dal backend. L'endpoint richiede autenticazione (vedi
    // requireAuth in backend/server.js): questa è una chiamata server-to-server
    // per un utente già autenticato sopra in questo stesso handler, quindi si
    // usa il BACKEND_SERVICE_TOKEN condiviso invece di re-inoltrare il JWT.
    const blueprintRes = await fetch(`${backendUrl}/api/generate-app`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BACKEND_SERVICE_TOKEN}`,
        'X-User-ID': user.id,
        'X-User-Email': user.email || '',
      },
      body: JSON.stringify({ sector, prompt, lang: 'it' }),
    });

    if (!blueprintRes.ok) {
      const err = await blueprintRes.json().catch(() => ({}));
      return NextResponse.json({ error: err.error || 'Errore generazione blueprint' }, { status: 502 });
    }

    const rawBlueprint = await blueprintRes.json();
    console.log('[API /apps] Raw blueprint from backend:', JSON.stringify(rawBlueprint).slice(0, 500));
    
    const blueprintPayload = rawBlueprint.blueprint || rawBlueprint;
    blueprintPayload.sector = normalizeSector(sector);
    if (logo) blueprintPayload.logo = logo;
    
    const blueprint = sanitizeBlueprint(blueprintPayload);
    if (!blueprint) {
      return NextResponse.json({ error: 'Impossibile parsare il blueprint generato' }, { status: 500 });
    }
    console.log('[API /apps] Sanitized blueprint:', `${blueprint.schema?.tables?.length || 0} tabelle`);

    // Salva o recupera blueprint
    const normalizedSector = blueprint.sector;
    const { data: existingBlueprint } = await supabase
      .from('blueprints')
      .select('id')
      .eq('sector', normalizedSector)
      .single() as any;

    let blueprintId = existingBlueprint?.id;
     if (!blueprintId) {
       const { data: newBlueprint, error: blueprintError } = await supabase
         .from('blueprints')
         .insert({
           sector: normalizedSector,
           display_name: blueprint.appName,
           description: blueprint.description || '',
           schema: blueprint.schema,
           ui_config: blueprint.ui,
         } as any)
         .select('id')
         .single() as any;

      if (blueprintError || !newBlueprint) {
        console.error('[API /apps] blueprint insert error:', blueprintError);
        return NextResponse.json({ error: 'Errore salvataggio blueprint' }, { status: 500 });
      }
      blueprintId = newBlueprint.id;
    }

    // Calcola trial 30 giorni e scadenza cliente
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Genera slug e password cliente (usa nome utente se fornito, altrimenti blueprint)
    const finalName = userAppName || blueprint.appName;
    const slug = generateSlug(finalName, sector);
    const clientPassword = generatePassword();

     // Consumo atomico dello slot: canCreateApp() sopra è solo un pre-check
     // (SELECT poi confronto in memoria) per un errore rapido, ma non chiude
     // la finestra di race tra richieste concorrenti sullo stesso tenant —
     // vedi increment_tenant_app_count (migration
     // 20260808000005_atomic_tenant_slot_increment.sql). Questo è il vero
     // cancello, subito prima dell'insert: se non ottiene una riga lo slot è
     // già stato consumato da un'altra richiesta e l'app NON viene creata.
     if (user.id !== ADMIN_USER_ID) {
       // Cast: la RPC non è ancora nei tipi generati (supabase gen types),
       // richiede l'applicazione della migration 20260808000005 al DB remoto.
       const { data: slotResult, error: slotError } = await supabase.rpc('increment_tenant_app_count' as any, {
         p_tenant_id: tenantId,
       }) as { data: unknown[] | null; error: any };
       if (slotError && slotError.code !== 'PGRST202' && slotError.code !== '42883') {
         // Errore reale (non "funzione non ancora deployata"): blocca la creazione.
         console.error('[API /apps] increment_tenant_app_count error:', slotError);
         return NextResponse.json({ error: 'Errore controllo limite app' }, { status: 500 });
       }
       if (slotError) {
         // PGRST202/42883 = la migration 20260808000005 non è ancora stata
         // applicata al DB remoto: fallback al vecchio comportamento (non
         // atomico, stessa race condition di prima) invece di rompere la
         // creazione app per tutti finché la migration non viene deployata.
         console.warn('[API /apps] increment_tenant_app_count non disponibile, fallback non atomico:', slotError.message);
         if (!tenant || (tenant.total_apps_created ?? 0) >= (tenant.app_limit ?? 1)) {
           return NextResponse.json(
             { error: 'SlotsExhausted', message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.', redirectTo: '/pricing' },
             { status: 403 }
           );
         }
         await (supabase.from('tenants') as any)
           .update({ total_apps_created: (tenant.total_apps_created || 0) + 1 })
           .eq('id', tenantId);
       } else if (!slotResult || slotResult.length === 0) {
         return NextResponse.json(
           { error: 'SlotsExhausted', message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.', redirectTo: '/pricing' },
           { status: 403 }
         );
       }
     }

     // Salva app
     const { data: app, error: appError } = await supabase
       .from('apps')
       .insert({
         tenant_id: tenantId,
         blueprint_id: blueprintId,
         name: finalName,
         config: blueprint,
         trial_ends_at: trialEndsAt.toISOString(),
         expires_at: expiresAt.toISOString(),
         slug,
         client_password: clientPassword,
         client_email: user.email, // Email di default dell'utente ShardApps
         client_active: true,
         expiry_warning_sent: false,
         is_active: true,
         status: 'trial', // Stato iniziale: trial
       } as any)
       .select('id, name, trial_ends_at, expires_at, slug, client_password, client_email, status')
       .single() as any;

    if (appError || !app) {
      console.error('[API /apps] app insert error:', appError);
      return NextResponse.json({ error: 'Errore salvataggio app' }, { status: 500 });
    }

    // Registra l'app nella app_registry per la Management Console
    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}`;
    const { error: registryError } = await supabase
      .from('app_registry')
      .insert({
        reseller_id: user.id,
        app_name: finalName,
        app_url: appUrl,
        status: 'active',
        monthly_fee: 0.00,
        zeusx_share: 0.00,
      } as any);

    if (registryError) {
      console.error('[API /apps] app_registry insert error:', registryError);
      // Non bloccare la creazione app se fallisce l'aggiornamento registry
    }

     // Il contatore è già stato incrementato atomicamente sopra, prima
     // dell'insert (increment_tenant_app_count), quindi non c'è più nulla da
     // fare qui.

    // Incrementa fee mensile per la nuova app
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';
      const token = process.env.BACKEND_SERVICE_TOKEN;
      
      await fetch(`${backendUrl}/api/update-app-fee`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-User-ID': user.id,
          'X-User-Email': user.email || '',
        },
        body: JSON.stringify({ tenantId, action: 'increment' }),
      });
    } catch (err) {
      console.error('[API /apps] errore aggiornamento fee:', err);
      // Non bloccare la creazione app se fallisce l'aggiornamento fee
    }

    return NextResponse.json({ app, blueprint });
  } catch (err) {
    console.error('[API /apps] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Errore interno' },
      { status: 500 }
    );
  }
}