// ─── Creator AI: helper server condivisi ───────────────────────────────────────
// Usati sia da /api/creator/generate (genera l'anteprima, non salva nulla) sia
// da /api/creator/create (persiste lo schema confermato dall'utente). Estratti
// qui per evitare di duplicare auth/slot-check/slug-gen tra le due route.

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import type { Table } from '@/src/lib/blueprint-schema';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

export const CREATOR_ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

export async function getUserFromToken(supabase: SupabaseClient, token: string) {
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

export async function getOrCreateTenant(
  supabase: SupabaseClient,
  user: { id: string; email?: string },
  accessToken?: string
): Promise<string> {
  const { data: memberships } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1);

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
    .single();

  if (tenantError || !tenant) {
    throw new Error('Errore creazione tenant');
  }

  await supabase.from('tenant_members').insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: 'owner',
  });

  // Comandi AI è un'app omaggio inclusa di default in ogni tenant (non
  // consuma slot, vedi comandi-provisioning.ts). Best-effort: un fallimento
  // qui non deve mai impedire la creazione del tenant, che è il compito
  // primario di questa funzione. Solo al momento della creazione (non ad
  // ogni lookup di un tenant esistente): questa funzione è chiamata da rotte
  // d'azione (generate/create app), non da un endpoint di onboarding
  // dedicato come /api/tenants/create, che invece la richiama sempre.
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

export async function canCreateApp(
  supabase: SupabaseClient,
  tenantId: string,
  userId?: string
): Promise<{ allowed: boolean; reason?: string; tenant?: any }> {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('plan, app_limit, total_apps_created')
    .eq('id', tenantId)
    .single();

  if (tenantError || !tenant) {
    return { allowed: false, reason: 'Tenant non trovato' };
  }

  // Admin: app illimitate
  if (userId === CREATOR_ADMIN_USER_ID) {
    return { allowed: true, tenant };
  }

  const planLimits: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 5,
    business: 100,
  };

  const appLimit = tenant.app_limit ?? planLimits[tenant.plan] ?? 1;
  const totalCreated = tenant.total_apps_created || 0;

  if (appLimit - totalCreated <= 0) {
    return { allowed: false, reason: 'SlotsExhausted', tenant };
  }

  return { allowed: true, tenant };
}

// ─── Consumo atomico di uno slot app (App Catalog STEP 3) ──────────────────
// Estratto da /api/creator/publish (unico chiamante finora) per essere
// riusato tale e quale da /api/catalog/products/[productSlug]/provision:
// "installare un prodotto dal catalogo" deve rispettare lo stesso identico
// meccanismo di slot di una pubblicazione CreatorAI normale, non uno nuovo
// (vedi audit FASE 1 — "riutilizzare il normale meccanismo di creazione
// app", non duplicarlo). Comportamento invariato rispetto a prima di questa
// estrazione: stessa RPC (increment_tenant_app_count, atomica), stesso
// fallback non atomico se la migration non è ancora applicata (PGRST202/
// 42883), stesso bypass per CREATOR_ADMIN_USER_ID, nessun cambio di firma
// esterna per publish/route.ts.
export type SlotReservationResult =
  | { ok: true; reserved: boolean }
  | { ok: false; reason: 'SlotsExhausted' }
  | { ok: false; reason: 'Error'; message: string };

