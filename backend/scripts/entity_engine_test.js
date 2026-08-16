// ============================================================================
// ShardApps - FASE 2 (Generic Database Engine): test di integrazione live-DB
// ----------------------------------------------------------------------------
// Stesso pattern di e2e_lifecycle_test.js (dati taggati "e2e-entity-<RUN_ID>",
// cleanup in finally, credenziali reali da backend/.env), mirato invece alla
// route custom-tables.js — l'"entity builder runtime" formalizzato in questa
// fase — montata da sola su un piccolo server Express effimero (stessa
// configurazione di server.js: express.json() + prefisso /api), così il test
// esercita il vero middleware (clientAuthMiddleware) e le vere query Supabase,
// non un mock.
//
// Copre i requisiti della Fase 2 (report, punto 9):
// - creazione entità (custom table)
// - creazione / lettura / modifica / cancellazione record
// - relation valida / relation inesistente (validazione server-side nuova)
// - isolamento tenant (un token di un'altra app/tenant non vede i record)
// - isolamento app (stessa struttura, app diversa dello stesso tenant)
// - compatibilità con app legacy (nessuna migration: un'app con config
//   pre-Fase2, senza alcuna colonna relation/state, continua a funzionare)
//
// Uso: node scripts/entity_engine_test.js (o via `npm test`, auto-discovery
// di node --test sui file che finiscono per _test.js).
// ============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const RUN_ID = Date.now();
const TAG = `e2e-entity-${RUN_ID}`;
const TEST_EMAIL = `${TAG}@zeusx-test.local`;

let server;
let baseUrl;
const created = { authUserId: null, tenantId: null, tenant2Id: null, appIds: [] };

// ─── Setup: server effimero + tenant/app di test ────────────────────────────

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/custom-tables'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: `E2eTest!${RUN_ID}`,
    email_confirm: true,
  });
  if (userError || !userData?.user) throw new Error(`Creazione utente test fallita: ${userError?.message}`);
  created.authUserId = userData.user.id;

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ owner_id: created.authUserId, name: `${TAG}-tenant`, slug: `${TAG}-tenant`, plan: 'free', app_limit: 5 })
    .select('id')
    .single();
  if (tenantError || !tenant) throw new Error(`Creazione tenant fallita: ${tenantError?.message}`);
  created.tenantId = tenant.id;

  const { data: tenant2, error: tenant2Error } = await supabase
    .from('tenants')
    .insert({ owner_id: created.authUserId, name: `${TAG}-tenant2`, slug: `${TAG}-tenant2`, plan: 'free', app_limit: 5 })
    .select('id')
    .single();
  if (tenant2Error || !tenant2) throw new Error(`Creazione tenant2 fallita: ${tenant2Error?.message}`);
  created.tenant2Id = tenant2.id;

  await supabase.from('tenant_members').insert([
    { tenant_id: created.tenantId, user_id: created.authUserId, role: 'owner' },
    { tenant_id: created.tenant2Id, user_id: created.authUserId, role: 'owner' },
  ]);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  // Cleanup: app_records -> apps -> tenant_members -> tenants -> auth user.
  if (created.appIds.length > 0) {
    await supabase.from('app_records').delete().in('app_id', created.appIds);
    await supabase.from('apps').delete().in('id', created.appIds);
  }
  if (created.tenantId) {
    await supabase.from('tenant_members').delete().eq('tenant_id', created.tenantId);
    await supabase.from('tenants').delete().eq('id', created.tenantId);
  }
  if (created.tenant2Id) {
    await supabase.from('tenant_members').delete().eq('tenant_id', created.tenant2Id);
    await supabase.from('tenants').delete().eq('id', created.tenant2Id);
  }
  if (created.authUserId) await supabase.auth.admin.deleteUser(created.authUserId);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createApp({ tenantId, name, config, password }) {
  const { data: app, error } = await supabase
    .from('apps')
    .insert({
      tenant_id: tenantId,
      name,
      slug: `${TAG}-${name}`,
      config: config || {},
      client_password: password,
      auth_mode: 'legacy',
      is_active: true,
      client_active: true,
    })
    .select('id')
    .single();
  if (error || !app) throw new Error(`Creazione app "${name}" fallita: ${error?.message}`);
  created.appIds.push(app.id);
  return app.id;
}

