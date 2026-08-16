// ─── Fake Supabase client per i test frontend (CreatorAI Engine 2.0, Fase 5/6) ──
// Stesso principio di backend/lib/test-helpers/fake-supabase.js (già presente
// nel working tree per i test del Logic/Workflow Engine, Fase 4): NON un mock
// di rete, un query-builder in memoria che replica solo il sottoinsieme di
// supabase-js realmente usato dai moduli store di questo repo
// (creator-generation-jobs.ts, app-versions.ts) — insert/update/select,
// eq/single/maybeSingle, e l'await diretto del builder (equivalente a
// supabase-js quando non si chiama .single()/.maybeSingle(), usato da
// listAppVersions). Usato dai *.test.ts di Fase 5/6 per non dipendere da un
// vero progetto Supabase nei test automatici (nessuna chiamata di rete/DB).

import type { SupabaseClient } from '@supabase/supabase-js';

let seq = 0;
function fakeUuid(): string {
  seq += 1;
  return `test-uuid-${seq}`;
}

type Row = Record<string, unknown>;

/**
 * `defaultsByTable` replica i DEFAULT di colonna della migration (es.
 * `artifacts jsonb NOT NULL DEFAULT '{}'::jsonb`, `retry_count DEFAULT 0`):
 * applicati solo in insert, prima del payload esplicito — stesso ordine di
 * risoluzione di Postgres.
 *
 * `seedTables` pre-popola righe già esistenti (es. una riga `apps` da cui
 * un rollback deve leggere/scrivere `config`) — mai usato per generation_jobs/
 * app_versions stessi, che nei test nascono sempre da un insert esplicito.
 */
export function makeFakeSupabase(
  defaultsByTable: Record<string, Row> = {},
  seedTables: Record<string, Row[]> = {}
): SupabaseClient {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seedTables)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  function ensureTable(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function makeBuilder(tableName: string) {
    const rows = ensureTable(tableName);
    const filters: { field: string; value: unknown }[] = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;

    function applyFilters(list: Row[]): Row[] {
      return list.filter((row) => filters.every((f) => row[f.field] === f.value));
    }

    async function resolveMany() {
      const now = new Date().toISOString();
      if (op === 'insert') {
        const defaults = defaultsByTable[tableName] || {};
        const row: Row = { id: fakeUuid(), created_at: now, updated_at: now, ...defaults, ...(payload as Row) };
        rows.push(row);
        return { data: [{ ...row }], error: null };
      }
      if (op === 'update') {
        const matched = applyFilters(rows);
        matched.forEach((r) => Object.assign(r, payload, { updated_at: now }));
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      return { data: applyFilters(rows).map((r) => ({ ...r })), error: null };
    }

    async function resolveOne(strict: boolean) {
      const { data, error } = await resolveMany();
      if (error) return { data: null, error };
      if (!data || data.length === 0) {
        return { data: null, error: strict ? { message: `${tableName}: nessuna riga trovata${op === 'update' ? " per l'update" : ''}` } : null };
      }
      return { data: data[0], error: null };
    }

    const builder = {
      select() { return builder; },
      insert(obj: Row) { op = 'insert'; payload = obj; return builder; },
      update(obj: Row) { op = 'update'; payload = obj; return builder; },
      eq(field: string, value: unknown) { filters.push({ field, value }); return builder; },
      single() { return resolveOne(true); },
      maybeSingle() { return resolveOne(false); },
      // Await diretto del builder (nessun .single()/.maybeSingle()), usato da
      // query che si aspettano più righe (es. listAppVersions).
      then(onResolve: (v: { data: Row[] | null; error: unknown }) => unknown, onReject?: (err: unknown) => unknown) {
        return resolveMany().then(onResolve, onReject);
      },
    };

    return builder;
  }

  return {
    from(tableName: string) { return makeBuilder(tableName); },
  } as unknown as SupabaseClient;
}
