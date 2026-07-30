const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const csv = require('csv-parser');
const { stringify } = require('csv-stringify/sync');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Le credenziali client vivono ormai in app_credentials (mai esposta alla
// Data API pubblica, vedi 20260808000004_app_credentials_table.sql):
// apps.client_password/initial_password restano popolate solo come
// fallback finché la migration di pulizia finale non le azzera.
async function getClientCredentials(supabase, appId, fallback) {
  const { data } = await supabase
    .from('app_credentials')
    .select('client_password, initial_password')
    .eq('app_id', appId)
    .maybeSingle();

  return {
    client_password: data?.client_password ?? fallback?.client_password ?? null,
    initial_password: data?.initial_password ?? fallback?.initial_password ?? null,
  };
}

async function setClientPassword(supabase, appId, clientPassword, initialPassword) {
  const payload = { app_id: appId, updated_at: new Date().toISOString() };
  if (clientPassword !== undefined) payload.client_password = clientPassword;
  if (initialPassword !== undefined) payload.initial_password = initialPassword;

  const { error } = await supabase.from('app_credentials').upsert(payload, { onConflict: 'app_id' });
  if (error) throw error;

  // Dual-write sulla colonna legacy per compatibilità con eventuale codice
  // non ancora aggiornato, finché la pulizia finale non la azzera.
  const legacyUpdate = { updated_at: new Date().toISOString() };
  if (clientPassword !== undefined) legacyUpdate.client_password = clientPassword;
  if (initialPassword !== undefined) legacyUpdate.initial_password = initialPassword;
  await supabase.from('apps').update(legacyUpdate).eq('id', appId);
}

// POST /a/:slug - Client login with password
// Supporta sia slug che totalum_app_id come identificatore
router.post('/a/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password richiesta' });
    }

    const supabase = getSupabase();

    // Find app by slug OR totalum_app_id (per supportare URL come /a/pizzeria)
    // Prima cerca per slug, poi per totalum_app_id come fallback
    let { data: app, error } = await supabase
      .from('apps')
      .select('*')
      .eq('slug', slug)
      .single();

    // Se non trovata per slug, cerca per totalum_app_id
    if (error || !app) {
      const { data: appByTotalum, error: totalumError } = await supabase
        .from('apps')
        .select('*')
        .eq('totalum_app_id', slug)
        .single();
      
      app = appByTotalum;
      error = totalumError;
    }

    if (error || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    // Check if blocked
    if (app.client_active === false) {
      return res.json({ blocked: true });
    }

    // Check expiry
    if (app.expires_at && new Date(app.expires_at) < new Date()) {
      return res.json({ blocked: true });
    }

    // Check password
    const creds = await getClientCredentials(supabase, app.id, app);
    if (creds.client_password !== password) {
      return res.status(401).json({ error: 'Password errata' });
    }

    // Return app info with blueprint/config
    const appConfig = app.config || {};
    
    console.log('[/api/a/:slug] app.id:', app.id);
    console.log('[/api/a/:slug] appConfig keys:', Object.keys(appConfig));
    console.log('[/api/a/:slug] appConfig.schema:', appConfig.schema);
    console.log('[/api/a/:slug] appConfig.blueprint:', appConfig.blueprint);
    
    // Estrai le tabelle dal blueprint salvato (usa il primo array non vuoto)
    const tables = (appConfig.schema?.tables?.length ? appConfig.schema.tables : null)
      || (appConfig.blueprint?.schema?.tables?.length ? appConfig.blueprint.schema.tables : null)
      || (appConfig.tables?.length ? appConfig.tables : []);
    
    console.log('[/api/a/:slug] tables extracted:', tables.length, tables);
    
    const appInfo = {
      id: app.id,
      slug: app.slug,
      appName: app.name,
      blueprint: {
        ...appConfig,
        schema: { tables },
      },
      branding: {
        company_name: appConfig.appName || app.name,
        primary_color: appConfig.branding?.primary_color || appConfig.ui?.primaryColor || '#6366f1',
        logo_url: appConfig.branding?.logo_url || appConfig.logo || '',
        theme: appConfig.branding?.theme || 'dark',
      },
    };

    return res.json({ appInfo });
  } catch (err) {
    console.error('[/api/a/:slug] error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Client auth middleware - dual-mode:
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
  const creds = await getClientCredentials(supabase, app.id, app);
  if (creds.client_password !== token) {
    return res.status(401).json({ error: 'Password errata' });
  }

  req.tenantId = app.tenant_id;
  req.appId = appId;
  req.clientPassword = token;
  next();
}

// GET /client/apps/:appId/records?table=clients
router.get('/client/apps/:appId/records', clientAuthMiddleware, async (req, res) => {
  try {
    const { table } = req.query;
    if (!table) {
      return res.status(400).json({ error: 'Parametro table obbligatorio' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_records')
      .select('*')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', table)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET client records error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ records: data || [], count: data?.length || 0 });
  } catch (err) {
    console.error('GET client records exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /client/apps/:appId/records
router.post('/client/apps/:appId/records', clientAuthMiddleware, async (req, res) => {
  try {
    const { table, data } = req.body;
    if (!table || !data) {
      return res.status(400).json({ error: 'table e data obbligatori' });
    }

    const supabase = getSupabase();
    const { data: record, error } = await supabase
      .from('app_records')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        table_name: table,
        data: data,
      })
      .select()
      .single();

    if (error) {
      console.error('POST client record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ record });
  } catch (err) {
    console.error('POST client record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PUT /client/apps/:appId/records/:recordId
router.put('/client/apps/:appId/records/:recordId', clientAuthMiddleware, async (req, res) => {
  try {
    const { recordId } = req.params;
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'data obbligatorio' });
    }

    const supabase = getSupabase();
    const { data: record, error } = await supabase
      .from('app_records')
      .update({ data: data, updated_at: new Date().toISOString() })
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) {
      console.error('PUT client record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    if (!record) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    res.json({ record });
  } catch (err) {
    console.error('PUT client record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /client/apps/:appId/records/:recordId
router.delete('/client/apps/:appId/records/:recordId', clientAuthMiddleware, async (req, res) => {
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
      console.error('DELETE client record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE client record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/client/apps/:appId/import
router.post('/client/apps/:appId/import', clientAuthMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { table } = req.body;
    if (!table || !req.file) {
      return res.status(400).json({ error: 'table e file obbligatori' });
    }

    const records = [];
    const parser = req.file.buffer.pipe(csv());

    for await (const row of parser) {
      records.push(row);
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'File CSV vuoto' });
    }

    const supabase = getSupabase();
    const insertData = records.map(row => ({
      app_id: req.appId,
      tenant_id: req.tenantId,
      table_name: table,
      data: row,
    }));

    const { data, error } = await supabase
      .from('app_records')
      .insert(insertData)
      .select();

    if (error) {
      console.error('Import error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ imported: data?.length || 0 });
  } catch (err) {
    console.error('Import exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PUT /client/apps/:appId/tables/:tableName - Update a table definition in the app config
router.put('/client/apps/:appId/tables/:tableName', clientAuthMiddleware, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { name, label, labelPlural, fields } = req.body;

    if (!fields || !Array.isArray(fields)) {
      return res.status(400).json({ error: 'fields (array) obbligatorio' });
    }

    const supabase = getSupabase();

    // Leggi app config corrente
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('config')
      .eq('id', req.appId)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    const config = app.config || {};
    const tables = (config.schema?.tables?.length ? config.schema.tables : null)
      || (config.blueprint?.schema?.tables?.length ? config.blueprint.schema.tables : null)
      || (config.tables?.length ? config.tables : [])
      || [];

    // Trova e aggiorna la tabella
    const tableIndex = tables.findIndex((t) => t.name === tableName);
    if (tableIndex === -1) {
      return res.status(404).json({ error: 'Tabella non trovata' });
    }

    // Aggiorna i campi della tabella
    tables[tableIndex] = {
      ...tables[tableIndex],
      ...(name && name !== tableName ? { name } : {}),
      ...(label ? { label } : {}),
      ...(labelPlural ? { labelPlural } : {}),
      fields: fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type || 'text',
        required: f.required || false,
        options: f.options || [],
        fixed: f.fixed !== undefined ? f.fixed : true,
      })),
    };

    // Determina dove salvare: in schema.tables (priorità 1)
    let updatedConfig;
    if (config.schema?.tables) {
      updatedConfig = { ...config, schema: { ...config.schema, tables } };
    } else if (config.blueprint?.schema?.tables) {
      updatedConfig = { ...config, blueprint: { ...config.blueprint, schema: { ...config.blueprint.schema, tables } } };
    } else {
      updatedConfig = { ...config, tables };
    }

    const { error: updateError } = await supabase
      .from('apps')
      .update({ config: updatedConfig, updated_at: new Date().toISOString() })
      .eq('id', req.appId);

    if (updateError) {
      console.error('PUT table-def error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, table: tables[tableIndex] });
  } catch (err) {
    console.error('PUT table-def exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Whitelist dei campi scalari di businessConfig (site-schema.ts, motore Sito/
// PWA Creator v2): stessa difesa già usata in PUT tables/:tableName qui sopra,
// non fidarsi del body per evitare che il client scriva chiavi arbitrarie in
// apps.config.
const BUSINESS_CONFIG_STRING_FIELDS = [
  'name', 'logoUrl', 'heroImageUrl', 'tagline', 'description', 'address', 'whatsapp', 'phone', 'email',
];

function sanitizeBusinessConfigPatch(body) {
  const patch = {};
  for (const key of BUSINESS_CONFIG_STRING_FIELDS) {
    if (body[key] !== undefined) {
      patch[key] = body[key] == null ? '' : String(body[key]);
    }
  }
  if (Array.isArray(body.openingHours)) {
    patch.openingHours = body.openingHours
      .filter((h) => h && typeof h === 'object')
      .map((h) => ({ day: String(h.day ?? ''), hours: String(h.hours ?? '') }));
  }
  return patch;
}

// PUT /client/apps/:appId/business-config - Aggiorna config.businessConfig
// (motore Sito/PWA Creator v2, vedi frontend/src/lib/site-schema.ts) dal
// pannello /gestionale: stesso pattern read-merge-write già usato sopra per
// le tabelle, mantiene sincronizzati sito pubblico e gestionale perché
// entrambi leggono lo stesso apps.config.
router.put('/client/apps/:appId/business-config', clientAuthMiddleware, async (req, res) => {
  try {
    const patch = sanitizeBusinessConfigPatch(req.body || {});
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nessun campo valido da aggiornare' });
    }

    const supabase = getSupabase();
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('config')
      .eq('id', req.appId)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    const config = app.config || {};
    const businessConfig = { ...(config.businessConfig || {}), ...patch };
    const updatedConfig = { ...config, businessConfig };

    const { error: updateError } = await supabase
      .from('apps')
      .update({ config: updatedConfig, updated_at: new Date().toISOString() })
      .eq('id', req.appId);

    if (updateError) {
      console.error('PUT business-config error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, businessConfig });
  } catch (err) {
    console.error('PUT business-config exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/client/apps/:appId/export?table=clients
router.get('/client/apps/:appId/export', clientAuthMiddleware, async (req, res) => {
  try {
    const { table } = req.query;
    if (!table) {
      return res.status(400).json({ error: 'Parametro table obbligatorio' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_records')
      .select('data')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', table)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Export query error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Nessun record da esportare' });
    }

    const flatData = data.map(row => row.data);
    const csvOutput = stringify(flatData, { header: true });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${table}-export.csv`);
    res.send(csvOutput);
  } catch (err) {
    console.error('Export exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Helper: Find app by slug or totalum_app_id
async function findAppBySlugOrTotalum(supabase, identifier) {
  const SELECT_FIELDS = 'id, slug, totalum_app_id, config, client_password, auth_mode, tenant_id, app_type';
  // Prima cerca per slug, poi per totalum_app_id come fallback
  let { data: app, error } = await supabase
    .from('apps')
    .select(SELECT_FIELDS)
    .eq('slug', identifier)
    .single();

  if (error || !app) {
    const { data: appByTotalum, error: totalumError } = await supabase
      .from('apps')
      .select(SELECT_FIELDS)
      .eq('totalum_app_id', identifier)
      .single();

    app = appByTotalum;
    error = totalumError;
  }

  return { app, error };
}

// Verifica che il Bearer token autentichi davvero il titolare di `app` prima
// di lasciare scrivere sui suoi dati (branding, credenziali...): stesso
// schema dual-mode di clientAuthMiddleware (password in chiaro per le app
// legacy, JWT Supabase + membership per le nuove), ma per slug invece che
// per appId (queste route non passano da clientAuthMiddleware).
async function verifyClientAuth(supabase, app, req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return false;

  // Comandi AI: gli operatori sono membri del tenant proprietario
  // (tenant_members), non di app_users — stesso schema del gate in
  // frontend/app/a/[slug]/layout.tsx.
  if (app.app_type === 'comandi_ai') {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return false;

    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', app.tenant_id)
      .maybeSingle();
    return !!membership;
  }

  if (app.auth_mode === 'supabase') {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return false;

    const { data: appUser } = await supabase
      .from('app_users')
      .select('id')
      .eq('user_id', user.id)
      .eq('app_id', app.id)
      .eq('is_active', true)
      .maybeSingle();
    return !!appUser;
  }

  const creds = await getClientCredentials(supabase, app.id, app);
  return creds.client_password === token;
}

// POST /a/:slug/settings - Save admin settings (branding)
// Supporta sia slug che totalum_app_id come identificatore
router.post('/a/:slug/settings', async (req, res) => {
  try {
    const { slug } = req.params;
    const { branding } = req.body;

    if (!branding) {
      return res.status(400).json({ error: 'branding obbligatorio' });
    }

    const supabase = getSupabase();

    // Find app by slug or totalum_app_id
    const { app, error: appError } = await findAppBySlugOrTotalum(supabase, slug);

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    if (!(await verifyClientAuth(supabase, app, req))) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }

    // Get current config and update branding
    const config = app.config || {};
    const updatedConfig = {
      ...config,
      branding: {
        ...config.branding,
        ...branding,
      },
    };

    // Update app config
    const { error: updateError } = await supabase
      .from('apps')
      .update({ 
        config: updatedConfig,
        updated_at: new Date().toISOString() 
      })
      .eq('id', app.id);

    if (updateError) {
      console.error('Save settings error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, message: 'Impostazioni salvate con successo' });
  } catch (err) {
    console.error('Save settings exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /a/:slug/change-password - Change client password
// Supporta sia slug che totalum_app_id come identificatore
router.post('/a/:slug/change-password', async (req, res) => {
  try {
    const { slug } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Password vecchia e nuova richieste' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nuova password deve avere almeno 6 caratteri' });
    }

    const supabase = getSupabase();

    // Find app by slug or totalum_app_id
    const { app, error: appError } = await findAppBySlugOrTotalum(supabase, slug);

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    // Verify old password
    const creds = await getClientCredentials(supabase, app.id, app);
    if (creds.client_password !== oldPassword) {
      return res.status(401).json({ error: 'Password attuale errata' });
    }

    // Update password
    try {
      await setClientPassword(supabase, app.id, newPassword, undefined);
    } catch (updateError) {
      console.error('Change password error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, message: 'Password cambiata con successo' });
  } catch (err) {
    console.error('Change password exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

module.exports = router;