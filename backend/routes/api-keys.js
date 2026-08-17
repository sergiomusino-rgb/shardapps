// ─── Data Export + Public API — gestione API key (lato proprietario) ───────
// Route autenticate con il JWT Supabase del proprietario/reseller (stesso
// schema di autenticazione di routes/app-records.js: verifica token +
// membership del tenant), usate dalla dashboard "Settings → Data & API"
// dell'app per creare/elencare/revocare le API key e per l'export completo.
// Non hanno nulla a che fare con lib/public-api-auth.js (quello autentica
// CHI USA una API key verso /api/v1/..., questo file autentica il
// PROPRIETARIO che le gestisce).
//
// authMiddleware/tenantMiddleware sono una copia intenzionale (non un
// require) di quelli già presenti in routes/app-records.js: stesso identico
// comportamento, duplicati qui per non toccare un file di autenticazione
// esistente (istruzione esplicita del task: non modificare l'autenticazione
// esistente se non strettamente necessario). Se in futuro si consolidano in
// un modulo condiviso, deve restare un refactor security-neutral verificato
// come già fatto per lib/client-auth.js (vedi commento in testa a quel file).

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const { loadExportData, streamExportZip } = require('../lib/data-export');
const { listApiKeys, createApiKey, revokeApiKey } = require('../lib/api-key-management');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// ─── Fix produzione 2026-08-17 (E2E live test) ─────────────────────────────
// Causa reale (stack trace Render): "Error: supabaseKey is required" in
// `new SupabaseClient` — la createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)
// che c'era qui prima falliva perché process.env.SUPABASE_ANON_KEY risultava
// vuoto/assente in questo processo, e la chiamata era FUORI dal try/catch
// sottostante (throw sincrono dentro una funzione async = Promise rejected
// non gestita → Express 5 la inoltra al suo error handler generico, da cui
// il 500 "Errore interno del server" invece di un 401 pulito).
//
// Fix minimo: niente nuovo client con l'anon key. supabase.auth.getUser(jwt)
// accetta il token esplicitamente come argomento e verifica la sua firma
// contro il server Auth di Supabase indipendentemente dalla chiave con cui
// il client è stato istanziato — riusa quindi getSupabase() (service role),
// già provato affidabile in questo stesso file (tenantMiddleware, sotto, non
// ha mai fallito). Non introduce alcuna chiave nuova, non tocca RLS: questa
// chiamata è solo verifica del JWT lato Auth, non una query dati.
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }

  const token = authHeader.substring(7);

  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token non valido' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH-API-KEYS] Errore durante validazione:', error.message);
    return res.status(401).json({ error: 'Errore autenticazione' });
  }
}

async function tenantMiddleware(req, res, next) {
  const { appId } = req.params;
  const supabaseAdmin = getSupabase();

  const { data: appData, error: appError } = await supabaseAdmin
    .from('apps')
    .select('id, tenant_id')
    .eq('id', appId)
    .single();

  if (appError || !appData) {
    return res.status(404).json({ error: 'App non trovata' });
  }

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

// GET /api/apps/:appId/api-keys — elenco chiavi (Fase 10).
router.get('/apps/:appId/api-keys', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const result = await listApiKeys(getSupabase(), req.appId, req.tenantId);
    if (!result.ok) {
      console.error('[api-keys] GET list error');
      return res.status(result.status).json({ error: result.error });
    }
    res.json({ keys: result.keys });
  } catch (err) {
    console.error('[api-keys] GET list exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/apps/:appId/api-keys — crea una nuova chiave (Fase 2/7). La
// chiave completa viene restituita SOLO in questa risposta (mai più
// recuperabile in seguito) — nessun log stampa `fullKey`.
router.post('/apps/:appId/api-keys', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { name, scopes, expiresAt } = req.body || {};
    const result = await createApiKey(getSupabase(), { appId: req.appId, tenantId: req.tenantId, name, scopes, expiresAt });
    if (!result.ok) {
      if (result.status >= 500) console.error('[api-keys] POST create error');
      return res.status(result.status).json({ error: result.error });
    }
    res.status(201).json({ apiKey: result.apiKey, key: result.key });
  } catch (err) {
    console.error('[api-keys] POST create exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/apps/:appId/api-keys/:keyId/revoke — revoca (Fase 10).
router.post('/apps/:appId/api-keys/:keyId/revoke', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const result = await revokeApiKey(getSupabase(), { appId: req.appId, tenantId: req.tenantId, keyId: req.params.keyId });
    if (!result.ok) {
      if (result.status >= 500) console.error('[api-keys] POST revoke error');
      return res.status(result.status).json({ error: result.error });
    }
    res.json({ key: result.key });
  } catch (err) {
    console.error('[api-keys] POST revoke exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/apps/:appId/export-all — export ZIP completo lato proprietario
// (Fase 9/10), stesso motore usato dalla Public API dietro API key
// (routes/public-api.js GET .../export) — un'unica implementazione in
// lib/data-export.js, due punti di ingresso con autenticazione diversa.
router.get('/apps/:appId/export-all', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const result = await loadExportData(supabase, req.appId, req.tenantId);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    streamExportZip(res, result);
  } catch (err) {
    console.error('[api-keys] GET export-all exception:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Errore interno' });
    } else {
      res.end();
    }
  }
});

module.exports = router;