export async function reserveAppSlot(
  supabase: SupabaseClient,
  tenantId: string,
  tenant: { total_apps_created?: number; app_limit?: number } | undefined,
  userId: string
): Promise<SlotReservationResult> {
  if (userId === CREATOR_ADMIN_USER_ID) {
    return { ok: true, reserved: false };
  }

  const { data: slotResult, error: slotError } = await supabase.rpc('increment_tenant_app_count' as any, {
    p_tenant_id: tenantId,
  }) as { data: unknown[] | null; error: any };

  if (slotError && slotError.code !== 'PGRST202' && slotError.code !== '42883') {
    return { ok: false, reason: 'Error', message: slotError.message || 'Errore controllo limite app' };
  }

  if (slotError) {
    // PGRST202/42883 = la migration 20260808000005 non è ancora applicata al
    // DB remoto: fallback non atomico (stessa race condition storica) invece
    // di rompere la creazione app per tutti finché non viene deployata.
    console.warn('[reserveAppSlot] increment_tenant_app_count non disponibile, fallback non atomico:', slotError.message);
    if (!tenant || (tenant.total_apps_created ?? 0) >= (tenant.app_limit ?? 1)) {
      return { ok: false, reason: 'SlotsExhausted' };
    }
    await supabase
      .from('tenants')
      .update({ total_apps_created: (tenant.total_apps_created || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', tenantId);
    return { ok: true, reserved: true };
  }

  if (!slotResult || slotResult.length === 0) {
    return { ok: false, reason: 'SlotsExhausted' };
  }

  return { ok: true, reserved: true };
}

// Rilascia uno slot riservato con reserveAppSlot() quando l'insert dell'app
// che doveva occuparlo fallisce dopo la riserva — mai "bruciare" uno slot
// per un'app mai creata davvero. Best-effort (fetch+update, non atomico
// come la riserva): è il ramo di errore di un insert che normalmente non
// fallisce, non il cancello principale.
export async function releaseAppSlot(supabase: SupabaseClient, tenantId: string): Promise<void> {
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
    console.error('[releaseAppSlot] error:', rollbackErr);
  }
}

// process.env.NEXT_PUBLIC_APP_URL a volte viene valorizzata per errore con
// l'intera riga "NEXT_PUBLIC_APP_URL=https://..." (es. incollata così nel
// pannello env vars della piattaforma di deploy invece del solo valore):
// la spoglia dell'eventuale prefisso "CHIAVE=" prima di usarla per non
// propagare il testo letterale nei link mostrati/aperti dall'utente.
export function getAppBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  const cleaned = raw.replace(/^[A-Z0-9_]+\s*=\s*/, '');
  return (cleaned || 'https://zeusxapps.com').replace(/\/+$/, '');
}

// White label reseller ("Brandizza la tua app", piano Business, vedi
// CreatorBrandingPanel in dashboard/creator/page.tsx e migrazione
// 20260809000001_tenants_white_label_branding.sql): letto qui da
// /api/creator/publish e /api/creator/create per applicare automaticamente
// il logo del reseller a ogni app pubblicata, senza bisogno di rifarlo app
// per app. null se il tenant non è su piano Business o non ha ancora
// caricato un logo — in quel caso l'app usa il branding ShardApps di default.
export async function getTenantWhiteLabel(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ footer_logo_url: string; footer_label: string } | null> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan, white_label_logo_url, white_label_label')
    .eq('id', tenantId)
    .single();

  const t = tenant as { plan?: string; white_label_logo_url?: string | null; white_label_label?: string | null } | null;
  if (!t || t.plan !== 'business' || !t.white_label_logo_url) return null;

  return {
    footer_logo_url: t.white_label_logo_url,
    footer_label: t.white_label_label || '',
  };
}

// Suffisso da crypto.randomBytes (Fase 6B, audit Fase 6): Math.random() non
// è pensato per essere imprevedibile — stesso intervento già fatto per il
// projectId Totalum in Fase 5B.
export function generateCreatorSlug(name: string, sector: string): string {
  const base = `${sector || 'app'}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// Adatta lo shape Zod (blueprint-schema) a quello atteso dal viewer
// (table-definitions.ts / EditTableModal.tsx usano `field.name`, non `field.id`).
export function toViewerTables(tables: Table[]) {
  return tables.map((t) => ({
    name: t.name,
    label: t.label,
    labelPlural: t.labelPlural,
    icon: t.icon,
    fields: t.fields.map((f) => ({
      id: f.id,
      name: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options,
      fixed: false,
      targetTable: f.target,
      targetLabel: f.targetLabel,
    })),
  }));
}
