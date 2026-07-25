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
  // FIXME: la funzione `check_user_tenant_status` non esiste nello schema
  // generato (supabase gen types) dal DB remoto collegato — non è mai stata
  // applicata con una migrazione. Ogni chiamata a questa funzione (quindi
  // /api/billing tramite ensureTenantAccess) sta probabilmente fallendo in
  // produzione. Il cast bypassa solo l'errore di tipo; va creata la funzione
  // remota (o va sostituita questa chiamata con l'equivalente logica diretta).
  const { data, error } = await supabase.rpc('check_user_tenant_status' as any, {
    p_user_id: userId,
  });

  if (error) {
    console.error('getUserTenantsStatus error:', error);
    throw new Error('Errore nel controllo dello stato tenant');
  }

  return (data || []) as TenantStatus[];
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

export async function canCreateApp(tenantId: string): Promise<{ allowed: boolean; reason?: string }> {
  const supabase = getServiceSupabase();

  // FIXME: la funzione `can_create_app` non esiste nello schema generato dal
  // DB remoto collegato — mai applicata con una migrazione. Nessun chiamante
  // attivo nel repo oggi (funzione non importata altrove), ma va creata
  // remotamente prima di riutilizzarla.
  const { data, error } = await supabase.rpc('can_create_app' as any, {
    p_tenant_id: tenantId,
  });

  if (error) {
    console.error('canCreateApp error:', error);
    return { allowed: false, reason: 'Errore interno' };
  }

  if (!data) {
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
