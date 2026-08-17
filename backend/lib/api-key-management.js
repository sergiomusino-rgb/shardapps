// ─── Data Export + Public API — logica CRUD delle API key (lato proprietario) ─
// Estratto da routes/api-keys.js (fix produzione 2026-08-17) per essere
// testabile con un fake supabase (vedi api-key-management.test.js), stesso
// principio già applicato a resolveApiKey/authorizeKeyForApp in
// lib/public-api-auth.js: le route Express restano thin wrapper che
// chiamano queste funzioni pure rispetto a Express (prendono `supabase`
// come parametro, non `req`/`res`), nessun cambio di comportamento rispetto
// al codice precedente — stesse query, stesse colonne, stessi status HTTP.

const { generateApiKey } = require('./api-key-crypto');

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

const SELECT_COLUMNS = 'id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at';

// Elenco chiavi di un'app — filtro doppio app_id+tenant_id, MAI solo uno dei
// due: è questo doppio filtro (non un controllo applicativo separato) che
// garantisce l'isolamento tenant/app a livello di query (vedi test
// "tenant isolation").
async function listApiKeys(supabase, appId, tenantId) {
  const { data, error } = await supabase
    .from('app_api_keys')
    .select(SELECT_COLUMNS)
    .eq('app_id', appId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, status: 500, error: 'Errore interno' };
  return { ok: true, keys: (data || []).map(toPublicKey) };
}

// Crea una nuova chiave. Ritorna la chiave completa in chiaro SOLO qui,
// nella risposta di questa singola chiamata — mai salvata (solo
// key_hash/key_prefix vengono scritti su DB) e mai loggata (vedi
// api-key-crypto.js per la generazione).
async function createApiKey(supabase, { appId, tenantId, name, scopes, expiresAt }) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return { ok: false, status: 400, error: 'name obbligatorio' };

  let expiresAtIso = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return { ok: false, status: 400, error: 'expiresAt non valido' };
    expiresAtIso = d.toISOString();
  }

  const sanitizedScopes = sanitizeScopes(scopes);
  const { fullKey, keyPrefix, keyHash } = generateApiKey();

  const { data, error } = await supabase
    .from('app_api_keys')
    .insert({
      app_id: appId,
      tenant_id: tenantId,
      name: trimmedName,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: sanitizedScopes,
      expires_at: expiresAtIso,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) return { ok: false, status: 500, error: 'Errore interno' };
  return { ok: true, apiKey: fullKey, key: toPublicKey(data) };
}

// Revoca — stesso doppio filtro app_id/tenant_id di listApiKeys: una
// richiesta di revoca non può mai colpire una chiave di un'altra app/tenant,
// anche conoscendone l'id esatto (query semplicemente non trova la riga).
async function revokeApiKey(supabase, { appId, tenantId, keyId }) {
  const { data, error } = await supabase
    .from('app_api_keys')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('app_id', appId)
    .eq('tenant_id', tenantId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: 'Errore interno' };
  if (!data) return { ok: false, status: 404, error: 'API key non trovata' };
  return { ok: true, key: toPublicKey(data) };
}

module.exports = {
  ALLOWED_SCOPES,
  sanitizeScopes,
  toPublicKey,
  listApiKeys,
  createApiKey,
  revokeApiKey,
};
