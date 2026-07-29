// ─── Creator AI: helper server condivisi ───────────────────────────────────────
// Usati sia da /api/creator/generate (genera l'anteprima, non salva nulla) sia
// da /api/creator/create (persiste lo schema confermato dall'utente). Estratti
// qui per evitare di duplicare auth/slot-check/slug-gen tra le due route.

import type { SupabaseClient } from '@supabase/supabase-js';
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

export function generateCreatorSlug(name: string, sector: string): string {
  const base = `${sector || 'app'}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).substring(2, 6);
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
