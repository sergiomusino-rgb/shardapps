const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Client auth middleware (copiato da routes/client-app.js) - dual-mode:
// - auth_mode='legacy' (app esistenti): Bearer è la password in chiaro, invariato.
// - auth_mode='supabase' (nuove app): Bearer è un vero JWT Supabase Auth,
//   verificato con supabase.auth.getUser() + membership attiva su app_users.
async function clientAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticazione mancante' });
  }

  const token = authHeader.substring(7);
  const { appId } = req.params;

  const supabase = getSupabase();

  const { data: app, error } = await supabase
    .from('apps')
    .select('id, tenant_id, client_password, client_active, expires_at, auth_mode')
    .eq('id', appId)
    .single();

  if (error || !app) {
    return res.status(404).json({ error: 'App non trovata' });
  }

  if (app.client_active === false) {
    return res.status(403).json({ error: 'App bloccata' });
  }

  if (app.expires_at && new Date(app.expires_at) < new Date()) {
    return res.status(403).json({ error: 'App scaduta' });
  }

  if (app.auth_mode === 'supabase') {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('role, is_active')
      .eq('user_id', user.id)
      .eq('app_id', appId)
      .eq('is_active', true)
      .single();

    if (appUserError || !appUser) {
      return res.status(403).json({ error: 'Utente non autorizzato per questa app' });
    }

    req.tenantId = app.tenant_id;
    req.appId = appId;
    req.appUserRole = appUser.role;
    return next();
  }

  // Legacy: confronto password in chiaro, comportamento invariato
  if (app.client_password !== token) {
    return res.status(401).json({ error: 'Password errata' });
  }

  req.tenantId = app.tenant_id;
  req.appId = appId;
  req.clientPassword = token;
  next();
}

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
          columns: columns.map(c => ({
            name: c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
            label: c.label,
            type: c.type || 'text',
            required: c.required || false,
            options: c.options || [],
          })),
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
    const updatedData = {
      ...currentData,
      label: label || currentData.label,
      labelPlural: labelPlural || currentData.labelPlural,
      icon: icon || currentData.icon,
      color: color || currentData.color,
      columns: columns.map(c => ({
        name: c.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        label: c.label,
        type: c.type || 'text',
        required: c.required || false,
        options: c.options || [],
      })),
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

    if (error) {
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