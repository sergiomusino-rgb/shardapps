// ─── Fake Supabase client per i test frontend (CreatorAI Engine 2.0, Fase 5/6/7) ──
// Stesso principio di backend/lib/test-helpers/fake-supabase.js (già presente
// nel working tree per i test del Logic/Workflow Engine, Fase 4): NON un mock
// di rete, un query-builder in memoria che replica solo il sottoinsieme di
// supabase-js realmente usato dai moduli store di questo repo
// (creator-generation-jobs.ts, app-versions.ts) — insert/update/select,
// eq/limit/single/maybeSingle, l'await diretto del builder (equivalente a
// supabase-js quando non si chiama .single()/.maybeSingle(), usato da
// listAppVersions), .rpc() e .auth.getUser().
//
// .rpc()/.auth.getUser() (hardening post-DONE, blocco 1/2): aggiunti per i
// test HTTP delle route reali (creator-server.ts usa supabase.auth.getUser()
// e supabase.rpc('increment_tenant_app_count'/'check_rate_limit', ...)) —
// puramente additivo, nessuna delle 5 suite Fase 5/6 esistenti (che non li
// usano) è toccata da questa estensione.
//
// Usato dai *.test.ts di Fase 5/6/7 per non dipendere da un vero progetto
// Supabase nei test automatici (nessuna chiamata di rete/DB).

import type { SupabaseClient } from '@supabase/supabase-js';

let seq = 0;
function fakeUuid(): string {
  seq += 1;
  return `test-uuid-${seq}`;
}

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export type RpcHandler = (params: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

export interface FakeSupabaseOptions {
  /** name RPC -> handler. RPC non elencate rispondono con un errore
   * "funzione non disponibile" (code '42883', stesso codice Postgres che il
   * codice reale già gestisce come "migration non ancora applicata" —
   * vedi reserveAppSlot/checkRateLimit, entrambi con fallback "fail open"/
   * non atomico per questo caso, così il default resta sicuro senza dover
   * configurare esplicitamente ogni RPC in ogni test). */
  rpcHandlers?: Record<string, RpcHandler>;
  /** access token -> utente autenticato "finto", letto da
   * supabase.auth.getUser(token) (creator-server.ts::getUserFromToken). Un
   * token assente/non mappato risolve a user:null, come un token invalido
   * reale. */
  authUsers?: Record<string, { id: string; email?: string }>;
}

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
  seedTables: Record<string, Row[]> = {},
  options: FakeSupabaseOptions = {}
): SupabaseClient {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seedTables)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const rpcHandlers = options.rpcHandlers || {};
  const authUsers = options.authUsers || {};

  function ensureTable(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function makeBuilder(tableName: string) {
    const rows = ensureTable(tableName);
    const filters: { field: string; value: unknown }[] = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Row | null = null;
    let limitN: number | null = null;
    let upsertConflictKey: string | null = null;

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
      if (op === 'upsert') {
        // onConflict (colonna singola, unico caso realmente usato nel repo —
        // app_credentials.upsert(..., {onConflict:'app_id'})): se esiste già
        // una riga con quel valore la aggiorna, altrimenti inserisce come una
        // insert normale (stessi DEFAULT di colonna).
        const key = upsertConflictKey;
        const existing = key ? rows.find((r) => r[key] === (payload as Row)[key]) : undefined;
        if (existing) {
          Object.assign(existing, payload, { updated_at: now });
          return { data: [{ ...existing }], error: null };
        }
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
      let result = applyFilters(rows);
      if (limitN != null) result = result.slice(0, limitN);
      return { data: result.map((r) => ({ ...r })), error: null };
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
      upsert(obj: Row, upsertOpts?: { onConflict?: string }) { op = 'upsert'; payload = obj; upsertConflictKey = upsertOpts?.onConflict || null; return builder; },
      eq(field: string, value: unknown) { filters.push({ field, value }); return builder; },
      limit(n: number) { limitN = n; return builder; },
      order() { return builder; }, // no-op: nessun test dipende dall'ordinamento lato query
      single() { return resolveOne(true); },
      maybeSingle() { return resolveOne(false); },
      // Await diretto del builder (nessun .single()/.maybeSingle()), usato da
      // query che si aspettano più righe (es. listAppVersions, tenant_members).
      then(onResolve: (v: { data: Row[] | null; error: unknown }) => unknown, onReject?: (err: unknown) => unknown) {
        return resolveMany().then(onResolve, onReject);
      },
    };

    return builder;
  }

  return {
    from(tableName: string) { return makeBuilder(tableName); },
    async rpc(name: string, params: Record<string, unknown> = {}) {
      const handler = rpcHandlers[name];
      if (handler) return handler(params);
      // Default "fail open" nello stesso formato di un errore Postgres
      // "funzione inesistente" — il codice reale (reserveAppSlot,
      // checkRateLimit) tratta già questo caso come "migration non ancora
      // applicata" e ricade su un percorso alternativo, mai un crash.
      return { data: null, error: { message: `rpc "${name}" non configurata nel fake Supabase`, code: '42883' } };
    },
    auth: {
      async getUser(token: string) {
        const user = authUsers[token] || null;
        return { data: { user }, error: user ? null : { message: 'Token non valido (fake)' } };
      },
    },
  } as unknown as SupabaseClient;
}
