// ─── Fake Supabase client per i test del Logic/Workflow Engine (Fase 4) ────
// NON un mock di rete (nessuna vera chiamata HTTP/DB, stesso principio già
// usato in ssrf-guard.test.js per non dipendere da risorse esterne nei test
// automatici): un query-builder in memoria che replica solo il sottoscritto
// dell'API supabase-js realmente usato da event-router.js/
// workflow-action-executor.js/action-dispatcher.js — select/insert/update/
// delete, eq/not/limit, single/maybeSingle, e l'await diretto del builder
// (equivalente a supabase-js quando non si chiama .single()/.maybeSingle()).
//
// NON è un file *.test.js (non intercettato da `npm test`, che nella
// cartella backend/ globba solo lib/**/*.test.js): solo un helper condiviso.

function makeFakeSupabase(seedTables = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seedTables)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  function ensureTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, field, value }) => {
      if (op === 'eq') return row[field] === value;
      if (op === 'not') return row[field] !== value; // usato solo per il pre-filtro JSONB di workflow-schedule.js, qui semplificato a "non vuoto"
      // gte/lt: aggiunti per ai-usage.js (somma costo AI in una finestra
      // temporale, es. `.gte('created_at', since)`) — puramente additivo.
      if (op === 'gte') return row[field] != null && row[field] >= value;
      if (op === 'lt') return row[field] != null && row[field] < value;
      if (op === 'lte') return row[field] != null && row[field] <= value;
      return true;
    }));
  }

  function makeBuilder(tableName) {
    const rows = ensureTable(tableName);
    const filters = [];
    let op = 'select';
    let payload = null;
    let limitN = null;
    let upsertConflictKey = null;

    const builder = {
      select() { return builder; },
      insert(obj) { op = 'insert'; payload = Array.isArray(obj) ? obj : [obj]; return builder; },
      update(obj) { op = 'update'; payload = obj; return builder; },
      // upsert: aggiunto per password-hash (rehash-on-verify riscrive
      // app_credentials/app_rbac_users con lo stesso .upsert(...,{onConflict})
      // già usato dal codice reale, es. publish/route.ts) — stesso principio
      // "se esiste aggiorna, altrimenti inserisci" della controparte
      // frontend (fake-supabase.ts).
      upsert(obj, opts) { op = 'upsert'; payload = obj; upsertConflictKey = opts?.onConflict || null; return builder; },
      delete() { op = 'delete'; return builder; },
      eq(field, value) { filters.push({ op: 'eq', field, value }); return builder; },
      not(field, _cmp, value) { filters.push({ op: 'not', field, value }); return builder; },
      gte(field, value) { filters.push({ op: 'gte', field, value }); return builder; },
      lt(field, value) { filters.push({ op: 'lt', field, value }); return builder; },
      lte(field, value) { filters.push({ op: 'lte', field, value }); return builder; },
      order() { return builder; },
      limit(n) { limitN = n; return builder; },
      single() { return resolveOne(true); },
      maybeSingle() { return resolveOne(false); },
      then(resolve, reject) { return resolveMany().then(resolve, reject); },
      catch(reject) { return resolveMany().catch(reject); },
    };

    async function resolveMany() {
      if (op === 'insert') {
        const inserted = payload.map((p, i) => ({ id: p.id || `${tableName}_${rows.length + i + 1}`, ...p }));
        rows.push(...inserted);
        return { data: inserted, error: null };
      }
      if (op === 'update') {
        const matched = applyFilters(rows, filters);
        matched.forEach((r) => Object.assign(r, payload));
        return { data: matched, error: null };
      }
      if (op === 'upsert') {
        const key = upsertConflictKey;
        const existing = key ? rows.find((r) => r[key] === payload[key]) : undefined;
        if (existing) {
          Object.assign(existing, payload);
          return { data: [existing], error: null };
        }
        const row = { id: payload.id || `${tableName}_${rows.length + 1}`, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === 'delete') {
        const matched = applyFilters(rows, filters);
        for (const m of matched) {
          const idx = rows.indexOf(m);
          if (idx >= 0) rows.splice(idx, 1);
        }
        return { data: matched, error: null };
      }
      let result = applyFilters(rows, filters);
      if (limitN != null) result = result.slice(0, limitN);
      return { data: result.map((r) => ({ ...r })), error: null };
    }

    function resolveOne(strict) {
      return resolveMany().then(({ data, error }) => {
        if (error) return { data: null, error };
        if (!data || data.length === 0) return { data: null, error: strict ? { message: 'not found', code: 'PGRST116' } : null };
        return { data: data[0], error: null };
      });
    }

    return builder;
  }

  return {
    from(tableName) { return makeBuilder(tableName); },
    _tables: tables, // accesso diretto per asserzioni nei test (es. verificare app_action_logs scritto)
  };
}

module.exports = { makeFakeSupabase };
