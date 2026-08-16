// ─── FASE 2 — Generic Database Engine: test unitari puri (nessuna rete/DB) ──
// Stesso principio di check_rls_policies.test.js/ssrf-guard.test.js: logica
// pura testata con dati finti, nessuna dipendenza da un progetto Supabase
// reale — copre la normalizzazione dei campi/entità e la validazione delle
// relation richieste dalla Fase 2 (report, requisito 3 e 9).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  toId,
  toCanonicalField,
  entitiesFromSchemaTables,
  entitiesFromAdminPanel,
  entitiesFromCustomTables,
  buildEntityList,
  findEntity,
  validateRelationTarget,
  validateEntityFields,
} = require('./entity-metadata');

describe('toId', () => {
  test('normalizza in minuscolo/snake_case, con fallback se vuoto', () => {
    assert.equal(toId('Clienti VIP'), 'clienti_vip');
    assert.equal(toId(''), '');
    assert.equal(toId(null, 'fallback'), 'fallback');
  });
});

describe('toCanonicalField', () => {
  test('normalizza un field del motore a schema fisso (id-based)', () => {
    const f = toCanonicalField({ id: 'Nome Cliente', type: 'TEXT', label: 'Nome', required: true });
    assert.equal(f.id, 'nome_cliente');
    assert.equal(f.type, 'text');
    assert.equal(f.required, true);
  });

  test('normalizza una custom-table column (name-based) con le stesse chiavi', () => {
    const f = toCanonicalField({ name: 'prezzo', type: 'number', label: 'Prezzo' });
    assert.equal(f.id, 'prezzo');
    assert.equal(f.type, 'number');
    assert.equal(f.required, false);
  });

  test('sincronizza target/targetEntity e targetLabel/displayField in entrambe le direzioni', () => {
    const f1 = toCanonicalField({ id: 'categoria', type: 'relation', target: 'categorie', targetLabel: 'nome' });
    assert.equal(f1.targetEntity, 'categorie');
    assert.equal(f1.displayField, 'nome');

    const f2 = toCanonicalField({ id: 'categoria', type: 'relation', targetEntity: 'categorie', displayField: 'nome' });
    assert.equal(f2.target, 'categorie');
    assert.equal(f2.targetLabel, 'nome');
  });

  test('states/allowedTransitions passano solo se presenti e ben formati', () => {
    const withState = toCanonicalField({ id: 'stato', type: 'state', states: ['bozza', 'inviato'], allowedTransitions: { bozza: ['inviato'] } });
    assert.deepEqual(withState.states, ['bozza', 'inviato']);
    assert.deepEqual(withState.allowedTransitions, { bozza: ['inviato'] });

    const noState = toCanonicalField({ id: 'stato', type: 'state' });
    assert.equal(noState.states, undefined);
    assert.equal(noState.allowedTransitions, undefined);
  });
});

describe('entitiesFromSchemaTables / entitiesFromAdminPanel / entitiesFromCustomTables', () => {
  test('mappano ciascuna provenienza nella stessa forma canonica', () => {
    const schema = entitiesFromSchemaTables([{ name: 'clienti', label: 'Cliente', fields: [{ id: 'nome', type: 'text' }] }]);
    assert.equal(schema[0].source, 'schema');
    assert.equal(schema[0].recordTableName, 'clienti');

    const adminPanel = entitiesFromAdminPanel([{ name: 'prenotazioni', label: 'Prenotazione', fields: [{ id: 'data', type: 'date' }] }]);
    assert.equal(adminPanel[0].source, 'admin_panel');

    const custom = entitiesFromCustomTables([{ id: 'rec-1', data: { name: 'fornitori', label: 'Fornitore', columns: [{ name: 'nome', type: 'text' }] } }]);
    assert.equal(custom[0].source, 'custom');
    assert.equal(custom[0].recordTableName, '_custom_fornitori');
    assert.equal(custom[0].recordId, 'rec-1');
  });

  test('input non-array non esplode, ritorna array vuoto (retrocompatibilità app senza queste chiavi)', () => {
    assert.deepEqual(entitiesFromSchemaTables(undefined), []);
    assert.deepEqual(entitiesFromAdminPanel(null), []);
    assert.deepEqual(entitiesFromCustomTables(undefined), []);
  });
});

