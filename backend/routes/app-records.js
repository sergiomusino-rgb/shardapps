const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const csv = require('csv-parser');
const { stringify } = require('csv-stringify/sync');
const stream = require('stream');
const XLSX = require('xlsx');

// Nessun limite di dimensione prima permetteva a un tenant autenticato di
// caricare un file arbitrariamente grande (tenuto interamente in memoria,
// poi decompresso da XLSX.read) per esaurire l'heap del processo Node e
// mandare in DoS il backend per tutti i tenant.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Middleware autenticazione
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[AUTH-APP-RECORDS] Header Authorization mancante o non in formato Bearer');
    return res.status(401).json({ error: 'Token mancante' });
  }

  const token = authHeader.substring(7);

  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      console.error('[AUTH-APP-RECORDS] Errore validazione token:', error.message);
      return res.status(401).json({ error: 'Token non valido' });
    }
    
    if (!user) {
      console.error('[AUTH-APP-RECORDS] Utente non trovato nel token');
      return res.status(401).json({ error: 'Token non valido' });
    }
    
    console.log('[AUTH-APP-RECORDS] Utente autenticato:', user.id);
    req.user = user;
    req.supabase = supabase;
    next();
  } catch (error) {
    console.error('[AUTH-APP-RECORDS] Errore durante validazione:', error.message);
    console.error('[AUTH-APP-RECORDS] Stack:', error.stack);
    return res.status(401).json({ error: 'Errore autenticazione' });
  }
}

// Middleware verifica membership tenant
async function tenantMiddleware(req, res, next) {
  const { appId } = req.params;
  const supabaseAdmin = getSupabase();

  // Recupera app e verifica esista
  const { data: appData, error: appError } = await supabaseAdmin
    .from('apps')
    .select('id, tenant_id')
    .eq('id', appId)
    .single();

  if (appError || !appData) {
    return res.status(404).json({ error: 'App non trovata' });
  }

  // Verifica utente sia membro del tenant
  const { data: membership, error: memberError } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('tenant_id', appData.tenant_id)
    .eq('user_id', req.user.id)
    .single();

  if (memberError || !membership) {
    return res.status(403).json({ error: 'Non autorizzato per questo tenant' });
  }

  req.tenantId = appData.tenant_id;
  req.appId = appId;
  next();
}

