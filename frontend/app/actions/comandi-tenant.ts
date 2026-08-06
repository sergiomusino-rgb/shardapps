'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Types ────────────────────────────────────────────────────────────────────

const SetupTenantInputSchema = z.object({
  businessName: z.string().trim().min(1, 'Il nome attività è obbligatorio'),
  vatNumber: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  logoUrl: z.string().trim().optional(),
  seedDemoCatalog: z.boolean().optional().default(false),
  // Modulo pagamenti online opzionale Plug & Play (stesso concetto di
  // apps.config.paymentSettings per le app generate, qui su colonne dirette
  // di tenants — vedi 20260809000000_tenants_payment_settings.sql). Nessuna
  // secret key: solo Payment Link pubblico ed eventuale publishable key.
  paymentsEnabled: z.boolean().optional(),
  stripePaymentLink: z.string().trim()
    .refine((v) => v === '' || /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(v), {
      message: 'Il link deve essere un Payment Link Stripe valido (https://buy.stripe.com/...)',
    })
    .optional(),
  stripePublicKey: z.string().trim()
    .refine((v) => v === '' || /^pk_(test|live)_/.test(v), {
      message: 'La chiave pubblica Stripe deve iniziare con pk_test_ o pk_live_',
    })
    .optional(),
  // Stesso principio delle altre Server Action del modulo Comandi
  // (extractVoiceOrderAction/confirmOrderAction): l'app non usa
  // createBrowserClient di @supabase/ssr, la sessione vive solo in
  // localStorage, quindi il token va passato esplicitamente e validato con
  // supabase.auth.getUser(accessToken) invece di leggere i cookie.
  accessToken: z.string().min(1),
});

export type SetupTenantInput = z.infer<typeof SetupTenantInputSchema>;

export interface SetupTenantResult {
  success: boolean;
  tenantId?: string;
  error?: string;
}

// Stesso catalogo demo usato per il seed manuale in fase di test:
// bar/ristorazione, con sinonimi vocali pronti per il riconoscimento fuzzy.
const DEMO_CATALOG_ITEMS = [
  { sku: 'BEV-BIRRA33', name: 'Birra 33cl', description: 'Birra in bottiglia da 33cl', unit_price: 3.5, stock_qty: 240, unit_of_measure: 'pz' },
  { sku: 'BEV-ACQUA150', name: 'Acqua naturale 1.5L', description: 'Acqua naturale in bottiglia PET', unit_price: 0.8, stock_qty: 500, unit_of_measure: 'pz' },
  { sku: 'BEV-COCA33', name: 'Coca Cola 33cl', description: 'Lattina Coca Cola 33cl', unit_price: 1.5, stock_qty: 300, unit_of_measure: 'pz' },
  { sku: 'FOOD-PANE-KG', name: 'Pane fresco', description: 'Pane sfuso al kg', unit_price: 4.2, stock_qty: 50, unit_of_measure: 'kg' },
  { sku: 'FOOD-MOZZ-KG', name: 'Mozzarella di bufala', description: 'Mozzarella fresca al kg', unit_price: 12.9, stock_qty: 20, unit_of_measure: 'kg' },
] as const;

const DEMO_SYNONYMS_BY_SKU: Record<string, string[]> = {
  'BEV-BIRRA33': ['birretta', 'birra piccola'],
  'BEV-ACQUA150': ['bottiglia grande acqua'],
  'BEV-COCA33': ['lattina di coca'],
  'FOOD-PANE-KG': ['pagnotta'],
  'FOOD-MOZZ-KG': ['mozzarella di bufala campana'],
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'azienda';
}

// ─── Server Action ────────────────────────────────────────────────────────────

