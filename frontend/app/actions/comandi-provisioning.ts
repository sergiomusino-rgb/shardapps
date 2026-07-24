'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Stesso ID già hardcoded in frontend/app/actions/generator.ts: l'admin
// salta il controllo slot anche per il provisioning di Comandi AI.
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

const TRIAL_DAYS = 30;
const MONTHLY_PRICE = 25.0;

const ProvisionComandiAppInputSchema = z.object({
  // Stesso principio delle altre Server Action del modulo Comandi: la
  // sessione vive solo in localStorage lato client (l'app non usa
  // createBrowserClient di @supabase/ssr), quindi il token va validato
  // esplicitamente con supabase.auth.getUser(accessToken).
  accessToken: z.string().min(1),
});

export type ProvisionComandiAppInput = z.infer<typeof ProvisionComandiAppInputSchema>;

export interface ProvisionComandiAppResult {
  success: boolean;
  appId?: string;
  slug?: string;
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
  input: ProvisionComandiAppInput
): Promise<ProvisionComandiAppResult> {
  try {
    const validation = ProvisionComandiAppInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: 'Dati non validi' };
    }
    const { accessToken } = validation.data;

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[provisionComandiAppAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per attivare Comandi AI' };
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

    // ─── Controllo slot ────────────────────────────────────────────────────
    if (userId !== ADMIN_USER_ID) {
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
        return { success: false, error: 'Slot esauriti. Aggiorna il tuo piano per attivare Comandi AI.' };
      }
    }

    const slug = `comandi-${Date.now().toString(36)}`;
    const clientPassword = generatePassword();
    const productionUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}`;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const { data: newApp, error: appError } = await supabaseAdmin
      .from('apps')
      .insert({
        name: 'Comandi AI',
        slug,
        tenant_id: tenantId,
        app_type: 'comandi_ai',
        auth_mode: 'legacy',
        client_password: clientPassword,
        initial_password: clientPassword,
        client_active: true,
        is_active: true,
        status: 'trial',
        trial_start: now.toISOString(),
        trial_end: trialEnd.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        client_price: MONTHLY_PRICE,
        zeusx_fee: 0,
        production_url: productionUrl,
        config: {
          appType: 'comandi_ai',
          appName: 'Comandi AI',
          sector: 'comandi',
          description: 'Cassa vocale AI per ristorazione e commercio',
          is_published: true,
        },
      })
      .select('id')
      .single();

    if (appError || !newApp) {
      console.error('[provisionComandiAppAction] Errore creazione app:', appError);
      return { success: false, error: 'Errore nella creazione dell\'istanza: ' + (appError?.message || 'unknown') };
    }

    // Incrementa il contatore slot del tenant (stesso bookkeeping di generateAppAction)
    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('total_apps_created')
      .eq('id', tenantId)
      .single();

    if (tenantData) {
      await supabaseAdmin
        .from('tenants')
        .update({ total_apps_created: ((tenantData.total_apps_created as number) || 0) + 1 })
        .eq('id', tenantId);
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
      return { success: false, error: 'Errore nel salvataggio della definizione: ' + definitionError.message };
    }

    // Registro per la Management Console
    const { error: registryError } = await supabaseAdmin.from('app_registry').insert({
      reseller_id: userId,
      app_name: 'Comandi AI',
      app_url: productionUrl,
      status: 'active',
      monthly_fee: MONTHLY_PRICE,
      zeusx_share: 0,
    });

    if (registryError) {
      console.error('[provisionComandiAppAction] Errore registrazione app_registry:', registryError);
      // Non bloccante: non deve impedire l'attivazione dell'app
    }

    return { success: true, appId: newApp.id as string, slug };
  } catch (err) {
    console.error('[provisionComandiAppAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
