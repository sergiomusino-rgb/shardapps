// ─── Test di isolamento entità della Public API (Data Export + Public API, ──
// Fase 12, casi #12/#13/#14) ─────────────────────────────────────────────
// routes/public-api.js non accetta MAI un nome di tabella arbitrario: ogni
// endpoint risolve prima l'entità con findEntity() (lib/entity-metadata.js)
// contro l'elenco REALE delle entità dell'app, e usa solo
// entity.recordTableName (mai l'input utente) per interrogare app_records.
// Questo file testa esattamente quella garanzia con lib/entity-metadata.js
// pura (stesso principio di entity-metadata.test.js), senza Express/rete —
// il test suite del backend non gira route Express reali (vedi package.json
// "test": non usa supertest), quindi la sicurezza è verificata al livello
// della funzione che le route usano davvero per decidere "questa entità
// esiste?".

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildEntityList, findEntity } = require('./entity-metadata');

// Stessa forma di config/customTableDefs prodotta da un'app reale: due
// entità legittime, una dal motore a schema fisso e una custom table.
const config = {
  schema: { tables: [{ name: 'clienti', label: 'Cliente', fields: [{ id: 'nome', type: 'text' }] }] },
};
const customTableDefs = [
  { id: 'rec-1', data: { name: 'ordini', label: 'Ordine', columns: [{ name: 'totale', type: 'number' }] } },
];

const entities = buildEntityList(config, customTableDefs, { appId: 'app-A', tenantId: 'tenant-A' });

describe('#12 entità inesistente -> nessun match (la route risponde 404)', () => {
  test('nome che non corrisponde a nessuna entità reale', () => {
    assert.equal(findEntity(entities, 'non_esiste'), undefined);
  });
});

describe('#13/#14 tentativi di path/SQL injection e accesso a tabelle interne', () => {
  const maliciousNames = [
    "'; DROP TABLE app_records; --",
    '../../etc/passwd',
    '_custom_tables', // tabella interna che ospita le DEFINIZIONI delle custom table
    'app_records',
    'app_api_keys',
    'apps',
    '_custom_ordini/../../clienti',
    'clienti OR 1=1',
    '',
    null,
    undefined,
  ];

  for (const name of maliciousNames) {
    test(`findEntity("${String(name)}") non risolve mai a un'entità reale`, () => {
      const result = findEntity(entities, name);
      assert.equal(result, undefined);
    });
  }

  test('le uniche entità risolvibili sono esattamente quelle dello schema/custom-table reali dell\'app', () => {
    assert.equal(findEntity(entities, 'clienti')?.recordTableName, 'clienti');
    assert.equal(findEntity(entities, 'ordini')?.recordTableName, '_custom_ordini');
    // Nessuna entità ha mai recordTableName uguale a una tabella interna
    // ShardApps (app_api_keys/app_credentials/apps/_custom_tables stesso).
    const internalTables = new Set(['app_api_keys', 'app_credentials', 'apps', '_custom_tables', 'tenant_members']);
    for (const e of entities) {
      assert.equal(internalTables.has(e.recordTableName), false);
    }
  });
});
