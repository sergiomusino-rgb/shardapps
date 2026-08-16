// ─── app_versions — store (CreatorAI Engine 2.0, Fase 6) ───────────────────
// CRUD minimale sulla tabella `app_versions` (migration
// 20260824000000_app_versions.sql): cronologia degli snapshot di
// `apps.config`, usata da app/api/creator/publish/route.ts (snapshot prima di
// ogni ripubblicazione) e da rollbackAppVersion sotto (ripristino esplicito,
// mai automatico — resta un'azione umana separata dal publish gate).
//
// Stesso principio applicativo di creator-generation-jobs.ts: RLS nega
// l'accesso diretto da client anon/authenticated (vedi migration), quindi
// "un tenant può leggere/ripristinare solo le proprie versioni" è
// responsabilità di QUESTO filtro esplicito per tenant_id, non della sola RLS.

import type { SupabaseClient } from '@supabase/supabase-js';

export type AppVersionSource = 'publish' | 'rollback';

export interface AppVersionRow {
  id: string;
  app_id: string;
  tenant_id: string;
  config: unknown;
  created_by: string | null;
  source: AppVersionSource;
  generation_job_id: string | null;
  created_at: string;
}

const TABLE = 'app_versions';

export interface CreateAppVersionInput {
  appId: string;
  tenantId: string;
  config: unknown;
  createdBy?: string | null;
  source?: AppVersionSource;
  generationJobId?: string | null;
}

export async function createAppVersion(supabase: SupabaseClient, input: CreateAppVersionInput): Promise<AppVersionRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      app_id: input.appId,
      tenant_id: input.tenantId,
      config: input.config,
      created_by: input.createdBy ?? null,
      source: input.source ?? 'publish',
      generation_job_id: input.generationJobId ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`createAppVersion: ${error?.message || 'insert fallito'}`);
  }
  return data as AppVersionRow;
}

/** Cronologia di un'app, filtrata ESPLICITAMENTE per tenant — stessa
 * garanzia "stesso risultato per app inesistente o di un altro tenant" di
 * getGenerationJobForTenant (nessuna differenza osservabile dal chiamante). */
export async function listAppVersions(supabase: SupabaseClient, appId: string, tenantId: string): Promise<AppVersionRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('app_id', appId)
    .eq('tenant_id', tenantId);

  if (error) throw new Error(`listAppVersions: ${error.message}`);
  const rows = (data as AppVersionRow[] | null) ?? [];
  // Ordine più recente prima: fatto qui invece che con .order() lato query
  // per restare compatibile col fake Supabase dei test (che non implementa
  // .order()), che replica solo il sottoinsieme dell'API realmente usato.
  return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getAppVersionForTenant(supabase: SupabaseClient, versionId: string, tenantId: string): Promise<AppVersionRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', versionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`getAppVersionForTenant: ${error.message}`);
  return (data as AppVersionRow | null) ?? null;
}

export type RollbackResult =
  | { ok: true; restoredConfig: unknown; appId: string }
  | { ok: false; reason: 'VERSION_NOT_FOUND' | 'APP_MISMATCH' };

/**
 * Ripristina `apps.config` allo snapshot `versionId` (deve appartenere a
 * `tenantId` — stessa risposta "non trovata" sia per versione inesistente
 * sia per versione di un altro tenant, mai una distinzione osservabile).
 * Prima di sovrascrivere, salva lo stato ATTUALE come nuova versione
 * (source:'rollback'): un rollback è a sua volta reversibile, nessuna
 * configurazione va mai persa (requisito Fase 6, "nessuna perdita di dati").
 * Mai automatico: chiamato solo da un'azione umana esplicita (nuovo endpoint
 * dedicato, mai da generate/publish/refactor).
 */
export async function rollbackAppVersion(
  supabase: SupabaseClient,
  params: { versionId: string; appId: string; tenantId: string; createdBy?: string | null }
): Promise<RollbackResult> {
  const version = await getAppVersionForTenant(supabase, params.versionId, params.tenantId);
  if (!version) {
    return { ok: false, reason: 'VERSION_NOT_FOUND' };
  }
  if (version.app_id !== params.appId) {
    // La versione esiste ed è del tenant giusto, ma di un'altra app: stesso
    // trattamento di "non trovata" verso il chiamante (mai confermare che
    // esiste altrove), ma con un motivo distinto per i log interni.
    return { ok: false, reason: 'APP_MISMATCH' };
  }

  const { data: currentApp, error: fetchError } = await supabase
    .from('apps')
    .select('config')
    .eq('id', params.appId)
    .eq('tenant_id', params.tenantId)
    .single();

  if (fetchError || !currentApp) {
    return { ok: false, reason: 'VERSION_NOT_FOUND' };
  }

  // Snapshot dello stato ATTUALE prima di sovrascriverlo (vedi doc-comment).
  await createAppVersion(supabase, {
    appId: params.appId,
    tenantId: params.tenantId,
    config: (currentApp as { config: unknown }).config,
    createdBy: params.createdBy ?? null,
    source: 'rollback',
  });

  const { error: updateError } = await supabase
    .from('apps')
    .update({ config: version.config, updated_at: new Date().toISOString() })
    .eq('id', params.appId)
    .eq('tenant_id', params.tenantId);

  if (updateError) {
    throw new Error(`rollbackAppVersion: ${updateError.message}`);
  }

  return { ok: true, restoredConfig: version.config, appId: params.appId };
}
