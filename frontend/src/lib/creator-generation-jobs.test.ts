// ─── Test isolati — CreatorAI Engine 2.0, Fase 5 (generation_jobs store) ────
// node:test nativo (Node 24), stesso stile di app-specification.test.ts /
// site-schema.test.ts: nessuna chiamata di rete/DB reale, solo
// creator-generation-jobs.ts contro il fake Supabase in-memory (vedi
// test-helpers/fake-supabase.ts) che replica il sottoinsieme di supabase-js
// realmente usato (insert/update/select, eq/single/maybeSingle).
//
// Copre i requisiti Fase 5, punto 12 "GENERATION JOB": creazione, transizioni
// di stato, tenant isolation, failed, ready, retry count — più "SECURITY:
// nessun secret persistito" (findForbiddenSecretKey).
//
// Uso: node --test src/lib/creator-generation-jobs.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import {
  createGenerationJob,
  updateGenerationJob,
  getGenerationJobForTenant,
  findForbiddenSecretKey,
} from './creator-generation-jobs.ts';

// Stessi DEFAULT di colonna della migration 20260823000000_generation_jobs.sql
// (vedi commento in testa a fake-supabase.ts).
const GENERATION_JOBS_DEFAULTS = {
  app_id: null,
  created_by: null,
  plan: null,
  specification: null,
  artifacts: {},
  error: null,
  retry_count: 0,
  fallback_used: false,
};

function freshSupabase() {
  return makeFakeSupabase({ generation_jobs: GENERATION_JOBS_DEFAULTS });
}

// ═══════════════════════════════════════════════════════════════════════════
// CREAZIONE
// ═══════════════════════════════════════════════════════════════════════════