export async function setupTenantAction(input: SetupTenantInput): Promise<SetupTenantResult> {
  try {
    const validation = SetupTenantInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
    }
    const {
      businessName, vatNumber, address, city, phone, logoUrl, seedDemoCatalog,
      paymentsEnabled, stripePaymentLink, stripePublicKey, accessToken,
    } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[setupTenantAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per completare la configurazione' };
    }

    const companyFields = {
      name: businessName,
      vat_number: vatNumber || null,
      address: address || null,
      city: city || null,
      phone: phone || null,
      ...(logoUrl !== undefined ? { logo_url: logoUrl || null } : {}),
      ...(paymentsEnabled !== undefined ? { payments_enabled: paymentsEnabled } : {}),
      ...(stripePaymentLink !== undefined ? { stripe_payment_link: stripePaymentLink || null } : {}),
      ...(stripePublicKey !== undefined ? { stripe_public_key: stripePublicKey || null } : {}),
    };

    // Un tenant può già esistere per questo utente creato da altri flussi
    // ShardApps (es. Creator AI) che impostano solo owner_id senza riga in
    // tenant_members: verifichiamo entrambi i percorsi per non duplicare.
    let tenantId: string | undefined;
    let callerRole: string | undefined;

    const { data: ownedTenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('owner_id', userId)
      .single();

    if (ownedTenant?.id) {
      tenantId = ownedTenant.id as string;
      callerRole = 'owner'; // owner_id è per definizione il titolare
    } else {
      const { data: membership } = await supabaseAdmin
        .from('tenant_members')
        .select('tenant_id, role')
        .eq('user_id', userId)
        .limit(1)
        .single();
      tenantId = membership?.tenant_id as string | undefined;
      callerRole = (membership as { role?: string } | null)?.role;
    }

    // Questa action usa la service role key (bypassa RLS): il controllo di
    // ruolo va fatto qui esplicitamente, altrimenti un membro 'agent' o
    // 'member' potrebbe modificare i dati aziendali del tenant chiamando
    // direttamente questa Server Action, nonostante l'UI la mostri solo a
    // owner/admin (vedi CompanyTab, tab 'company' esclusa per !isAgent ma
    // MAI ristretta esplicitamente a owner/admin lato server finora).
    if (tenantId && callerRole !== 'owner' && callerRole !== 'admin') {
      return { success: false, error: 'Solo il titolare o un amministratore può modificare i dati aziendali.' };
    }

    if (tenantId) {
      // Cast necessario: 'logo_url' (migrazione 20260808000010) non è
      // ancora presente nel tipo Database generato (stesso scostamento già
      // visto altrove nel modulo, es. catalog_items.category).
      const { error: updateError } = await (supabaseAdmin as any)
        .from('tenants')
        .update(companyFields)
        .eq('id', tenantId);

      if (updateError) {
        console.error('[setupTenantAction] Errore aggiornamento tenant:', updateError);
        return { success: false, error: 'Errore nel salvataggio dei dati aziendali' };
      }
    } else {
      const slug = `${slugify(businessName)}-${Date.now().toString(36)}`;

      // app_limit: 0, come le altre creazioni lazy di tenant nel progetto:
      // Comandi AI non consuma più uno slot (vedi comandi-provisioning.ts),
      // quindi non serve più pre-caricarne uno qui per coprirlo.
      const { data: newTenant, error: tenantError } = await (supabaseAdmin as any)
        .from('tenants')
        .insert({
          owner_id: userId,
          slug,
          plan: 'free',
          app_limit: 0,
          total_apps_created: 0,
          ...companyFields,
        })
        .select('id')
        .single();

      if (tenantError || !newTenant) {
        console.error('[setupTenantAction] Errore creazione tenant:', tenantError);
        return { success: false, error: 'Errore nella creazione del tenant: ' + (tenantError?.message || 'unknown') };
      }

      tenantId = newTenant.id as string;
    }

    // Garantisce la riga di membership anche se il tenant esisteva già da un
    // percorso legacy che non la crea (vedi commento sopra): senza questa
    // riga tutte le Server Action del modulo Comandi restituirebbero "nessun
    // tenant associato" nonostante il tenant esista davvero.
    const { error: memberError } = await supabaseAdmin
      .from('tenant_members')
      .upsert(
        { tenant_id: tenantId, user_id: userId, role: 'owner' },
        { onConflict: 'tenant_id,user_id', ignoreDuplicates: true }
      );

    if (memberError) {
      console.error('[setupTenantAction] Errore creazione membership:', memberError);
    }

    if (seedDemoCatalog) {
      const { count } = await supabaseAdmin
        .from('catalog_items')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (!count || count === 0) {
        const itemsPayload = DEMO_CATALOG_ITEMS.map((item) => ({ ...item, tenant_id: tenantId }));
        const { data: insertedItems, error: itemsError } = await supabaseAdmin
          .from('catalog_items')
          .insert(itemsPayload)
          .select('id, sku');

        if (itemsError) {
          console.error('[setupTenantAction] Errore seed catalogo demo:', itemsError);
        } else if (insertedItems) {
          const synonymsPayload = insertedItems.flatMap((item: { id: string; sku: string }) =>
            (DEMO_SYNONYMS_BY_SKU[item.sku] || []).map((alias) => ({
              tenant_id: tenantId,
              product_id: item.id,
              spoken_alias: alias,
            }))
          );
          if (synonymsPayload.length > 0) {
            const { error: synonymsError } = await supabaseAdmin.from('product_synonyms').insert(synonymsPayload);
            if (synonymsError) {
              console.error('[setupTenantAction] Errore seed sinonimi demo:', synonymsError);
            }
          }
        }
      }
    }

    return { success: true, tenantId };
  } catch (err) {
    console.error('[setupTenantAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
