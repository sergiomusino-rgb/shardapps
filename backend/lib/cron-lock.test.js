// ─── Test: cron-lock — protezione da esecuzioni concorrenti duplicate ──────
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acquireCronLock, finishCronLock, withCronLock, isDuplicateKeyError } = require('./cron-lock');

// Doppio minimale e mirato: replica SOLO il comportamento di un vincolo
// UNIQUE (job_name, run_key) su INSERT — il fake-supabase.js condiviso non
// simula violazioni di vincolo, e qui serve esattamente quello scenario di
// race condition, non un query-builder generico.
function makeLockFakeSupabase() {
  const rows = new Map(); // key: `${job_name}:${run_key}` -> row
  return {
    _rows: rows,
    from(table) {
      assert.equal(table, 'cron_job_runs');
      let updatePayload = null;
      const filters = [];
      return {
        insert(row) {
          const key = `${row.job_name}:${row.run_key}`;
          if (rows.has(key)) {
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cron_job_runs_pkey"' } });
          }
          rows.set(key, { ...row, started_at: new Date().toISOString(), status: 'running' });
          return Promise.resolve({ data: [rows.get(key)], error: null });
        },
        update(payload) { updatePayload = payload; return this; },
        eq(field, value) { filters.push({ field, value }); return this; },
        then(resolve) {
          // Solo il ramo update().eq().eq() è realmente atteso da finishCronLock.
          const jobName = filters.find((f) => f.field === 'job_name')?.value;
          const runKey = filters.find((f) => f.field === 'run_key')?.value;
          const key = `${jobName}:${runKey}`;
          if (rows.has(key)) Object.assign(rows.get(key), updatePayload);
          return resolve({ data: null, error: null });
        },
      };
    },
  };
}

test('isDuplicateKeyError: riconosce il codice 23505', () => {
  assert.equal(isDuplicateKeyError({ code: '23505' }), true);
  assert.equal(isDuplicateKeyError({ message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isDuplicateKeyError({ code: '42883' }), false);
  assert.equal(isDuplicateKeyError(null), false);
});

test('acquireCronLock: la prima chiamata per (job, runKey) vince', async () => {
  const supabase = makeLockFakeSupabase();
  const acquired = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  assert.equal(acquired, true);
});

test('acquireCronLock: una seconda chiamata per LO STESSO (job, runKey) perde — nessuna doppia esecuzione', async () => {
  const supabase = makeLockFakeSupabase();
  const first = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  const second = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  assert.equal(first, true);
  assert.equal(second, false);
});

test('acquireCronLock: run_key diversi (finestre diverse) sono indipendenti', async () => {
  const supabase = makeLockFakeSupabase();
  const day1 = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  const day2 = await acquireCronLock(supabase, 'expiry-check', '2026-08-28');
  assert.equal(day1, true);
  assert.equal(day2, true);
});

test('acquireCronLock: job diversi con LO STESSO run_key non si bloccano a vicenda', async () => {
  const supabase = makeLockFakeSupabase();
  const a = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  const b = await acquireCronLock(supabase, 'workflow-tick', '2026-08-27');
  assert.equal(a, true);
  assert.equal(b, true);
});

test('acquireCronLock: errore inatteso (non 23505) -> fail-open, il job procede comunque', async () => {
  const supabase = {
    from() {
      return { insert: () => Promise.resolve({ data: null, error: { code: '42883', message: 'function non disponibile' } }) };
    },
  };
  const acquired = await acquireCronLock(supabase, 'expiry-check', '2026-08-27');
  assert.equal(acquired, true);
});

test('withCronLock: esegue fn() solo se il lock è stato acquisito', async () => {
  const supabase = makeLockFakeSupabase();
  let ranCount = 0;
  const r1 = await withCronLock(supabase, 'workflow-tick', 'bucket-1', async () => { ranCount += 1; });
  const r2 = await withCronLock(supabase, 'workflow-tick', 'bucket-1', async () => { ranCount += 1; });
  assert.equal(r1.ran, true);
  assert.equal(r2.ran, false);
  assert.equal(ranCount, 1, 'fn() eseguita una sola volta nonostante due tentativi concorrenti');
});

test('withCronLock: un errore in fn() viene catturato, marcato "failed", mai rilanciato al chiamante', async () => {
  const supabase = makeLockFakeSupabase();
  const result = await withCronLock(supabase, 'expiry-check', '2026-08-27', async () => {
    throw new Error('boom');
  });
  assert.equal(result.ran, true);
  assert.equal(result.error?.message, 'boom');
  const row = supabase._rows.get('expiry-check:2026-08-27');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'boom');
});

test('finishCronLock: non lancia mai, anche se il DB fallisce', async () => {
  const supabase = { from() { throw new Error('db down'); } };
  await assert.doesNotReject(() => finishCronLock(supabase, 'expiry-check', '2026-08-27', 'ok'));
});
