// ─── Data Export + Public API v1 ────────────────────────────────────────────
// Namespace versionato /api/v1/apps/:appId/... per l'accesso esterno ai dati
// di una singola app tramite API key (Authorization: Bearer <API_KEY>, vedi
// lib/public-api-auth.js). Additivo: non tocca né sostituisce le route
// esistenti (routes/app-records.js per il proprietario via JWT,
// routes/custom-tables.js per il client via password/JWT app) — stesso
// motore di dati (app_records, entity-metadata), autenticazione diversa.
//
// Discovery/validazione entità riusa integralmente lib/entity-metadata.js
// (buildEntityList/findEntity/validateEntityFields), la stessa fonte di
// verità già usata da GET /client/apps/:appId/entities in custom-tables.js:
// nessun secondo motore CRUD, nessuna logica di schema duplicata.
//
// Isolamento: OGNI query verso app_records filtra sempre su
// .eq('app_id', req.appId).eq('tenant_id', req.tenantId) — entrambi
// impostati esclusivamente da requireApiKey a partire dalla riga
// app_api_keys risolta dalla chiave, mai da input dell'utente.

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const { requireApiKey, requireScope } = require('../lib/public-api-auth');
const { publicApiLimiter } = require('../middleware/rate-limit');
const { buildEntityList, findEntity } = require('../lib/entity-metadata');
const { loadExportData, streamExportZip, buildPublicSchema } = require('../lib/data-export');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Stesso identico wrapper di loadAppEntities già presente (privato) in
// routes/custom-tables.js e routes/api-keys.js: due query in parallelo +
// buildEntityList, nessuna scrittura. Non esportato da entity-metadata.js
// perché quel modulo è intenzionalmente puro (nessuna dipendenza da
// supabase-js, vedi il suo commento in testa) — ogni chiamante lo
// ricompone localmente in poche righe, stesso pattern già in uso.
async function loadAppEntities(supabase, appId, tenantId) {
  const [{ data: appRow }, { data: customDefs }] = await Promise.all([
    supabase.from('apps').select('config').eq('id', appId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('app_records').select('id, data')
      .eq('app_id', appId).eq('tenant_id', tenantId).eq('table_name', '_custom_tables'),
  ]);
  return buildEntityList(appRow?.config || {}, customDefs || [], { appId, tenantId });
}

// Applicata a TUTTE le route sotto /:appId: autentica la API key, la
// vincola all'app del path, poi applica il rate limit per-chiave (l'ordine è
// intenzionale — il limiter usa req.apiKeyId impostato da requireApiKey).
router.use('/:appId', requireApiKey, publicApiLimiter);

// GET /api/v1/apps/:appId/health — verifica rapida che la chiave sia valida
// e legata a questa app, senza toccare dati applicativi.
router.get('/:appId/health', (req, res) => {
  res.json({ status: 'ok', appId: req.appId, scopes: req.apiKeyScopes, version: 'v1' });
});

// GET /api/v1/apps/:appId/schema — rappresentazione pubblica dello schema
// (Fase 6): riusa buildPublicSchema di lib/data-export.js, la stessa
// funzione usata per schema.json nell'export ZIP — un solo posto che decide
// cosa è "pubblico" nello schema.
router.get('/:appId/schema', requireScope('read'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    res.json({ entities: buildPublicSchema(entities) });
  } catch (err) {
    console.error('[public-api] GET schema error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/v1/apps/:appId/entities — elenco leggero delle entità disponibili
// per QUESTA app (Fase 4/5).
router.get('/:appId/entities', requireScope('read'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    res.json({
      entities: entities.map((e) => ({
        name: e.name,
        label: e.label,
        labelPlural: e.labelPlural,
        icon: e.icon,
        fieldCount: (e.fields || []).length,
      })),
      count: entities.length,
    });
  } catch (err) {
    console.error('[public-api] GET entities error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RESERVED_QUERY_PARAMS = new Set(['limit', 'offset', 'sort', 'order']);

// Costruisce i parametri di lista in modo sicuro: limit/offset con tetto
// massimo, ordinamento ristretto a created_at/updated_at (colonne reali,
// nessun path jsonb arbitrario), filtri solo su field id realmente presenti
// nello schema dell'entità (whitelist) con confronto di sola uguaglianza —
// mai SQL/JSON path passato così com'è dall'utente.
function parseListParams(req, entity) {
  const allowedFieldIds = new Set((entity.fields || []).map((f) => f.id));

  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  let offset = parseInt(req.query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const sortField = req.query.sort === 'updated_at' ? 'updated_at' : 'created_at';
  const ascending = req.query.order === 'asc';

  const filters = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (RESERVED_QUERY_PARAMS.has(key)) continue;
    if (!allowedFieldIds.has(key)) continue;
    if (typeof value !== 'string') continue;
    filters.push({ field: key, value });
  }

  return { limit, offset, sortField, ascending, filters };
}

function toPublicRecord(row) {
  return { id: row.id, created_at: row.created_at, updated_at: row.updated_at, ...(row.data || {}) };
}

// GET /api/v1/apps/:appId/entities/:entity — elenco record (Fase 5).
router.get('/:appId/entities/:entity', requireScope('read'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const entity = findEntity(entities, req.params.entity);
    if (!entity) {
      return res.status(404).json({ error: `Entità "${req.params.entity}" non trovata` });
    }

    const { limit, offset, sortField, ascending, filters } = parseListParams(req, entity);

    let query = supabase
      .from('app_records')
      .select('id, data, created_at, updated_at', { count: 'exact' })
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName);

    for (const f of filters) {
      query = query.filter(`data->>${f.field}`, 'eq', f.value);
    }

    query = query.order(sortField, { ascending }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('[public-api] GET entity records error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({
      records: (data || []).map(toPublicRecord),
      count: count ?? data?.length ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[public-api] GET entity records exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/v1/apps/:appId/entities/:entity/:id
router.get('/:appId/entities/:entity/:id', requireScope('read'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const entity = findEntity(entities, req.params.entity);
    if (!entity) {
      return res.status(404).json({ error: `Entità "${req.params.entity}" non trovata` });
    }

    const { data, error } = await supabase
      .from('app_records')
      .select('id, data, created_at, updated_at')
      .eq('id', req.params.id)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName)
      .maybeSingle();

    if (error) {
      console.error('[public-api] GET entity record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }
    if (!data) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    res.json({ record: toPublicRecord(data) });
  } catch (err) {
    console.error('[public-api] GET entity record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/v1/apps/:appId/entities/:entity — crea un record (Fase 5/7,
// richiede scope 'write'). Il body è preso direttamente come i campi del
// record (nessun wrapper {data:...} richiesto lato chiamante esterno — più
// naturale per un consumer HTTP di terze parti rispetto alla convenzione
// interna usata da app-records.js/custom-tables.js).
router.post('/:appId/entities/:entity', requireScope('write'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const entity = findEntity(entities, req.params.entity);
    if (!entity) {
      return res.status(404).json({ error: `Entità "${req.params.entity}" non trovata` });
    }

    const recordData = req.body && typeof req.body === 'object' ? req.body : {};

    const { data, error } = await supabase
      .from('app_records')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        table_name: entity.recordTableName,
        data: recordData,
      })
      .select('id, data, created_at, updated_at')
      .single();

    if (error) {
      console.error('[public-api] POST entity record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ record: toPublicRecord(data) });
  } catch (err) {
    console.error('[public-api] POST entity record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PATCH /api/v1/apps/:appId/entities/:entity/:id — aggiorna parzialmente
// (merge) un record esistente. Verifica ownership (app_id/tenant_id/entity)
// prima di scrivere, come richiesto dalla Fase 5.
router.patch('/:appId/entities/:entity/:id', requireScope('write'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const entity = findEntity(entities, req.params.entity);
    if (!entity) {
      return res.status(404).json({ error: `Entità "${req.params.entity}" non trovata` });
    }

    const { data: existing, error: fetchError } = await supabase
      .from('app_records')
      .select('data')
      .eq('id', req.params.id)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName)
      .maybeSingle();

    if (fetchError) {
      console.error('[public-api] PATCH entity record fetch error:', fetchError);
      return res.status(500).json({ error: 'Errore interno' });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const mergedData = { ...(existing.data || {}), ...patch };

    const { data, error } = await supabase
      .from('app_records')
      .update({ data: mergedData, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName)
      .select('id, data, created_at, updated_at')
      .single();

    if (error) {
      console.error('[public-api] PATCH entity record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ record: toPublicRecord(data) });
  } catch (err) {
    console.error('[public-api] PATCH entity record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /api/v1/apps/:appId/entities/:entity/:id
router.delete('/:appId/entities/:entity/:id', requireScope('write'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const entity = findEntity(entities, req.params.entity);
    if (!entity) {
      return res.status(404).json({ error: `Entità "${req.params.entity}" non trovata` });
    }

    const { data: existing } = await supabase
      .from('app_records')
      .select('id')
      .eq('id', req.params.id)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    const { error } = await supabase
      .from('app_records')
      .delete()
      .eq('id', req.params.id)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', entity.recordTableName);

    if (error) {
      console.error('[public-api] DELETE entity record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[public-api] DELETE entity record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/v1/apps/:appId/export — export completo (Fase 9), stesso motore
// di routes/api-keys.js::export-all (dashboard proprietario), qui dietro API
// key con scope 'read'.
router.get('/:appId/export', requireScope('read'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const result = await loadExportData(supabase, req.appId, req.tenantId);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    streamExportZip(res, result);
  } catch (err) {
    console.error('[public-api] GET export exception:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Errore interno' });
    } else {
      res.end();
    }
  }
});

module.exports = router;