// POST /api/apps - Crea nuova app
router.post('/apps', authMiddleware, async (req, res) => {
  try {
    const { sector, name, prompt, logo } = req.body;
    console.log('[CreateApp] Ricevuta richiesta:', { sector, name, hasPrompt: !!prompt, hasLogo: !!logo });
    
    if (!sector || !name) {
      return res.status(400).json({ error: 'Settore e nome obbligatori' });
    }

    const supabaseAdmin = getSupabase();
    console.log('[CreateApp] Supabase admin creato');
    
    // Recupera tenant dell'utente
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', req.user.id)
      .limit(1)
      .single();

    console.log('[CreateApp] Membership query:', { memberError, hasMembership: !!membership });

    if (memberError || !membership) {
      return res.status(403).json({ error: 'Nessun tenant associato' });
    }

    const tenantId = membership.tenant_id;
    console.log('[CreateApp] Tenant ID:', tenantId);
    
    // Recupera blueprint dal settore
    const { data: blueprint, error: blueprintError } = await supabaseAdmin
      .from('blueprints')
      .select('*')
      .eq('sector', sector)
      .single();

    console.log('[CreateApp] Blueprint query:', { blueprintError, hasBlueprint: !!blueprint });

    if (blueprintError || !blueprint) {
      return res.status(404).json({ error: 'Settore non trovato' });
    }

    // Verifica limite app per il tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('app_limit, plan, total_apps_created')
      .eq('id', tenantId)
      .single();

    console.log('[CreateApp] Tenant query:', { tenantError, hasTenant: !!tenant });

    if (tenantError || !tenant) {
      return res.status(404).json({ error: 'Tenant non trovato' });
    }

    // Conta app attive del tenant
    const { count, error: countError } = await supabaseAdmin
      .from('apps')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    console.log('[CreateApp] Count query:', { count, countError });

    if (countError) {
      console.error('Count apps error:', countError);
      return res.status(500).json({ error: 'Errore verifica limite app' });
    }

    if (count !== null && count >= tenant.app_limit) {
      return res.status(403).json({ 
        error: 'UpgradeToProRequired',
        message: 'Hai raggiunto il limite di app. Esegui l\'upgrade per continuare.'
      });
    }

    // Genera slug univoco
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    
    // Genera password casuale per accesso client
    const clientPassword = Math.random().toString(36).slice(-8);

    // Costruisci config con blueprint
    const config = {
      schema: blueprint.schema,
      ui: blueprint.ui_config,
      blueprint: {
        sector,
        name: blueprint.display_name,
        description: blueprint.description,
      },
      appName: name,
      logo: logo || '',
      prompt: prompt || '',
    };

    console.log('[CreateApp] Blueprint schema tables:', blueprint.schema?.tables?.length || 0);
    console.log('[CreateApp] Config schema tables:', config.schema?.tables?.length || 0);

    // Crea app
    console.log('[CreateApp] Inserimento app nel database...');
    const { data: app, error: appError } = await supabaseAdmin
      .from('apps')
      .insert({
        tenant_id: tenantId,
        blueprint_id: blueprint.id,
        name,
        slug,
        config,
        client_password: clientPassword,
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        is_active: true,
      })
      .select()
      .single();

    console.log('[CreateApp] Insert result:', { appError, hasApp: !!app });

    if (appError) {
      console.error('[CreateApp] Errore inserimento:', appError);
      return res.status(500).json({ error: appError.message || 'Errore creazione app' });
    }

    console.log(`[CreateApp] App creata: ${app.id} per tenant ${tenantId}`);

    // Credenziali anche in app_credentials (mai esposta alla Data API
    // pubblica, vedi 20260808000004_app_credentials_table.sql); dual-write
    // su apps.client_password sopra mantenuto per compatibilità.
    await supabaseAdmin
      .from('app_credentials')
      .upsert({ app_id: app.id, client_password: clientPassword }, { onConflict: 'app_id' });

    // Incrementa contatore totale app create
    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({ 
        total_apps_created: (tenant.total_apps_created || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId);
    
    if (updateError) {
      console.error('[CreateApp] Errore aggiornamento contatore:', updateError);
    } else {
      console.log(`[CreateApp] Contatore aggiornato: ${(tenant.total_apps_created || 0) + 1}`);
    }
    
    res.status(201).json({ 
      app,
      clientPassword,
      accessUrl: `${process.env.APP_URL || 'https://zeusxapps.com'}/a/${slug}`
    });
  } catch (err) {
    console.error('Create app exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/apps/:appId/records?table=clients
router.get('/apps/:appId/records', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { table } = req.query;
    if (!table) {
      return res.status(400).json({ error: 'Parametro table obbligatorio' });
    }

    const supabaseAdmin = getSupabase();
    const { data, error } = await supabaseAdmin
      .from('app_records')
      .select('*')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', table)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET records error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ records: data || [], count: data?.length || 0 });
  } catch (err) {
    console.error('GET records exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/apps/:appId/records
router.post('/apps/:appId/records', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { table, data } = req.body;
    if (!table || !data) {
      return res.status(400).json({ error: 'table e data obbligatori' });
    }

    const supabaseAdmin = getSupabase();
    const { data: record, error } = await supabaseAdmin
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
      console.error('POST record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ record });
  } catch (err) {
    console.error('POST record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PUT /api/apps/:appId/records/:recordId
router.put('/apps/:appId/records/:recordId', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { recordId } = req.params;
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'data obbligatorio' });
    }

    const supabaseAdmin = getSupabase();
    const { data: record, error } = await supabaseAdmin
      .from('app_records')
      .update({ data: data, updated_at: new Date().toISOString() })
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) {
      console.error('PUT record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    if (!record) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    res.json({ record });
  } catch (err) {
    console.error('PUT record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /api/apps/:appId/records/:recordId
router.delete('/apps/:appId/records/:recordId', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { recordId } = req.params;
    const supabaseAdmin = getSupabase();

    const { error } = await supabaseAdmin
      .from('app_records')
      .delete()
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId);

    if (error) {
      console.error('DELETE record error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE record exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/apps/:appId/import
router.post('/apps/:appId/import', authMiddleware, tenantMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { table } = req.body;
    if (!table || !req.file) {
      return res.status(400).json({ error: 'table e file obbligatori' });
    }

    const fileName = req.file.originalname.toLowerCase();
    let records = [];

    if (fileName.endsWith('.csv')) {
      const { Readable } = require('stream');
      const bufferStream = Readable.from(req.file.buffer);
      const parser = bufferStream.pipe(csv());
      for await (const row of parser) {
        records.push(row);
      }
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(firstSheet);
    } else {
      return res.status(400).json({ error: 'Formato file non supportato. Usa CSV o Excel (.xlsx, .xls)' });
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'File vuoto' });
    }

    const supabaseAdmin = getSupabase();
    const insertData = records.map(row => ({
      app_id: req.appId,
      tenant_id: req.tenantId,
      table_name: table,
      data: row,
    }));

    const { data, error } = await supabaseAdmin
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

// GET /api/apps/:appId/export?table=clients
router.get('/apps/:appId/export', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { table } = req.query;
    if (!table) {
      return res.status(400).json({ error: 'Parametro table obbligatorio' });
    }

    const supabaseAdmin = getSupabase();
    const { data, error } = await supabaseAdmin
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

    // Un valore di record che inizia con =/+/-/@ verrebbe interpretato come
    // formula da Excel/Sheets all'apertura del CSV esportato (CSV/formula
    // injection): lo si neutralizza anteponendo un apice, che lo forza a testo.
    const sanitizeCsvValue = (value) => {
      if (typeof value !== 'string') return value;
      return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    };
    const flatData = data.map(row => {
      const sanitized = {};
      for (const [key, value] of Object.entries(row.data || {})) {
        sanitized[key] = sanitizeCsvValue(value);
      }
      return sanitized;
    });
    const csvOutput = stringify(flatData, { header: true });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${table}-export.csv`);
    res.send(csvOutput);
  } catch (err) {
    console.error('Export exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

module.exports = router;
