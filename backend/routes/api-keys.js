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

const { generateApiKey } = require('../lib/api-key-crypto');
const { loadExportData, streamExportZip } = require('../lib/data-export');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

const ALLOWED_SCOPES = ['read', 'write'];

function sanitizeScopes(rawScopes) {
  if (!Array.isArray(rawScopes) || rawScopes.length === 0) return ['read'];
  const cleaned = [...new Set(rawScopes.filter((s) => ALLOWED_SCOPES.includes(s)))];
  return cleaned.length > 0 ? cleaned : ['read'];
}

// Non espone mai key_hash — solo i metadati necessari alla dashboard.
function toPublicKey(row) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status: row.revoked_at ? 'revoked' : (row.expires_at && new Date(row.expires_at) < new Date() ? 'expired' : 'active'),
  };
}

// GET /api/apps/:appId/api-keys — elenco chiavi (Fase 10).
router.get('/apps/:appId/api-keys', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_api_keys')
      .select('id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api-keys] GET list error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.json({ keys: (data || []).map(toPublicKey) });
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
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ error: 'name obbligatorio' });
    }

    let expiresAtIso = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expiresAt non valido' });
      }
      expiresAtIso = d.toISOString();
    }

    const sanitizedScopes = sanitizeScopes(scopes);
    const { fullKey, keyPrefix, keyHash } = generateApiKey();

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_api_keys')
      .insert({
        app_id: req.appId,
        tenant_id: req.tenantId,
        name: trimmedName,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes: sanitizedScopes,
        expires_at: expiresAtIso,
      })
      .select('id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
      .single();

    if (error) {
      console.error('[api-keys] POST create error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    res.status(201).json({ apiKey: fullKey, key: toPublicKey(data) });
  } catch (err) {
    console.error('[api-keys] POST create exception:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/apps/:appId/api-keys/:keyId/revoke — revoca (Fase 10).
router.post('/apps/:appId/api-keys/:keyId/revoke', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('app_api_keys')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.keyId)
      .eq('app_id', req.appId)
      .eq('tenant_id', req.tenantId)
      .select('id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at')
      .maybeSingle();

    if (error) {
      console.error('[api-keys] POST revoke error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }
    if (!data) {
      return res.status(404).json({ error: 'API key non trovata' });
    }

    res.json({ key: toPublicKey(data) });
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