test('creazione: createGenerationJob inserisce un job in stato "planning" con i default corretti', async () => {
  const supabase = freshSupabase();
  const job = await createGenerationJob(supabase, {
    tenantId: 'tenant-1',
    createdBy: 'user-1',
    userPrompt: 'Genera un sito per una pizzeria',
    context: { projectType: 'webapp-pwa', lang: 'it' },
  });

  assert.ok(job.id);
  assert.equal(job.tenant_id, 'tenant-1');
  assert.equal(job.app_id, null);
  assert.equal(job.status, 'planning');
  assert.equal(job.current_step, 'planner');
  assert.equal(job.user_prompt, 'Genera un sito per una pizzeria');
  assert.deepEqual(job.context, { projectType: 'webapp-pwa', lang: 'it' });
  assert.equal(job.retry_count, 0);
  assert.equal(job.fallback_used, false);
  assert.deepEqual(job.artifacts, {});
  assert.equal(job.specification, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSIZIONI DI STATO
// ═══════════════════════════════════════════════════════════════════════════

test('transizioni di stato: updateGenerationJob percorre planning -> generating -> validating -> repairing -> ready', async () => {
  const supabase = freshSupabase();
  let job = await createGenerationJob(supabase, { tenantId: 'tenant-1' });
  assert.equal(job.status, 'planning');

  job = await updateGenerationJob(supabase, job.id, { status: 'generating', current_step: 'generator' });
  assert.equal(job.status, 'generating');
  assert.equal(job.current_step, 'generator');

  job = await updateGenerationJob(supabase, job.id, { status: 'validating', current_step: 'validator' });
  assert.equal(job.status, 'validating');

  job = await updateGenerationJob(supabase, job.id, { status: 'repairing', current_step: 'repair:1', retry_count: 1 });
  assert.equal(job.status, 'repairing');
  assert.equal(job.retry_count, 1);

  job = await updateGenerationJob(supabase, job.id, { status: 'ready', current_step: 'ready', specification: { entities: [] } });
  assert.equal(job.status, 'ready');
  assert.deepEqual(job.specification, { entities: [] });
  // Ogni update deve toccare updated_at senza spostare created_at.
  assert.ok(job.updated_at);
  assert.ok(job.created_at);
});

test('updateGenerationJob su un jobId inesistente fallisce esplicitamente (nessun update silenzioso)', async () => {
  const supabase = freshSupabase();
  await assert.rejects(
    () => updateGenerationJob(supabase, 'jobId-inesistente', { status: 'ready' }),
    /nessuna riga trovata/
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FAILED / READY
// ═══════════════════════════════════════════════════════════════════════════

test('failed: updateGenerationJob persiste status "failed" + error', async () => {
  const supabase = freshSupabase();
  const created = await createGenerationJob(supabase, { tenantId: 'tenant-1' });
  const job = await updateGenerationJob(supabase, created.id, {
    status: 'failed',
    current_step: 'failed',
    error: 'Validazione fallita dopo 2 tentativi di repair',
    retry_count: 2,
  });
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'Validazione fallita dopo 2 tentativi di repair');
  assert.equal(job.retry_count, 2);
});

test('ready: updateGenerationJob persiste status "ready" + specification, error resta null', async () => {
  const supabase = freshSupabase();
  const created = await createGenerationJob(supabase, { tenantId: 'tenant-1' });
  const job = await updateGenerationJob(supabase, created.id, {
    status: 'ready',
    current_step: 'ready',
    specification: { appName: 'Pizzeria Da Mario' },
  });
  assert.equal(job.status, 'ready');
  assert.equal(job.error, null);
  assert.deepEqual(job.specification, { appName: 'Pizzeria Da Mario' });
});

// ═══════════════════════════════════════════════════════════════════════════
// RETRY COUNT
// ═══════════════════════════════════════════════════════════════════════════

test('retry count: parte da 0 e viene incrementato esplicitamente ad ogni tentativo di repair, mai in automatico', async () => {
  const supabase = freshSupabase();
  let job = await createGenerationJob(supabase, { tenantId: 'tenant-1' });
  assert.equal(job.retry_count, 0);

  job = await updateGenerationJob(supabase, job.id, { retry_count: 1 });
  assert.equal(job.retry_count, 1);

  job = await updateGenerationJob(supabase, job.id, { retry_count: 2 });
  assert.equal(job.retry_count, 2);

  // Un update che non tocca retry_count non lo azzera/altera.
  job = await updateGenerationJob(supabase, job.id, { current_step: 'validator' });
  assert.equal(job.retry_count, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// TENANT ISOLATION (SECURITY)
// ═══════════════════════════════════════════════════════════════════════════

test('tenant isolation: getGenerationJobForTenant restituisce il job solo al tenant proprietario', async () => {
  const supabase = freshSupabase();
  const job = await createGenerationJob(supabase, { tenantId: 'tenant-owner' });

  const found = await getGenerationJobForTenant(supabase, job.id, 'tenant-owner');
  assert.ok(found);
  assert.equal(found?.id, job.id);
});

test('tenant mismatch: getGenerationJobForTenant nega l\'accesso a un job di un altro tenant (stessa risposta di "non esiste")', async () => {
  const supabase = freshSupabase();
  const job = await createGenerationJob(supabase, { tenantId: 'tenant-owner' });

  const foundByOther = await getGenerationJobForTenant(supabase, job.id, 'tenant-attacker');
  assert.equal(foundByOther, null);

  const foundInexistent = await getGenerationJobForTenant(supabase, 'jobId-inesistente', 'tenant-attacker');
  assert.equal(foundInexistent, null);
  // Stessa forma di risposta (null) per "job di un altro tenant" e "job
  // inesistente" — requisito esplicito: non deve rivelare quale dei due sia.
});

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: nessun segreto persistito
// ═══════════════════════════════════════════════════════════════════════════

test('nessun secret persistito: findForbiddenSecretKey individua chiavi sospette a qualunque livello di annidamento', () => {
  assert.equal(findForbiddenSecretKey({ projectType: 'gestionale', lang: 'it' }), null);
  assert.equal(findForbiddenSecretKey({ nested: { sector: 'food', pages: ['home'] } }), null);

  assert.equal(findForbiddenSecretKey({ apiKey: 'sk-xxx' }), 'apiKey');
  assert.equal(findForbiddenSecretKey({ nested: { OPENROUTER_API_KEY: 'sk-xxx' } }), 'nested.OPENROUTER_API_KEY');
  assert.equal(findForbiddenSecretKey({ nested: { deep: { token: 'abc' } } }), 'nested.deep.token');
  assert.equal(findForbiddenSecretKey({ password: 'x' }), 'password');
  assert.equal(findForbiddenSecretKey({ authorization: 'Bearer x' }), 'authorization');
});

test('nessun secret persistito: createGenerationJob rifiuta un context con una chiave sospetta', async () => {
  const supabase = freshSupabase();
  await assert.rejects(
    () => createGenerationJob(supabase, {
      tenantId: 'tenant-1',
      context: { projectType: 'gestionale', apiKey: 'sk-should-not-be-here' },
    }),
    /chiave sospetta di segreto/
  );
});

test('nessun secret persistito: updateGenerationJob rifiuta artifacts con una chiave sospetta', async () => {
  const supabase = freshSupabase();
  const job = await createGenerationJob(supabase, { tenantId: 'tenant-1' });
  await assert.rejects(
    () => updateGenerationJob(supabase, job.id, { artifacts: { repairAttempt: { authToken: 'xxx' } } }),
    /chiave sospetta di segreto/
  );
});
