const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { clientAuthMiddleware } = require('../lib/client-auth');
const {
  toId,
  buildEntityList,
  toCanonicalField,
  validateEntityFields,
} = require('../lib/entity-metadata');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// ─── FASE 2 — Generic Database Engine: entity metadata ──────────────────────
// Elenco unificato delle entità di un'app, qualunque sia il motore che le ha
// generate (schema.tables, adminPanel.entities, o le custom table di questo
// file) — usato sia dal nuovo GET .../entities sia dalla validazione
// server-side delle relation qui sotto. Sola lettura, nessuna scrittura:
// due query in parallelo, stesso costo di quelle già esistenti nelle route
// sottostanti.
async function loadAppEntities(supabase, appId, tenantId) {
  const [{ data: appRow }, { data: customDefs }] = await Promise.all([
    supabase.from('apps').select('config').eq('id', appId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('app_records').select('id, data')
      .eq('app_id', appId).eq('tenant_id', tenantId).eq('table_name', '_custom_tables'),
  ]);
  return buildEntityList(appRow?.config || {}, customDefs || [], { appId, tenantId });
}

// Normalizza una colonna custom-table applicando le stesse chiavi di
// FieldSchema (blueprint-schema.ts) per relation/state — additivo rispetto al
// formato { name, label, type, required, options } già salvato oggi: nessuna
// app esistente ha mai potuto scrivere questi campi (nessuna UI/endpoint lo
// permetteva), quindi nessun record esistente li ha, e la loro assenza non
// cambia nulla per chi legge `columns` come prima.
function sanitizeColumn(c) {
  const name = String(c?.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const type = c?.type || 'text';
  const col = {
    name,
    label: c?.label,
    type,
    required: c?.required || false,
    options: c?.options || [],
  };
  if (type === 'relation') {
    const targetEntity = c?.targetEntity || c?.target;
    if (targetEntity) col.targetEntity = String(targetEntity).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (c?.displayField) col.displayField = String(c.displayField).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }
  if (type === 'state') {
    if (Array.isArray(c?.states) && c.states.length > 0) col.states = c.states.map(String);
    if (c?.allowedTransitions && typeof c.allowedTransitions === 'object') col.allowedTransitions = c.allowedTransitions;
  }
  return col;
}

// getClientCredentials e clientAuthMiddleware ora vivono in
// ../lib/client-auth.js (FASE 4B, Finding #6): prima erano una copia
// letterale di backend/routes/client-app.js (verificato con diff), qui
// consolidate in un'unica implementazione condivisa — stesso identico
// comportamento per i modi legacy/supabase già gestiti, più il ramo
// app_type='comandi_ai' che qui non era mai stato gestito (vedi report
// Finding #6 per l'analisi completa e perché è security-neutral).

// ─── CUSTOM TABLE SCHEMAS ─────────────────────────────────────────────────────

// GET /client/apps/:appId/custom-tables - List all custom table definitions
router.get('/client/apps/:appId/custom-tables', clientAuthMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_records')
      .select('*')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', '_custom_tables')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('GET custom-tables error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    // Ogni record ha: { id, data: { name, label, labelPlural, icon, color, columns: [{ name, type, label, required }] } }
    const tables = (data || []).map(r => ({
      id: r.id,
      ...(r.data || {}),
      _record_id: r.id,
    }));

    res.json({ tables, count: tables.length });
  } catch (err) {
    console.error('GET custom-tables exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /client/apps/:appId/custom-tables - Create a new custom table definition
router.post('/client/apps/:appId/custom-tables', clientAuthMiddleware, async (req, res) => {
  try {
    const { name, label, labelPlural, icon, color, columns } = req.body;

    if (!name || !label || !columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ error: 'name, label e columns (array) obbligatori' });
    }

    // Validazione: name deve essere alfanumerico lowercase
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!sanitizedName) {
      return res.status(400).json({ error: 'Nome tabella non valido' });
    }

    // Verifica che non esista già una tabella personalizzata con lo stesso nome
    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from('app_records')
      .select('id')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', '_custom_tables')
      .filter('data->>name', 'eq', sanitizedName);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: `Tabella "${sanitizedName}" già esistente` });
    }

    const sanitizedColumns = columns.map(sanitizeColumn);

    // Validazione relation server-side (Fase 2 — Generic Database Engine):
    // prima d'ora una colonna type:'relation' in una custom table non veniva
    // MAI validata — nessun controllo che targetEntity corrispondesse a
    // un'entità realmente esistente (schema.tables, adminPanel.entities, o
    // un'altra custom table di questa stessa app). La tabella che si sta
    // creando è inclusa tra le entità candidate (selfEntity) per permettere
    // una relation verso se stessa (es. "categoria padre").
    const existingEntities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const selfFields = sanitizedColumns.map(toCanonicalField);
    const entitiesByName = new Map(existingEntities.map((e) => [e.name, e]));
    entitiesByName.set(sanitizedName, { name: sanitizedName, fields: selfFields });
    const relationErrors = validateEntityFields(selfFields, entitiesByName);
    if (relationErrors.length > 0) {
      return res.status(400).json({ error: 'Relazione non valida', details: relationErrors });
    }

    // Salva la definizione della tabella come record in app_records con table_name='_custom_tables'
    const { data: record, error } = await supabase
      .from('app_records')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        table_name: '_custom_tables',
        data: {
          name: sanitizedName,
          label,
          labelPlural: labelPlural || label + 'i',
          icon: icon || 'default',
          color: color || '#8b5cf6',
          columns: sanitizedColumns,
        },
      })
      .select()
      .single();

    if (error) {
      console.error('POST custom-table error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ table: { id: record.id, ...(record.data || {}) } });
  } catch (err) {
    console.error('POST custom-table exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PUT /client/apps/:appId/custom-tables/:tableId - Update a custom table definition
router.put('/client/apps/:appId/custom-tables/:tableId', clientAuthMiddleware, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { label, labelPlural, icon, color, columns } = req.body;

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ error: 'columns (array) obbligatorio' });
    }

    const supabase = getSupabase();

    // Leggi il record esistente per mantenere il name
    const { data: existing } = await supabase
      .from('app_records')
      .select('data')
      .eq('id', tableId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Tabella personalizzata non trovata' });
    }

    const currentData = existing.data || {};
    const sanitizedColumns = columns.map(sanitizeColumn);
    const tableName = toId(currentData.name) || currentData.name;

    // Stessa validazione relation server-side del POST sopra, applicata qui
    // alla versione AGGIORNATA delle colonne (selfEntity con i nuovi campi,
    // non quelli salvati prima dell'update).
    const existingEntities = await loadAppEntities(supabase, req.appId, req.tenantId);
    const selfFields = sanitizedColumns.map(toCanonicalField);
    const entitiesByName = new Map(existingEntities.map((e) => [e.name, e]));
    entitiesByName.set(tableName, { name: tableName, fields: selfFields });
    const relationErrors = validateEntityFields(selfFields, entitiesByName);
    if (relationErrors.length > 0) {
      return res.status(400).json({ error: 'Relazione non valida', details: relationErrors });
    }

    const updatedData = {
      ...currentData,
      label: label || currentData.label,
      labelPlural: labelPlural || currentData.labelPlural,
      icon: icon || currentData.icon,
      color: color || currentData.color,
      columns: sanitizedColumns,
    };

    const { data: record, error } = await supabase
      .from('app_records')
      .update({ data: updatedData, updated_at: new Date().toISOString() })
      .eq('id', tableId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) {
      console.error('PUT custom-table error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ table: { id: record.id, ...(record.data || {}) } });
  } catch (err) {
    console.error('PUT custom-table exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /client/apps/:appId/custom-tables/:tableId - Delete a custom table AND all its records
router.delete('/client/apps/:appId/custom-tables/:tableId', clientAuthMiddleware, async (req, res) => {
  try {
    const { tableId } = req.params;
    const supabase = getSupabase();

    // Leggi la definizione per ottenere il nome della tabella
    const { data: tableDef } = await supabase
      .from('app_records')
      .select('data')
      .eq('id', tableId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .single();

    if (!tableDef) {
      return res.status(404).json({ error: 'Tabella personalizzata non trovata' });
    }

    const tableName = tableDef.data?.name;
    if (tableName) {
      // Elimina tutti i record associati a questa tabella personalizzata
      await supabase
        .from('app_records')
        .delete()
        .eq('app_id', req.appId)
        .eq('tenant_id', req.tenantId)
        .eq('table_name', `_custom_${tableName}`);
    }

    // Elimina la definizione della tabella
    const { error } = await supabase
      .from('app_records')
      .delete()
      .eq('id', tableId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId);

    if (error) {
      console.error('DELETE custom-table error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true, deletedTable: tableName });
  } catch (err) {
    console.error('DELETE custom-table exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /client/apps/:appId/entities - Entity Metadata unificato (Fase 2 —
// Generic Database Engine): stessa entità sia che provenga dallo schema
// fisso generato dall'AI (schema.tables/adminPanel.entities in apps.config)
// sia dalle custom table create qui sopra — vedi lib/entity-metadata.js.
// Sola lettura, additivo: nessun endpoint esistente cambia comportamento.
router.get('/client/apps/:appId/entities', clientAuthMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const entities = await loadAppEntities(supabase, req.appId, req.tenantId);
    res.json({ entities, count: entities.length });
  } catch (err) {
    console.error('GET entities exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// ─── CUSTOM TABLE RECORDS (CRUD dinamico) ─────────────────────────────────────

// GET /client/apps/:appId/custom-records/:customTableName
router.get('/client/apps/:appId/custom-records/:customTableName', clientAuthMiddleware, async (req, res) => {
  try {
    const { customTableName } = req.params;
    const sanitized = `_custom_${customTableName}`;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_records')
      .select('*')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', sanitized)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET custom-records error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ records: data || [], count: data?.length || 0 });
  } catch (err) {
    console.error('GET custom-records exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /client/apps/:appId/custom-records/:customTableName
router.post('/client/apps/:appId/custom-records/:customTableName', clientAuthMiddleware, async (req, res) => {
  try {
    const { customTableName } = req.params;
    const { data: recordData } = req.body;
    const sanitized = `_custom_${customTableName}`;

    if (!recordData) {
      return res.status(400).json({ error: 'data obbligatorio' });
    }

    const supabase = getSupabase();
    const { data: record, error } = await supabase
      .from('app_records')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        table_name: sanitized,
        data: recordData,
      })
      .select()
      .single();

    if (error) {
      console.error('POST custom-record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ record });
  } catch (err) {
    console.error('POST custom-record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PUT /client/apps/:appId/custom-records/:customTableName/:recordId
router.put('/client/apps/:appId/custom-records/:customTableName/:recordId', clientAuthMiddleware, async (req, res) => {
  try {
    const { recordId } = req.params;
    const { data: recordData } = req.body;

    if (!recordData) {
      return res.status(400).json({ error: 'data obbligatorio' });
    }

    const supabase = getSupabase();
    const { data: record, error } = await supabase
      .from('app_records')
      .update({ data: recordData, updated_at: new Date().toISOString() })
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    // PGRST116 ("Cannot coerce the result to a single JSON object") è quello
    // che Supabase/PostgREST restituisce quando .single() non trova nessuna
    // riga — cioè esattamente il caso recordId inesistente O appartenente a
    // un'altra app/tenant (isolamento: il filtro .eq(app_id)/.eq(tenant_id)
    // sopra lo esclude). Prima di questo fix, quel caso finiva nel branch
    // "errore interno" (500) invece di "non trovato" (404): l'isolamento
    // teneva comunque (nessuna scrittura cross-app avveniva), ma lo status
    // HTTP era fuorviante — scoperto dal test Fase 2 "isolamento app" (vedi
    // scripts/entity_engine_test.js).
    if (error && error.code !== 'PGRST116') {
      console.error('PUT custom-record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    if (!record) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    res.json({ record });
  } catch (err) {
    console.error('PUT custom-record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /client/apps/:appId/custom-records/:customTableName/:recordId
router.delete('/client/apps/:appId/custom-records/:customTableName/:recordId', clientAuthMiddleware, async (req, res) => {
  try {
    const { recordId } = req.params;
    const supabase = getSupabase();

    const { error } = await supabase
      .from('app_records')
      .delete()
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId);

    if (error) {
      console.error('DELETE custom-record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE custom-record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

module.exports = router;