function authedFetch(appId, password, path, options = {}) {
  return fetch(`${baseUrl}/client/apps/${appId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${password}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// ─── Test: creazione entità + relation valida/inesistente ──────────────────

test('creazione entità: relation con targetEntity inesistente viene rifiutata (400)', async () => {
  const appId = await createApp({ tenantId: created.tenantId, name: 'app-rel-invalid', password: 'pw1' });

  const res = await authedFetch(appId, 'pw1', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({
      name: 'prodotti',
      label: 'Prodotto',
      columns: [
        { name: 'nome', type: 'text', required: true },
        { name: 'categoria', type: 'relation', targetEntity: 'categoria_inesistente' },
      ],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Relazione non valida/);
});

test('creazione entità: relation con targetEntity valido viene accettata (201) e compare in GET /entities', async () => {
  const appId = await createApp({ tenantId: created.tenantId, name: 'app-rel-valid', password: 'pw1' });

  const catRes = await authedFetch(appId, 'pw1', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({ name: 'categorie', label: 'Categoria', columns: [{ name: 'nome', type: 'text', required: true }] }),
  });
  assert.equal(catRes.status, 201);

  const prodRes = await authedFetch(appId, 'pw1', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({
      name: 'prodotti',
      label: 'Prodotto',
      columns: [
        { name: 'nome', type: 'text', required: true },
        { name: 'categoria', type: 'relation', targetEntity: 'categorie', displayField: 'nome' },
      ],
    }),
  });
  assert.equal(prodRes.status, 201);
  const prodBody = await prodRes.json();
  assert.equal(prodBody.table.columns.find((c) => c.name === 'categoria').targetEntity, 'categorie');

  const entitiesRes = await authedFetch(appId, 'pw1', '/entities');
  assert.equal(entitiesRes.status, 200);
  const { entities } = await entitiesRes.json();
  const names = entities.map((e) => e.name).sort();
  assert.deepEqual(names, ['categorie', 'prodotti']);
  const relField = entities.find((e) => e.name === 'prodotti').fields.find((f) => f.id === 'categoria');
  assert.equal(relField.type, 'relation');
  assert.equal(relField.targetEntity, 'categorie');
});

// ─── Test: CRUD generico sui record ─────────────────────────────────────────

test('CRUD record: creazione, lettura, modifica, cancellazione su una custom table', async () => {
  const appId = await createApp({ tenantId: created.tenantId, name: 'app-crud', password: 'pw1' });
  await authedFetch(appId, 'pw1', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({ name: 'clienti', label: 'Cliente', columns: [{ name: 'nome', type: 'text', required: true }] }),
  });

  // Create
  const createRes = await authedFetch(appId, 'pw1', '/custom-records/clienti', {
    method: 'POST',
    body: JSON.stringify({ data: { nome: 'Mario Rossi' } }),
  });
  assert.equal(createRes.status, 201);
  const { record } = await createRes.json();
  assert.equal(record.data.nome, 'Mario Rossi');

  // Read (list)
  const listRes = await authedFetch(appId, 'pw1', '/custom-records/clienti');
  assert.equal(listRes.status, 200);
  const { records } = await listRes.json();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, record.id);

  // Update
  const updateRes = await authedFetch(appId, 'pw1', `/custom-records/clienti/${record.id}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { nome: 'Mario Bianchi' } }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.record.data.nome, 'Mario Bianchi');

  // Delete
  const deleteRes = await authedFetch(appId, 'pw1', `/custom-records/clienti/${record.id}`, { method: 'DELETE' });
  assert.equal(deleteRes.status, 200);

  const listAfterDelete = await authedFetch(appId, 'pw1', '/custom-records/clienti');
  const { records: recordsAfter } = await listAfterDelete.json();
  assert.equal(recordsAfter.length, 0);
});

// ─── Test: isolamento tenant/app ────────────────────────────────────────────

