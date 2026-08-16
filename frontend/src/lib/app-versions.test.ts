// ─── Test isolati — CreatorAI Engine 2.0, Fase 6 (app_versions store) ───────
// node:test nativo (Node 24), stesso stile di creator-generation-jobs.test.ts:
// nessuna chiamata di rete/DB reale, solo app-versions.ts contro il fake
// Supabase in-memory (test-helpers/fake-supabase.ts).
//
// Copre i requisiti Fase 6, "Test obbligatori": version creation, rollback,
// tenant isolation, app esistente senza versioni, RLS (verificata a parte
// via check_rls_policies.js — qui solo il comportamento applicativo).
//
// Uso: node --test src/lib/app-versions.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import {
  createAppVersion,
  listAppVersions,
  getAppVersionForTenant,
  rollbackAppVersion,
} from './app-versions.ts';

const APP_VERSIONS_DEFAULTS = {
  created_by: null,
  generation_job_id: null,
};

function freshSupabase(appsSeed: Record<string, unknown>[] = []) {
  return makeFakeSupabase({ app_versions: APP_VERSIONS_DEFAULTS }, { apps: appsSeed });
}

// ═══════════════════════════════════════════════════════════════════════════
// VERSION CREATION
// ═══════════════════════════════════════════════════════════════════════════

test('version creation: createAppVersion inserisce uno snapshot con i default corretti', async () => {
  const supabase = freshSupabase();
  const version = await createAppVersion(supabase, {
    appId: 'app-1',
    tenantId: 'tenant-1',
    config: { appName: 'Pizzeria v1' },
    createdBy: 'user-1',
  });

  assert.ok(version.id);
  assert.equal(version.app_id, 'app-1');
  assert.equal(version.tenant_id, 'tenant-1');
  assert.deepEqual(version.config, { appName: 'Pizzeria v1' });
  assert.equal(version.source, 'publish'); // default
  assert.equal(version.generation_job_id, null);
  assert.ok(version.created_at);
});

test('version creation: listAppVersions restituisce le versioni di un\'app più recenti prima', async () => {
  const supabase = freshSupabase();
  await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-1', config: { v: 1 } });
  await new Promise((r) => setTimeout(r, 2)); // garantisce created_at diversi
  await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-1', config: { v: 2 } });
  await createAppVersion(supabase, { appId: 'app-2', tenantId: 'tenant-1', config: { v: 99 } }); // altra app, non deve comparire

  const versions = await listAppVersions(supabase, 'app-1', 'tenant-1');
  assert.equal(versions.length, 2);
  assert.deepEqual(versions[0].config, { v: 2 }); // la più recente prima
  assert.deepEqual(versions[1].config, { v: 1 });
});

// ═══════════════════════════════════════════════════════════════════════════
// APP ESISTENTE SENZA VERSIONI
// ═══════════════════════════════════════════════════════════════════════════

test('app esistente senza versioni: listAppVersions ritorna un array vuoto, mai un errore', async () => {
  const supabase = freshSupabase([{ id: 'app-1', tenant_id: 'tenant-1', config: { appName: 'App senza storia' } }]);
  const versions = await listAppVersions(supabase, 'app-1', 'tenant-1');
  assert.deepEqual(versions, []);
});

test('app esistente senza versioni: rollback su una versione inesistente fallisce esplicitamente (VERSION_NOT_FOUND), mai un crash', async () => {
  const supabase = freshSupabase([{ id: 'app-1', tenant_id: 'tenant-1', config: { appName: 'App senza storia' } }]);
  const result = await rollbackAppVersion(supabase, { versionId: 'versione-mai-esistita', appId: 'app-1', tenantId: 'tenant-1' });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'VERSION_NOT_FOUND');
});

// ═══════════════════════════════════════════════════════════════════════════
// ROLLBACK
// ═══════════════════════════════════════════════════════════════════════════

