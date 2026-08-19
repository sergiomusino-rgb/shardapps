'use server';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { cookies } from 'next/headers';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } from '@/src/lib/ai-router';
import { hashPassword } from '@/src/lib/password-hash';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateAppInput {
  prompt: string;
  appName?: string;
  sector?: string;
  userId?: string;
  /**
   * Lingua correntemente attiva nell'interfaccia (es. 'it', 'en', 'fr', 'de', 'es').
   * Proviene dal LanguageContext client-side (frontend/src/lib/LanguageContext.tsx).
   * Campo opzionale: se assente si assume 'it' per retrocompatibilità.
   * Non interferisce con i campi già esistenti richiesti dal backend.
   */
  lang?: string;
}


export interface GenerateAppResult {
  success: boolean;
  appId?: string;
  slug?: string;
  password?: string;
  error?: string;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

// Generazione completa di una nuova app da zero: task "app-generation" ->
// tier "advanced" dell'AI Router centralizzato (src/lib/ai-router.ts).
async function callLLM(systemPrompt: string, tenantId?: string): Promise<string> {
  const { content } = await callAiRouter({
    task: 'app-generation',
    jsonMode: true,
    temperature: 0.7,
    messages: [{ role: 'user', content: systemPrompt }],
    // Pre-Beta Hardening, Blocco 1: senza tenantId nel context, il budget AI
    // non è applicabile a questa chiamata (vedi src/lib/ai-usage.ts) — questo
    // generatore legacy risolve già un tenantId poco più sotto (vedi
    // generateAppAction), qui si limita a inoltrarlo.
    context: tenantId ? { tenantId } : undefined,
  });
  return content;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

// Mappa codice lingua -> nome lingua per il prompt LLM
const LANG_NAMES: Record<string, string> = {
  it: 'italiano',
  en: 'inglese',
  fr: 'francese',
  de: 'tedesco',
  es: 'spagnolo',
};

function buildSystemPrompt(userPrompt: string, appName?: string, sector?: string, lang?: string): string {
  const inferredSector = sector || 'gestione aziendale';
  const inferredAppName = appName || 'Gestionale';
  const languageName = LANG_NAMES[(lang || 'it').toLowerCase()] || LANG_NAMES.it;

  return `Sei l'architetto software di ShardApps. Devi produrre SOLO un oggetto JSON valido, senza testo aggiuntivo, senza markdown, senza spiegazioni.

Il JSON rappresenta un gestionale SaaS per il settore: "${inferredSector}".
${userPrompt ? `Richiesta dell'utente: ${userPrompt}` : ''}

Lingua dei label: ${languageName}.


Schema obbligatorio:
{
  "appName": "${inferredAppName}",
  "sector": "${inferredSector}",
  "description": "Descrizione breve del gestionale",
  "schema": {
    "tables": [
      {
        "name": "snake_case_singolare",
        "label": "Etichetta singolare",
        "labelPlural": "Etichetta plurale",
        "icon": "emoji opzionale",
        "fields": [
          {
            "id": "snake_case",
            "type": "text|number|date|datetime|boolean|email|phone|textarea|select|multiselect|relation|currency|file|image",
            "label": "Etichetta campo",
            "required": true|false,
            "options": ["opzione1", "opzione2"],
            "target": "nome_tabella_target",
            "targetLabel": "campo_label_target"
          }
        ]
      }
    ]
  },
  "ui": {
    "primaryColor": "#6366f1",
    "sidebar": ["name_tabella_1", "name_tabella_2"],
    "dashboardCards": [
      { "type": "count|sum|latest|chart", "table": "name_tabella", "label": "Label", "field": "campo_numerico" }
    ]
  }
}

Regole:
- Genera almeno 2-4 tabelle con relazioni logiche per il settore.
- Usa solo snake_case per name, id, sector.
- I campi relation devono puntare a tabelle esistenti nello schema.
- Non includere campi id, created_at, updated_at: saranno aggiunti automaticamente.
- Colori validi esadecimale a 6 cifre.
- Output SOLO JSON, niente markdown, niente spiegazioni.`;
}

// ─── Server Action ────────────────────────────────────────────────────────────

export async function generateAppAction(input: GenerateAppInput): Promise<GenerateAppResult> {
  try {
    const cookieStore = await cookies();
    
    // @supabase/ssr@0.6.0 (installato) non gestisce correttamente il campo
    // `__InternalSupabase` che `supabase gen types` inietta nei tipi generati
    // recenti: il generico <Database> passato a createServerClient collassa a
    // `never` sulle Row. Il cast verso SupabaseClient<Database> (da
    // @supabase/supabase-js, che gestisce correttamente questo caso) restituisce
    // la stessa istanza runtime con la tipizzazione corretta, senza toccare la
    // versione della dipendenza.

    // Use anon key for auth operations (to read user session from cookies)
    const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Ignora errori in server action read-only
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Ignora errori
          }
        },
      },
    }) as unknown as SupabaseClient<Database>;

    // Use service role key for database writes (bypasses RLS)
    const supabaseAdmin = createServerClient(supabaseUrl, supabaseServiceKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {}
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {}
        },
      },
    }) as unknown as SupabaseClient<Database>;

    // L'userId non viene MAI preso da input.userId: è un campo lato client e
    // questa è una Server Action, quindi chiamabile come un endpoint POST con
    // un payload arbitrario — fidarsi di un userId fornito dal client
    // permetterebbe a chiunque di generare app / consumare slot sul tenant di
    // un'altra vittima passandone semplicemente l'id. L'unica fonte
    // attendibile è la sessione Supabase legata ai cookie della richiesta.
    let userId: string | undefined;
    let userError = null;

    try {
      const userResult = await supabaseAuth.auth.getUser();
      userId = userResult.data.user?.id || undefined;
      userError = userResult.error;

      if (!userId) {
        const sessionResult = await supabaseAuth.auth.getSession();
        userId = sessionResult.data.session?.user?.id || undefined;
        userError = sessionResult.error;
      }
    } catch (err) {
      console.log('[generateAppAction] Auth error:', err);
    }

    console.log('[generateAppAction] UserId:', userId, 'error:', userError);
    
    // Get user's tenant - MUST use userId from client
    let tenantId: string;
    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per creare un\'app' };
    }
    
    // Try to get tenant from membership using userId from client
    const { data: membership } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .single();

    if (membership) {
      tenantId = membership.tenant_id;
      console.log('[generateAppAction] Found tenant from membership:', tenantId);
    } else {
      // Try any membership for this user
      const { data: allMemberships } = await supabaseAdmin
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1);
      
      if (allMemberships && allMemberships.length > 0) {
        tenantId = allMemberships[0].tenant_id;
        console.log('[generateAppAction] Found tenant from any membership:', tenantId);
      } else {
        // NO FALLBACK - fail if no membership found
        console.log('[generateAppAction] No membership found for userId:', userId);
        return { success: false, error: 'Nessun tenant associato all\'utente. Contatta il supporto.' };
      }
    }
    
    if (!tenantId) {
      return { success: false, error: 'Nessun tenant disponibile' };
    }
    
    console.log('[generateAppAction] Using tenantId:', tenantId);

    // ─── CONTROLLO SLOTS ───────────────────────────────────────────────────────────
    // Admin: salta il controllo degli slot
    const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
    if (userId !== ADMIN_USER_ID) {
      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('app_limit, total_apps_created')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) {
        return { success: false, error: 'Tenant non trovato' };
      }

      const slotsAvailable = tenant.app_limit - tenant.total_apps_created;
      if (slotsAvailable <= 0) {
        return { success: false, error: 'Slot esauriti. Aggiorna il tuo piano per creare nuovi gestionali.' };
      }
    }

    // Call LLM to generate schema (lang influenza la lingua dei label generati)
    const systemPrompt = buildSystemPrompt(input.prompt, input.appName, input.sector, input.lang);

    let generatedSchema: Record<string, unknown>;
    try {
      const rawResponse = await callLLM(systemPrompt, tenantId);
      generatedSchema = extractJsonFromAiContent(rawResponse) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof AiRouterConfigError) {
        console.error('[generateAppAction] AI router config error:', err);
        return { success: false, error: 'Servizio AI non configurato correttamente. Contatta il supporto.' };
      }
      if (err instanceof AiRouterError) {
        console.error('[generateAppAction] AI provider error:', err);
        return { success: false, error: err.message };
      }
      console.error('[generateAppAction] JSON parse error:', err);
      return { success: false, error: 'Il modello ha restituito un JSON non valido' };
    }

    // Validate required fields
    const schema = generatedSchema.schema as Record<string, unknown> | undefined;
    const tables = schema?.tables as Array<Record<string, unknown>> | undefined;
    if (!schema || !tables) {
      return { success: false, error: 'Schema non valido: manca il campo schema.tables' };
    }

    // Create app record
    const appName = (generatedSchema.appName as string) || input.appName || 'Nuovo Gestionale';
    const sector = (generatedSchema.sector as string) || input.sector || 'generale';
    const description = (generatedSchema.description as string) || '';

    console.log('[generateAppAction] Creating app:', { appName, sector, tenantId });

    // Generate slug
    const slugBase = appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const slug = `${slugBase}-${Date.now().toString(36)}`;

    // Generate random password
    const clientPassword = Math.random().toString(36).slice(-8);
    // Pre-Beta Hardening, Blocco 6: solo l'hash viene persistito —
    // clientPassword in chiaro resta usato solo per il valore ritornato da
    // questa action (GenerateAppResult.password), l'unico momento legittimo.
    const hashedClientPassword = await hashPassword(clientPassword);

    const { data: newApp, error: appError } = await supabaseAdmin
      .from('apps')
      .insert({
        name: appName,
        slug,
        tenant_id: tenantId,
        client_password: hashedClientPassword,
        client_active: true,
        production_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://shardapps.com'}/a/${slug}`,
        config: {
          schema: generatedSchema.schema,
          ui: generatedSchema.ui || {},
          branding: generatedSchema.ui || {},
          is_published: true,
          appName: appName,
          sector: sector,
          description: description,
          // Lingua attiva al momento della creazione (proveniente da LanguageContext client-side)
          lang: input.lang || 'it',
        } as any, // config è jsonb; generatedSchema è JSON parsato da callLLM (unknown)

      })
      .select('id')
      .single();