test('isolamento app: due app dello stesso tenant non condividono i record', async () => {
  const appA = await createApp({ tenantId: created.tenantId, name: 'app-isol-a', password: 'pwA' });
  const appB = await createApp({ tenantId: created.tenantId, name: 'app-isol-b', password: 'pwB' });

  await authedFetch(appA, 'pwA', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({ name: 'note', label: 'Nota', columns: [{ name: 'testo', type: 'text' }] }),
  });
  await authedFetch(appB, 'pwB', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({ name: 'note', label: 'Nota', columns: [{ name: 'testo', type: 'text' }] }),
  });

  const createRes = await authedFetch(appA, 'pwA', '/custom-records/note', {
    method: 'POST',
    body: JSON.stringify({ data: { testo: 'segreto di app A' } }),
  });
  assert.equal(createRes.status, 201);
  const { record } = await createRes.json();

  // App B (stesso tenant, credenziali proprie) non deve vedere il record di App A.
  const listB = await authedFetch(appB, 'pwB', '/custom-records/note');
  const { records: recordsB } = await listB.json();
  assert.equal(recordsB.length, 0);

  // Un tentativo di modificare il record di App A autenticato come App B fallisce (404: filtro app_id).
  const updateAsB = await authedFetch(appB, 'pwB', `/custom-records/note/${record.id}`, {
    method: 'PUT',
    body: JSON.stringify({ data: { testo: 'tentativo di modifica cross-app' } }),
  });
  assert.equal(updateAsB.status, 404);
});

test('isolamento tenant: un\'app di un tenant diverso non vede/non può alterare i record dell\'altro', async () => {
  const appTenant1 = await createApp({ tenantId: created.tenantId, name: 'app-t1', password: 'pwT1' });
  const appTenant2 = await createApp({ tenantId: created.tenant2Id, name: 'app-t2', password: 'pwT2' });

  await authedFetch(appTenant1, 'pwT1', '/custom-tables', {
    method: 'POST',
    body: JSON.stringify({ name: 'documenti', label: 'Documento', columns: [{ name: 'titolo', type: 'text' }] }),
  });
  const createRes = await authedFetch(appTenant1, 'pwT1', '/custom-records/documenti', {
    method: 'POST',
    body: JSON.stringify({ data: { titolo: 'riservato tenant 1' } }),
  });
  const { record } = await createRes.json();

  // App del tenant 2 non ha nemmeno la tabella "documenti" definita, ma anche
  // se provasse a leggerla direttamente per nome, il filtro app_id/tenant_id
  // la isola comunque (nessun record di un'altra app/tenant può comparire).
  const listT2 = await authedFetch(appTenant2, 'pwT2', '/custom-records/documenti');
  const { records: recordsT2 } = await listT2.json();
  assert.equal(recordsT2.length, 0);

  const deleteAsT2 = await authedFetch(appTenant2, 'pwT2', `/custom-records/documenti/${record.id}`, { method: 'DELETE' });
  assert.equal(deleteAsT2.status, 200); // risponde comunque 200 (nessun errore Supabase su 0 righe interessate)...
  // ...ma il record dell'altro tenant deve essere sopravvissuto, non è mai stato toccato.
  const stillThere = await authedFetch(appTenant1, 'pwT1', '/custom-records/documenti');
  const { records: recordsT1 } = await stillThere.json();
  assert.equal(recordsT1.length, 1);
  assert.equal(recordsT1[0].id, record.id);
});

// ─── Test: compatibilità con app legacy (pre-Fase 2, senza migration) ───────

test('compatibilità legacy: un\'app con solo config.schema.tables (nessuna custom table, nessuna relation) continua a funzionare su GET /entities', async () => {
  const legacyConfig = {
    schema: { tables: [{ name: 'pazienti', label: 'Paziente', fields: [{ id: 'cognome', type: 'text', required: true }] }] },
  };
  const appId = await createApp({ tenantId: created.tenantId, name: 'app-legacy', config: legacyConfig, password: 'pwLegacy' });

  const res = await authedFetch(appId, 'pwLegacy', '/entities');
  assert.equal(res.status, 200);
  const { entities } = await res.json();
  assert.equal(entities.length, 1);
  assert.equal(entities[0].name, 'pazienti');
  assert.equal(entities[0].source, 'schema');

  // Le route esistenti (custom-tables list) restano utilizzabili e vuote,
  // nessuna eccezione per l'assenza di '_custom_tables'.
  const tablesRes = await authedFetch(appId, 'pwLegacy', '/custom-tables');
  assert.equal(tablesRes.status, 200);
  const { tables } = await tablesRes.json();
  assert.deepEqual(tables, []);
});
