import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

function getServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Supabase service role env vars missing');
  }
  return createClient<Database>(url, key);
}

export interface TenantStatus {
  tenant_id: string;
  has_active_subscription: boolean;
  any_trial_active: boolean;
  blocked: boolean;
}

export async function getUserTenantsStatus(userId: string): Promise<TenantStatus[]> {
  const supabase = getServiceSupabase();

  // Sostituisce la RPC `check_user_tenant_status`, mai applicata al DB remoto
  // (ogni chiamata falliva sempre, quindi /api/billing era completamente
  // rotto in produzione): stessa logica calcolata direttamente dalle tabelle
  // esistenti (tenant_members, subscriptions, apps) invece di una funzione
  // Postgres inesistente.
  const { data: memberships, error: membershipsError } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId);

  if (membershipsError) {
    console.error('getUserTenantsStatus error:', membershipsError);
    throw new Error('Errore nel controllo dello stato tenant');
  }

  const tenantIds = [...new Set((memberships || []).map((m) => m.tenant_id))];
  if (tenantIds.length === 0) return [];

  const [{ data: subscriptions }, { data: apps }] = await Promise.all([
    supabase.from('subscriptions').select('tenant_id, status').in('tenant_id', tenantIds),
    supabase.from('apps').select('tenant_id, trial_ends_at').in('tenant_id', tenantIds),
  ]);

  const now = Date.now();
  return tenantIds.map((tenant_id) => {
    const subscription = subscriptions?.find((s) => s.tenant_id === tenant_id);
    const has_active_subscription = subscription?.status === 'active' || subscription?.status === 'trialing';
    const any_trial_active = (apps || []).some(
      (a) => a.tenant_id === tenant_id && a.trial_ends_at && new Date(a.trial_ends_at).getTime() > now
    );
    return {
      tenant_id,
      has_active_subscription,
      any_trial_active,
      blocked: !has_active_subscription && !any_trial_active,
    };
  });
}

export async function ensureTenantAccess(userId: string, tenantId?: string): Promise<{ tenantId: string; status: TenantStatus }> {
  const statuses = await getUserTenantsStatus(userId);

  if (!statuses || statuses.length === 0) {
    throw new Error('NO_TENANT');
  }

  const status = tenantId
    ? statuses.find((s) => s.tenant_id === tenantId)
    : statuses[0];

  if (!status) {
    throw new Error('TENANT_NOT_FOUND');
  }

  if (status.blocked) {
    throw new Error('TENANT_BLOCKED');
  }

  return { tenantId: status.tenant_id, status };
}

export async function getTenantAppsCount(tenantId: string): Promise<number> {
  const supabase = getServiceSupabase();
  const { count, error } = await supabase
    .from('apps')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('getTenantAppsCount error:', error);
    throw new Error('Errore nel conteggio delle app');
  }

  return count || 0;
}

// Pre-check non atomico (va bene per un'anteprima/UX rapida): il vero
// cancello che chiude la race condition sulla creazione app è la RPC
// increment_tenant_app_count, chiamata subito prima dell'insert in
// app/api/creator/create/route.ts e app/api/apps/route.ts.
export async function canCreateApp(tenantId: string): Promise<{ allowed: boolean; reason?: string }> {
  const supabase = getServiceSupabase();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('app_limit, total_apps_created')
    .eq('id', tenantId)
    .single();

  if (error || !tenant) {
    console.error('canCreateApp error:', error);
    return { allowed: false, reason: 'Errore interno' };
  }

  if ((tenant.total_apps_created || 0) >= (tenant.app_limit ?? 1)) {
    return { allowed: false, reason: 'UpgradeToProRequired' };
  }

  return { allowed: true };
}

export async function checkAppAccess(appId: string, userId?: string): Promise<{ accessible: boolean; tenantId?: string }> {
  const supabase = getServiceSupabase();

  const { data: accessibleRows, error: accessError } = await supabase.rpc(
    'is_app_accessible',
    { p_app_id: appId }
  );

  if (accessError) {
    console.error('checkAppAccess RPC error:', accessError);
    return { accessible: false };
  }

  // is_app_accessible restituisce uno scalare boolean, non una tabella di righe
  // (bug pre-esistente: leggeva accessibleRows come se fosse un array di righe).
  const accessible = !!accessibleRows;

  if (!accessible) {
    return { accessible: false };
  }

  const { data: appRows, error: appError } = await supabase
    .from('apps')
    .select('tenant_id')
    .eq('id', appId)
    .single();

  if (appError || !appRows) {
    return { accessible: false };
  }

  const tenantId = appRows.tenant_id;

  if (userId) {
    const { data: memberRows, error: memberError } = await supabase
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();

    if (memberError || !memberRows) {
      return { accessible: false };
    }
  }

  return { accessible: true, tenantId };
}