describe('buildEntityList — compatibilità con app legacy', () => {
  test('config vuoto/assente e nessuna custom table -> lista vuota, nessuna eccezione', () => {
    const entities = buildEntityList({}, [], { appId: 'app-1', tenant_id: 'ten-1' });
    assert.deepEqual(entities, []);
    assert.deepEqual(buildEntityList(undefined, undefined, {}), []);
  });

  test('un\'app pubblicata prima della Fase 2 (solo schema.tables, senza relation/state) continua a risolversi', () => {
    const legacyConfig = {
      schema: { tables: [{ name: 'pazienti', label: 'Paziente', fields: [{ id: 'cognome', type: 'text', required: true }] }] },
    };
    const entities = buildEntityList(legacyConfig, [], { appId: 'app-1', tenantId: 'ten-1' });
    assert.equal(entities.length, 1);
    assert.equal(entities[0].name, 'pazienti');
    assert.equal(entities[0].app_id, 'app-1');
    assert.equal(entities[0].tenant_id, 'ten-1');
    assert.equal(entities[0].fields[0].required, true);
  });

  test('unifica schema.tables + adminPanel.entities + custom table nello stesso elenco, timbrate con id/app_id/tenant_id', () => {
    const config = {
      schema: { tables: [{ name: 'pazienti', fields: [{ id: 'nome', type: 'text' }] }] },
      adminPanel: { entities: [{ name: 'ordini', fields: [{ id: 'totale', type: 'number' }] }] },
    };
    const customDefs = [{ id: 'rec-9', data: { name: 'fornitori', columns: [{ name: 'nome', type: 'text' }] } }];
    const entities = buildEntityList(config, customDefs, { appId: 'app-1', tenantId: 'ten-1' });

    const names = entities.map((e) => e.name).sort();
    assert.deepEqual(names, ['fornitori', 'ordini', 'pazienti']);
    for (const e of entities) {
      assert.equal(e.app_id, 'app-1');
      assert.equal(e.tenant_id, 'ten-1');
      assert.ok(e.id);
    }
  });

  test('a parità di nome, adminPanel.entities vince su schema.tables e custom vince su entrambi', () => {
    const config = {
      schema: { tables: [{ name: 'ordini', label: 'Da schema', fields: [] }] },
      adminPanel: { entities: [{ name: 'ordini', label: 'Da adminPanel', fields: [] }] },
    };
    const customDefs = [{ id: 'rec-1', data: { name: 'ordini', label: 'Da custom', columns: [] } }];
    const entities = buildEntityList(config, customDefs, {});
    assert.equal(entities.length, 1);
    assert.equal(entities[0].label, 'Da custom');
    assert.equal(entities[0].source, 'custom');
  });
});

describe('findEntity', () => {
  test('trova per nome (normalizzato) o ritorna undefined', () => {
    const entities = buildEntityList({ schema: { tables: [{ name: 'Clienti', fields: [] }] } }, [], {});
    assert.equal(findEntity(entities, 'clienti')?.name, 'clienti');
    assert.equal(findEntity(entities, 'inesistente'), undefined);
  });
});

describe('validateRelationTarget / validateEntityFields — relation valida/inesistente', () => {
  test('campo non-relation -> sempre valido, nessun controllo', () => {
    const result = validateRelationTarget(toCanonicalField({ id: 'nome', type: 'text' }), new Map());
    assert.equal(result.ok, true);
  });

  test('relation valida: targetEntity risolve un\'entità reale, displayField esiste su di essa', () => {
    const entities = new Map([
      ['categorie', { name: 'categorie', fields: [toCanonicalField({ id: 'nome', type: 'text' })] }],
    ]);
    const field = toCanonicalField({ id: 'categoria', type: 'relation', targetEntity: 'categorie', displayField: 'nome' });
    const result = validateRelationTarget(field, entities);
    assert.equal(result.ok, true);
    assert.equal(result.target.name, 'categorie');
  });

  test('relation inesistente: targetEntity non corrisponde a nessuna entità -> rifiutata con motivo', () => {
    const field = toCanonicalField({ id: 'categoria', type: 'relation', targetEntity: 'non_esiste' });
    const result = validateRelationTarget(field, new Map());
    assert.equal(result.ok, false);
    assert.match(result.reason, /non corrisponde a nessuna entità/);
  });

  test('relation senza targetEntity -> rifiutata', () => {
    const field = toCanonicalField({ id: 'categoria', type: 'relation' });
    const result = validateRelationTarget(field, new Map());
    assert.equal(result.ok, false);
  });

  test('displayField che non esiste sull\'entità target -> rifiutata', () => {
    const entities = new Map([
      ['categorie', { name: 'categorie', fields: [toCanonicalField({ id: 'nome', type: 'text' })] }],
    ]);
    const field = toCanonicalField({ id: 'categoria', type: 'relation', targetEntity: 'categorie', displayField: 'campo_fantasma' });
    const result = validateRelationTarget(field, entities);
    assert.equal(result.ok, false);
    assert.match(result.reason, /displayField/);
  });

  test('validateEntityFields aggrega solo gli errori dei campi relation, ignora gli altri tipi', () => {
    const entities = new Map([['categorie', { name: 'categorie', fields: [] }]]);
    const fields = [
      toCanonicalField({ id: 'nome', type: 'text', required: true }),
      toCanonicalField({ id: 'categoria', type: 'relation', targetEntity: 'categorie' }),
      toCanonicalField({ id: 'fornitore', type: 'relation', targetEntity: 'non_esiste' }),
    ];
    const errors = validateEntityFields(fields, entities);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, 'fornitore');
  });

  test('una relation verso se stessa è valida se l\'entità stessa è inclusa tra le candidate (self-reference)', () => {
    const selfFields = [toCanonicalField({ id: 'nome', type: 'text' }), toCanonicalField({ id: 'padre', type: 'relation', targetEntity: 'categorie' })];
    const entities = new Map([['categorie', { name: 'categorie', fields: selfFields }]]);
    const errors = validateEntityFields(selfFields, entities);
    assert.equal(errors.length, 0);
  });
});