    console.log('[generateAppAction] App created:', { newApp, appError });

    if (appError || !newApp) {
      console.error('[generateAppAction] Error creating app:', appError);
      return { success: false, error: 'Errore nella creazione dell\'app: ' + (appError?.message || 'unknown') };
    }

    // Increment total_apps_created counter in tenant
    console.log('[generateAppAction] Incrementing total_apps_created for tenant:', tenantId);
    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('total_apps_created')
      .eq('id', tenantId)
      .single();

    if (!tenantError && tenantData) {
      const newCount = (tenantData.total_apps_created || 0) + 1;
      await supabaseAdmin
        .from('tenants')
        .update({ total_apps_created: newCount })
        .eq('id', tenantId);
      console.log('[generateAppAction] Total apps created updated to:', newCount);
    }

    // Create app_definitions entry (use upsert to handle duplicates)
    console.log('[generateAppAction] Creating app_definitions:', { app_id: newApp.id, tenant_id: tenantId });
    const { error: definitionError } = await supabaseAdmin
      .from('app_definitions')
      .upsert({
        app_id: newApp.id,
        tenant_id: tenantId,
        schema: generatedSchema.schema as any,
        ui_config: (generatedSchema.ui || {}) as any,
        is_published: true,
      }, { onConflict: 'app_id' });

    console.log('[generateAppAction] app_definitions created:', { definitionError });

    if (definitionError) {
      console.error('[generateAppAction] Error creating app_definitions:', definitionError);
      // Rollback: delete the app
      await supabaseAdmin.from('apps').delete().eq('id', newApp.id);
      return { success: false, error: 'Errore nel salvataggio della definizione: ' + (definitionError?.message || 'unknown') };
    }

    // Register app in app_registry for Management Console
    const appUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://shardapps.com'}/a/${slug}`;
    const { error: registryError } = await supabaseAdmin
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
      console.error('[generateAppAction] Error registering app in app_registry:', registryError);
      // Non bloccare la creazione app se fallisce l'aggiornamento registry
    } else {
      console.log('[generateAppAction] app_registry created successfully');
    }

    return {
      success: true,
      appId: newApp.id,
      slug,
      password: clientPassword,
    };
  } catch (err) {
    console.error('[generateAppAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