test('rollback: ripristina apps.config alla versione scelta e snapshotta lo stato attuale prima di sovrascriverlo', async () => {
  const supabase = freshSupabase([{ id: 'app-1', tenant_id: 'tenant-1', config: { appName: 'Versione corrente (v2)' } }]);
  const v1 = await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-1', config: { appName: 'Versione precedente (v1)' } });

  const result = await rollbackAppVersion(supabase, { versionId: v1.id, appId: 'app-1', tenantId: 'tenant-1', createdBy: 'user-1' });
  assert.equal(result.ok, true);
  assert.deepEqual((result as { restoredConfig: unknown }).restoredConfig, { appName: 'Versione precedente (v1)' });

  // apps.config è stato effettivamente sovrascritto.
  const { data: app } = await (supabase.from('apps').select('*').eq('id', 'app-1') as any);
  assert.deepEqual(app[0].config, { appName: 'Versione precedente (v1)' });

  // Lo stato PRIMA del rollback (v2) è stato salvato come nuova versione,
  // source:'rollback' — nessuna configurazione è mai andata persa, e il
  // rollback stesso è ripristinabile.
  const versions = await listAppVersions(supabase, 'app-1', 'tenant-1');
  const rollbackSnapshot = versions.find((v) => v.source === 'rollback');
  assert.ok(rollbackSnapshot);
  assert.deepEqual(rollbackSnapshot?.config, { appName: 'Versione corrente (v2)' });
});

test('rollback: una versione dell\'app sbagliata (stesso tenant, app diversa) viene rifiutata come non trovata', async () => {
  const supabase = freshSupabase([
    { id: 'app-1', tenant_id: 'tenant-1', config: { appName: 'App 1' } },
    { id: 'app-2', tenant_id: 'tenant-1', config: { appName: 'App 2' } },
  ]);
  const versionOfApp2 = await createAppVersion(supabase, { appId: 'app-2', tenantId: 'tenant-1', config: { appName: 'Vecchia App 2' } });

  const result = await rollbackAppVersion(supabase, { versionId: versionOfApp2.id, appId: 'app-1', tenantId: 'tenant-1' });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'APP_MISMATCH');

  // apps.config di app-1 resta invariato.
  const { data: app } = await (supabase.from('apps').select('*').eq('id', 'app-1') as any);
  assert.deepEqual(app[0].config, { appName: 'App 1' });
});

// ═══════════════════════════════════════════════════════════════════════════
// TENANT ISOLATION (SECURITY)
// ═══════════════════════════════════════════════════════════════════════════

test('tenant isolation: getAppVersionForTenant restituisce la versione solo al tenant proprietario', async () => {
  const supabase = freshSupabase();
  const version = await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-owner', config: { v: 1 } });

  const found = await getAppVersionForTenant(supabase, version.id, 'tenant-owner');
  assert.ok(found);
  assert.equal(found?.id, version.id);
});

test('tenant mismatch: getAppVersionForTenant nega l\'accesso a una versione di un altro tenant (stessa risposta di "non esiste")', async () => {
  const supabase = freshSupabase();
  const version = await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-owner', config: { v: 1 } });

  const foundByOther = await getAppVersionForTenant(supabase, version.id, 'tenant-attacker');
  assert.equal(foundByOther, null);
});

test('tenant mismatch: rollbackAppVersion non ripristina una versione di un altro tenant (VERSION_NOT_FOUND, apps.config invariato)', async () => {
  const supabase = freshSupabase([
    { id: 'app-1', tenant_id: 'tenant-owner', config: { appName: 'App del tenant proprietario' } },
  ]);
  const version = await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-owner', config: { appName: 'Versione precedente' } });

  const result = await rollbackAppVersion(supabase, { versionId: version.id, appId: 'app-1', tenantId: 'tenant-attacker' });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'VERSION_NOT_FOUND');

  const { data: app } = await (supabase.from('apps').select('*').eq('id', 'app-1') as any);
  assert.deepEqual(app[0].config, { appName: 'App del tenant proprietario' }); // invariato
});

test('listAppVersions: le versioni di un tenant non compaiono mai nella lista di un altro tenant', async () => {
  const supabase = freshSupabase();
  await createAppVersion(supabase, { appId: 'app-1', tenantId: 'tenant-owner', config: { v: 1 } });

  const listedByOther = await listAppVersions(supabase, 'app-1', 'tenant-attacker');
  assert.deepEqual(listedByOther, []);
});
