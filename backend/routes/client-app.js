const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const csv = require('csv-parser');
const { stringify } = require('csv-stringify/sync');
const Groq = require('groq-sdk');
const { aiLimiter, loginLimiter, changePasswordLimiter, actionLimiter, userManagementLimiter } = require('../middleware/rate-limit');
const {
  getClientCredentials,
  getRbacCredential,
  verifyLegacyPassword,
  resolveClientIdentity,
  clientAuthMiddleware,
} = require('../lib/client-auth');
const { dispatchAppAction } = require('../lib/action-dispatcher');

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

// getClientCredentials ora vive in ../lib/client-auth.js (FASE 4B, Finding
// #6): stessa identica logica, prima duplicata qui e in custom-tables.js.

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
// FASE 4B, Finding #5: loginLimiter dedicato (IP+slug) contro il brute-force
// della password condivisa dell'app, vedi middleware/rate-limit.js.
router.post('/a/:slug', loginLimiter, async (req, res) => {
  try {
    const { slug } = req.params;
    const { password, email } = req.body;

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

    // Check credentials: auth_mode='rbac' verifica email+password contro
    // app_rbac_users (più utenti per app, ciascuno col proprio ruolo, vedi
    // migration 20260812000000); altrimenti (legacy, e supabase se mai
    // richiamasse questo endpoint) stesso confronto storico contro la
    // password condivisa dell'app — comportamento invariato.
    let role;
    let rbacAuthToken;
    if (app.auth_mode === 'rbac') {
      if (!email) {
        return res.status(400).json({ error: 'Email richiesta per questa app' });
      }
      const credential = await getRbacCredential(supabase, app.id, email);
      if (!credential || credential.client_password !== password) {
        return res.status(401).json({ error: 'Credenziali errate' });
      }
      role = credential.role;
      // Token composito per le richieste dati successive (stesso formato
      // atteso da resolveClientIdentity in lib/client-auth.js): il frontend
      // lo salva al posto della sola password come Bearer.
      rbacAuthToken = `${credential.client_email}:${password}`;
    } else {
      const creds = await getClientCredentials(supabase, app.id, app);
      if (creds.client_password !== password) {
        return res.status(401).json({ error: 'Password errata' });
      }
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

    // role/authToken presenti SOLO per auth_mode='rbac': la risposta per le
    // app legacy/supabase resta identica a prima, nessun campo in più.
    if (app.auth_mode === 'rbac') {
      return res.json({ appInfo, role, authToken: rbacAuthToken });
    }
    return res.json({ appInfo });
  } catch (err) {
    console.error('[/api/a/:slug] error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// clientAuthMiddleware ora vive in ../lib/client-auth.js (FASE 4B, Finding
// #6): stessa identica logica dual-mode (legacy/supabase) prima duplicata
// qui e in custom-tables.js, più il ramo app_type='comandi_ai' che qui non
// era mai stato gestito (vedi report Finding #6 per l'analisi completa).

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

// FASE 3 — CreatorAI: ruolo 'viewer' (auth_mode='rbac'/'supabase', vedi
// clientAuthMiddleware) è sola lettura sui dati delle entità — nessun
// concetto di ruolo per le app legacy (req.appUserRole resta undefined lì),
// quindi questo guard non le tocca in alcun modo.
function requireWriteRole(req, res) {
  if (req.appUserRole === 'viewer') {
    res.status(403).json({ error: 'Il tuo ruolo (viewer) consente solo la lettura dei dati' });
    return false;
  }
  return true;
}

// POST /client/apps/:appId/records
router.post('/client/apps/:appId/records', clientAuthMiddleware, async (req, res) => {
  try {
    if (!requireWriteRole(req, res)) return;
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
    if (!requireWriteRole(req, res)) return;
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
    if (!requireWriteRole(req, res)) return;
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

// ─── FASE 3 — CreatorAI: esecuzione azioni di entità ────────────────────────
// POST /client/apps/:appId/records/:recordId/actions/:actionId
// Body: { table } — nome dell'entità (table_name di app_records), l'azione
// stessa vive nella config dell'app (adminPanel.entities[].actions, vedi
// site-schema.ts), non nel record. Unico punto che applica insieme:
// - enforcement del ruolo (requiredRole dell'azione, gerarchia admin>operator,
//   mai concesso a 'viewer');
// - validazione della transizione di stato (field.allowedTransitions) per le
//   azioni "change_state", l'unico tipo con un effetto reale oggi.
// "trigger_webhook"/"send_notification" (Fase 4): dispatchate tramite
// backend/lib/action-dispatcher.js — una POST asincrona verso action.webhookUrl
// se configurato (altrimenti solo registrate) per i webhook, un log
// strutturato pronto per un provider futuro (Resend/Novu) per le notifiche.
// Non più un 501: entrambe rispondono 200 con { dispatched, actionType }.
//
// Security Audit Fase 4 (fix HIGH/WARNING):
// - actionLimiter: 40 richieste/minuto per app+IP (era senza alcun rate
//   limit, sfruttabile sia per DoS interno sia — combinato con un webhookUrl
//   — come proxy di HTTP flood verso terzi, vedi lib/ssrf-guard.js per la
//   parte SSRF del fix).
// - Verifica di esistenza/appartenenza del record ora eseguita PRIMA del
//   branch per tipo, quindi anche per trigger_webhook/send_notification
//   (prima solo change_state la faceva): un'azione non può più essere
//   invocata su un recordId arbitrario/inesistente.
router.post('/client/apps/:appId/records/:recordId/actions/:actionId', clientAuthMiddleware, actionLimiter, async (req, res) => {
  try {
    const { recordId, actionId } = req.params;
    const { table } = req.body;
    if (!table) {
      return res.status(400).json({ error: 'table obbligatorio' });
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

    const entities = app.config?.adminPanel?.entities || [];
    const entity = entities.find((e) => e.name === table);
    const action = entity?.actions?.find((a) => a.id === actionId);
    if (!entity || !action) {
      return res.status(404).json({ error: 'Azione non trovata' });
    }

    // Enforcement ruolo: le azioni sono mutazioni, mai concesse a 'viewer'
    // nemmeno senza requiredRole esplicito sull'azione. req.appUserRole è
    // undefined per le app legacy (nessun concetto di ruolo): in quel caso
    // chiunque sia autenticato (l'unico accesso possibile, la password
    // condivisa) può eseguire l'azione — comportamento invariato, mai
    // regredito da "poteva farlo" a "non può più".
    if (req.appUserRole === 'viewer') {
      return res.status(403).json({ error: 'Il tuo ruolo (viewer) non consente di eseguire azioni' });
    }
    if (action.requiredRole === 'admin' && req.appUserRole && req.appUserRole !== 'admin') {
      return res.status(403).json({ error: 'Azione riservata al ruolo amministratore' });
    }

    // Il record deve esistere e appartenere a questa app/tenant/entità PRIMA
    // di eseguire qualunque tipo di azione — vale ora anche per
    // trigger_webhook/send_notification (fix Security Audit Fase 4, Focus 2:
    // prima un recordId arbitrario/inesistente veniva accettato per questi
    // due tipi, l'unica verifica di ownership era su change_state).
    const { data: record, error: recordError } = await supabase
      .from('app_records')
      .select('id, data')
      .eq('id', recordId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .eq('table_name', table)
      .single();
    if (recordError || !record) {
      return res.status(404).json({ error: 'Record non trovato' });
    }

    if (action.type === 'trigger_webhook' || action.type === 'send_notification') {
      const result = await dispatchAppAction(supabase, {
        appId: req.appId,
        tenantId: req.tenantId,
        recordId,
        entity: table,
        action,
        // Attribution (Security Audit Fase 4, Focus 5): chi ha eseguito
        // l'azione, salvato in app_action_logs — mai nel payload esterno.
        actorRole: req.appUserRole,
        actorEmail: req.appUserEmail,
      });
      return res.json({ success: true, dispatched: result.dispatched, actionType: action.type });
    }

    // type === 'change_state' (unico altro valore ammesso da EntityActionSchema)
    const stateField = entity.fields?.find((f) => f.type === 'state');
    if (!stateField || !action.targetState) {
      return res.status(400).json({ error: 'Azione non configurata correttamente' });
    }

    const currentState = record.data?.[stateField.id];
    const allowed = stateField.allowedTransitions;
    // Nessuna allowedTransitions configurata = tutte le transizioni tra gli
    // `states` del campo sono ammesse (stessa convenzione di
    // resolveEntityStatesAndActions, frontend/src/lib/site-schema.ts). Stato
    // corrente assente/non riconosciuto: nessun vincolo da applicare, il
    // record non ha ancora un valore di stato valido da cui partire.
    if (allowed && currentState && allowed[currentState] && !allowed[currentState].includes(action.targetState)) {
      return res.status(409).json({ error: `Transizione non ammessa da "${currentState}" a "${action.targetState}"` });
    }

    const updatedData = { ...(record.data || {}), [stateField.id]: action.targetState };
    const { data: updated, error: updateError } = await supabase
      .from('app_records')
      .update({ data: updatedData, updated_at: new Date().toISOString() })
      .eq('id', recordId)
      .select()
      .single();

    if (updateError) {
      console.error('POST client record action error:', updateError);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ record: updated });
  } catch (err) {
    console.error('POST client record action exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// ─── FASE 4 — CreatorAI: gestione utenti (app auth_mode='rbac') ────────────
// GET/POST/DELETE /client/apps/:appId/users — pannello "Gestione Team" del
// pannello admin (frontend/app/a/[slug]/app/UserManagementModal.tsx). Solo
// per app auth_mode='rbac' (req.authMode, valorizzato da clientAuthMiddleware
// in lib/client-auth.js) e solo per chi è già autenticato come 'admin' di
// quella stessa app — mai un endpoint di provisioning "aperto". POST/DELETE
// (le mutazioni) hanno anche userManagementLimiter (Security Audit Fase 4,
// fix HIGH): richiedono già credenziali admin valide, ma restavano prive di
// qualunque limite di frequenza.
function requireAdminRbac(req, res) {
  if (req.authMode !== 'rbac') {
    res.status(400).json({ error: 'Questa app non usa l\'autenticazione multi-utente (auth_mode rbac)' });
    return false;
  }
  if (req.appUserRole !== 'admin') {
    res.status(403).json({ error: 'Solo un amministratore può gestire gli utenti dell\'app' });
    return false;
  }
  return true;
}

// GET /client/apps/:appId/users — elenco utenti (mai la password).
router.get('/client/apps/:appId/users', clientAuthMiddleware, async (req, res) => {
  try {
    if (!requireAdminRbac(req, res)) return;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_rbac_users')
      .select('id, client_email, role, created_at')
      .eq('app_id', req.appId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('GET client users error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ users: data || [] });
  } catch (err) {
    console.error('GET client users exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /client/apps/:appId/users — crea un nuovo utente operator/viewer.
// L'admin sceglie direttamente email+password (stesso modello "credenziale
// assegnata dal titolare", non un invito/onboarding self-service — coerente
// con lo stesso approccio già usato per l'utente admin seedato al primo
// publish, vedi app/api/creator/publish/route.ts).
router.post('/client/apps/:appId/users', clientAuthMiddleware, userManagementLimiter, async (req, res) => {
  try {
    if (!requireAdminRbac(req, res)) return;

    const { email, password, role } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Email non valida' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
    }
    // Solo operator/viewer da questo endpoint: un secondo admin si crea
    // comunque così (nessun vincolo tecnico), ma la UI (UserManagementModal)
    // offre solo questi due ruoli nel form — coerente col requisito Fase 4
    // ("ruolo ('operator' | 'viewer')"), un secondo admin è una scelta
    // deliberata da esporre in un secondo momento, non un default implicito.
    if (role !== 'operator' && role !== 'viewer') {
      return res.status(400).json({ error: 'Ruolo non valido: usa "operator" o "viewer"' });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_rbac_users')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        client_email: cleanEmail,
        client_password: password,
        role,
      })
      .select('id, client_email, role, created_at')
      .single();

    if (error) {
      // Vincolo unico (app_id, lower(client_email)), vedi migration
      // 20260812000000: un'email già usata su questa stessa app.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Esiste già un utente con questa email su questa app' });
      }
      console.error('POST client users error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ user: data });
  } catch (err) {
    console.error('POST client users exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /client/apps/:appId/users/:userId — revoca un utente.
router.delete('/client/apps/:appId/users/:userId', clientAuthMiddleware, userManagementLimiter, async (req, res) => {
  try {
    if (!requireAdminRbac(req, res)) return;
    const { userId } = req.params;

    const supabase = getSupabase();
    const { data: target, error: fetchError } = await supabase
      .from('app_rbac_users')
      .select('id, role')
      .eq('id', userId)
      .eq('app_id', req.appId)
      .maybeSingle();

    if (fetchError) {
      console.error('DELETE client users lookup error:', fetchError);
      return res.status(500).json({ error: 'Errore interno' });
    }
    if (!target) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }

    // Mai eliminare l'ultimo admin: nessuno potrebbe più gestire l'app
    // (né riautenticarsi come admin, né aggiungere un nuovo admin) — stessa
    // logica difensiva di "non lasciare l'app senza titolare".
    if (target.role === 'admin') {
      const { count, error: countError } = await supabase
        .from('app_rbac_users')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', req.appId)
        .eq('role', 'admin');
      if (countError) {
        console.error('DELETE client users admin-count error:', countError);
        return res.status(500).json({ error: 'Errore interno' });
      }
      if ((count || 0) <= 1) {
        return res.status(403).json({ error: 'Impossibile eliminare l\'unico amministratore dell\'app' });
      }
    }

    const { error: deleteError } = await supabase
      .from('app_rbac_users')
      .delete()
      .eq('id', userId)
      .eq('app_id', req.appId);

    if (deleteError) {
      console.error('DELETE client users error:', deleteError);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE client users exception:', err);
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

// Whitelist + validazione dei campi di paymentSettings (modulo pagamenti
// opzionale Plug & Play): stessa difesa di sanitizeBusinessConfigPatch qui
// sopra, non fidarsi del body. Nessuna secret key qui: solo un Payment Link
// pubblico e, se serve in futuro a un checkout embedded, la publishable key
// (pk_...) — mai la secret key di Stripe, che resta esclusivamente nel
// dashboard Stripe del tenant finale e non transita mai da ShardApps.
function sanitizePaymentSettingsPatch(body) {
  const patch = {};
  if (typeof body.enabled === 'boolean') {
    patch.enabled = body.enabled;
  }
  if (body.stripeLink !== undefined) {
    const link = String(body.stripeLink || '').trim();
    if (link && !/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(link)) {
      throw Object.assign(new Error('Il link deve essere un Payment Link Stripe valido (https://buy.stripe.com/...)'), { status: 400 });
    }
    patch.stripeLink = link;
  }
  if (body.stripePublicKey !== undefined) {
    const key = String(body.stripePublicKey || '').trim();
    if (key && !/^pk_(test|live)_/.test(key)) {
      throw Object.assign(new Error('La chiave pubblica Stripe deve iniziare con pk_test_ o pk_live_'), { status: 400 });
    }
    patch.stripePublicKey = key;
  }
  return patch;
}

// PUT /client/apps/:appId/payment-settings - Attiva/configura i pagamenti
// online opzionali del tenant finale (config.paymentSettings). Modulo
// "Plug & Play": ogni app collega il proprio Payment Link Stripe, ShardApps non
// vede né gestisce mai le transazioni. Stesso pattern read-merge-write di
// business-config qui sopra, così sito pubblico e gestionale restano
// sincronizzati sullo stesso apps.config.
router.put('/client/apps/:appId/payment-settings', clientAuthMiddleware, async (req, res) => {
  let patch;
  try {
    patch = sanitizePaymentSettingsPatch(req.body || {});
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nessun campo valido da aggiornare' });
  }

  try {
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
    const paymentSettings = { ...(config.paymentSettings || {}), ...patch };
    const updatedConfig = { ...config, paymentSettings };

    const { error: updateError } = await supabase
      .from('apps')
      .update({ config: updatedConfig, updated_at: new Date().toISOString() })
      .eq('id', req.appId);

    if (updateError) {
      console.error('PUT payment-settings error:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true, paymentSettings });
  } catch (err) {
    console.error('PUT payment-settings exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// Ricava l'elenco tabelle/entità dell'app, a prescindere dal motore che le ha
// generate (vecchio motore tabellare blueprint-schema.ts o Creator v2
// site-schema.ts): stessa normalizzazione già usata lato frontend in
// app/a/[slug]/app/page.tsx (adaptAdminEntitiesToTables), qui ridotta ai soli
// campi utili per il contesto della chat (niente id/opzioni superflue).
function extractTablesForChatContext(config) {
  const tables = (config.schema?.tables?.length ? config.schema.tables : null)
    || (config.blueprint?.schema?.tables?.length ? config.blueprint.schema.tables : null)
    || (config.tables?.length ? config.tables : null)
    || (config.adminPanel?.entities?.length
      ? config.adminPanel.entities.map((e) => ({
          name: e.name,
          label: e.label,
          labelPlural: e.labelPlural,
          fields: (e.fields || [])
            .filter((f) => f.type !== 'id')
            .map((f) => ({ label: f.label, type: f.type })),
        }))
      : null)
    || [];
  return tables;
}

// Dati azienda per il system prompt: businessConfig (Creator v2) se presente,
// altrimenti branding legacy — stessa priorità già usata in getSaveSettings
// e nel pannello frontend per company_name/logo.
function extractBusinessInfo(config, appName) {
  const bc = config.businessConfig || config.blueprint?.businessConfig || null;
  if (bc) {
    return {
      name: bc.name || appName,
      address: bc.address || '',
      phone: bc.phone || '',
      whatsapp: bc.whatsapp || '',
      email: bc.email || '',
      openingHours: Array.isArray(bc.openingHours) ? bc.openingHours : [],
    };
  }
  return {
    name: config.branding?.company_name || config.appName || appName,
    address: '', phone: '', whatsapp: '', email: '', openingHours: [],
  };
}

function buildChatSystemPrompt(businessInfo, tables) {
  const tablesDesc = tables.length
    ? tables.map((t) => `- ${t.labelPlural || t.label} (${t.name}): campi ${
        (t.fields || []).map((f) => f.label).filter(Boolean).join(', ') || 'nessuno'
      }`).join('\n')
    : 'Nessuna tabella configurata.';

  const orari = businessInfo.openingHours.length
    ? businessInfo.openingHours.map((h) => `${h.day}: ${h.hours}`).join(', ')
    : 'non specificati';

  return `Sei l'assistente operativo del gestionale di "${businessInfo.name}".
Aiuti l'utente che gestisce l'app a: consultare i dati disponibili, preparare bozze di comunicazioni per i clienti (email, messaggi WhatsApp), rispondere a domande su contatti, orari e listini.

Dati attività:
- Nome: ${businessInfo.name}
- Indirizzo: ${businessInfo.address || 'non specificato'}
- Telefono: ${businessInfo.phone || 'non specificato'}
- WhatsApp: ${businessInfo.whatsapp || 'non specificato'}
- Email: ${businessInfo.email || 'non specificata'}
- Orari: ${orari}

Sezioni/tabelle disponibili nel gestionale:
${tablesDesc}

Regole:
- Rispondi sempre in italiano, in modo chiaro, utile e conciso.
- Non puoi modificare lo schema dell'app, le tabelle o i dati da qui: se richiesto, spiega che serve l'editor Creator o la relativa sezione del gestionale.
- Se ti mancano dati specifici che non hai nel contesto (es. un record preciso non elencato), dillo esplicitamente invece di inventare numeri o dettagli.`;
}

// POST /client/apps/:appId/chat - Assistente operativo del gestionale (Groq)
// Contesto: businessConfig/branding + struttura tabelle sempre, più un
// campione recente (max 30) della tabella attualmente aperta lato client
// (activeTable) — non l'intero dataset, per restare "ultra-veloce e low-cost"
// come richiesto: Groq (llama-3.1-8b-instant di default) invece di
// OpenRouter/Claude usato per la generazione schema, coerente con l'uso già
// esistente di Groq per i task rapidi (vedi comandi-voice-extraction.ts).
router.post('/client/apps/:appId/chat', clientAuthMiddleware, aiLimiter, async (req, res) => {
  try {
    const { messages, activeTable } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages (array) obbligatorio' });
    }

    // Non fidarsi del body: whitelist di ruolo/tipo e limite di cronologia/
    // lunghezza, sia per sicurezza (niente iniezione di un secondo "system")
    // sia per contenere token e costo per messaggio.
    const safeMessages = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (safeMessages.length === 0) {
      return res.status(400).json({ error: 'Nessun messaggio valido' });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY non configurata' });
    }

    const supabase = getSupabase();
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('name, config')
      .eq('id', req.appId)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    const config = app.config || {};
    const tables = extractTablesForChatContext(config);
    const businessInfo = extractBusinessInfo(config, app.name);
    const systemPrompt = buildChatSystemPrompt(businessInfo, tables);

    const contextMessages = [{ role: 'system', content: systemPrompt }];

    if (typeof activeTable === 'string' && tables.some((t) => t.name === activeTable)) {
      const { data: records } = await supabase
        .from('app_records')
        .select('data')
        .eq('app_id', req.appId)
        .eq('tenant_id', req.tenantId)
        .eq('table_name', activeTable)
        .order('created_at', { ascending: false })
        .limit(30);

      if (records && records.length > 0) {
        contextMessages.push({
          role: 'system',
          content: `Alcuni record recenti della sezione "${activeTable}" (max 30, dati reali, usali per rispondere a domande su listini/contatti/quantità):\n${JSON.stringify(records.map((r) => r.data))}`,
        });
      }
    }

    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant',
      messages: [...contextMessages, ...safeMessages],
      temperature: 0.4,
      max_tokens: 800,
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('POST chat exception:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Errore interno' });
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
// legacy, JWT Supabase + membership per le nuove, JWT+tenant_members per
// comandi_ai), ma per slug invece che per appId (queste route non passano da
// clientAuthMiddleware). FASE 4B, Finding #6: ora delega a
// resolveClientIdentity (../lib/client-auth.js) per i controlli veri e
// propri — stessa identica logica di prima, solo condivisa. Comportamento
// invariato: resta un booleano, nessun controllo client_active/expires_at
// qui (mai stato presente, preservato così com'era).
async function verifyClientAuth(supabase, app, req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return false;

  const result = await resolveClientIdentity(supabase, app, app.id, token);
  return result.ok;
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
// FASE 4B, Finding #5: changePasswordLimiter dedicato (IP+slug) contro
// tentativi automatizzati ripetuti, vedi middleware/rate-limit.js. Minimo
// password portato da 6 a 8 caratteri: riguarda solo le nuove password
// impostate qui, non tocca password già esistenti.
router.post('/a/:slug/change-password', changePasswordLimiter, async (req, res) => {
  try {
    const { slug } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Password vecchia e nuova richieste' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
    }

    const supabase = getSupabase();

    // Find app by slug or totalum_app_id
    const { app, error: appError } = await findAppBySlugOrTotalum(supabase, slug);

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    // Verify old password. FASE 4B, Finding #6: usa verifyLegacyPassword
    // condivisa (../lib/client-auth.js), stessa identica logica di prima.
    // Resta legacy-only, invariato: nessun Bearer/JWT qui (la prova di
    // possesso è la vecchia password nel body), quindi nessun branching per
    // auth_mode/app_type — vedi report Finding #6 per il perché.
    if (!(await verifyLegacyPassword(supabase, app, oldPassword))) {
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