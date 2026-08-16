// ─── Test isolati — CreatorAI Engine 2.0, Fase 6 (patch RFC6902 scoped) ─────
// node:test nativo (Node 24), stesso stile delle altre suite Fase 0/1/5:
// nessuna chiamata di rete/AI/DB — solo creator-patch-engine.ts (motore
// generico + livello applicativo su SiteBlueprintJSON) contro fixture pure.
//
// Copre i requisiti Fase 6: patch valida, patch invalida/malformata (segnale
// per il fallback deciso dal chiamante, mai da questo modulo), patch che
// elimina accidentalmente dati, relation/state coerenti dopo la patch.
//
// Uso: node --test src/lib/creator-patch-engine.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteBlueprintSchema, type SiteBlueprintJSON } from './site-schema.ts';
import { applyJsonPatch, applyAndValidatePatch, JsonPatchArraySchema, type JsonPatchOp } from './creator-patch-engine.ts';

// ─── Fixture: gestionale minimale (nessuna pagina pubblica -> nessuna
// interferenza dei controlli "pages -> entity" con i test generici) ─────────
function gestionaleSchema(): SiteBlueprintJSON {
  return SiteBlueprintSchema.parse({
    projectType: 'gestionale',
    appName: 'Officina Test',
    sector: 'custom',
    description: '',
    businessConfig: { name: 'Officina Test', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti',
          label: 'Cliente',
          labelPlural: 'Clienti',
          icon: '👤',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'nome', type: 'text', label: 'Nome', required: true },
            { id: 'telefono', type: 'text', label: 'Telefono' },
          ],
        },
        {
          name: 'interventi',
          label: 'Intervento',
          labelPlural: 'Interventi',
          icon: '🔧',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'cliente_id', type: 'relation', label: 'Cliente', targetEntity: 'clienti', displayField: 'nome' },
            { id: 'stato', type: 'state', label: 'Stato', states: ['aperto', 'chiuso'], allowedTransitions: { aperto: ['chiuso'] } },
          ],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  });
}

// ─── Fixture: webapp-pwa con una sezione "list" che referenzia "clienti" —
// serve al test "rimozione esplicita che rompe comunque un riferimento di
// pagina" (l'unico caso in cui runValidator produce un ok:false genuino su
// un documento già sanitizzato, vedi commento nel test). ────────────────────
function webappSchemaWithListSection(): SiteBlueprintJSON {
  return SiteBlueprintSchema.parse({
    projectType: 'webapp-pwa',
    appName: 'Salone Test',
    sector: 'servizi',
    description: '',
    businessConfig: { name: 'Salone Test', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti',
          label: 'Cliente',
          labelPlural: 'Clienti',
          icon: '👤',
          fields: [{ id: 'id', type: 'id', label: 'ID' }, { id: 'nome', type: 'text', label: 'Nome' }],
        },
      ],
    },
    pages: [{
      slug: 'home',
      label: 'Home',
      sections: [{ type: 'list', title: 'Clienti', entity: 'clienti', layout: 'grid' }],
    }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// applyJsonPatch — motore generico RFC6902
// ═══════════════════════════════════════════════════════════════════════════

test('applyJsonPatch: add/replace/remove su un documento semplice', () => {
  const doc = { a: 1, b: { c: 2 } };
  const patch: JsonPatchOp[] = [
    { op: 'add', path: '/d', value: 3 },
    { op: 'replace', path: '/a', value: 10 },
    { op: 'remove', path: '/b/c' },
  ];
  const result = applyJsonPatch(doc, patch);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { a: 10, d: 3, b: {} });
  // L'input originale non viene mai mutato.
  assert.deepEqual(doc, { a: 1, b: { c: 2 } });
});

test('applyJsonPatch: add su un array con indice "-" appende in coda', () => {
  const doc = { list: [1, 2] };
  const result = applyJsonPatch(doc, [{ op: 'add', path: '/list/-', value: 3 }]);
  assert.equal(result.ok, true);
  assert.deepEqual((result.result as any).list, [1, 2, 3]);
});

test('applyJsonPatch: move e copy', () => {
  const doc = { from: { x: 1 }, to: {} };
  const moved = applyJsonPatch(doc, [{ op: 'move', path: '/to/x', from: '/from/x' }]);
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.result, { from: {}, to: { x: 1 } });

  const copied = applyJsonPatch(doc, [{ op: 'copy', path: '/to/x', from: '/from/x' }]);
  assert.equal(copied.ok, true);
  assert.deepEqual(copied.result, { from: { x: 1 }, to: { x: 1 } });
});

test('applyJsonPatch: "test" che corrisponde lascia passare, che non corrisponde blocca tutta la patch', () => {
  const doc = { a: 1 };
  const ok = applyJsonPatch(doc, [{ op: 'test', path: '/a', value: 1 }, { op: 'replace', path: '/a', value: 2 }]);
  assert.equal(ok.ok, true);
  assert.equal((ok.result as any).a, 2);

  const failed = applyJsonPatch(doc, [{ op: 'test', path: '/a', value: 999 }, { op: 'replace', path: '/a', value: 2 }]);
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /test.*fallita/);
});

test('applyJsonPatch: path/indice non esistenti falliscono con errore esplicito, mai un crash silenzioso', () => {
  const doc = { a: { b: 1 } };
  const r1 = applyJsonPatch(doc, [{ op: 'replace', path: '/a/c', value: 1 }]);
  assert.equal(r1.ok, false);

  const r2 = applyJsonPatch(doc, [{ op: 'remove', path: '/z' }]);
  assert.equal(r2.ok, false);

  const r3 = applyJsonPatch({ list: [1, 2] }, [{ op: 'replace', path: '/list/5', value: 9 }]);
  assert.equal(r3.ok, false);
});

test('applyJsonPatch: un\'operazione a metà patch che fallisce non produce un documento parzialmente modificato', () => {
  const doc = { a: 1, b: 2 };
  const result = applyJsonPatch(doc, [
    { op: 'replace', path: '/a', value: 100 },
    { op: 'remove', path: '/percorso/inesistente' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.result, undefined);
  assert.deepEqual(doc, { a: 1, b: 2 }); // input invariato
});

test('applyJsonPatch: segmenti __proto__/constructor/prototype nel path sono sempre rifiutati (prototype pollution)', () => {
  const doc = { a: 1 };
  for (const dangerous of ['/__proto__/polluted', '/a/__proto__', '/constructor/prototype/polluted']) {
    const result = applyJsonPatch(doc, [{ op: 'add', path: dangerous, value: true }]);
    assert.equal(result.ok, false, `doveva rifiutare "${dangerous}"`);
  }
  assert.equal(({} as any).polluted, undefined);
});

test('JsonPatchArraySchema: rifiuta operazioni con "op" sconosciuta o path non stringa', () => {
  assert.equal(JsonPatchArraySchema.safeParse([{ op: 'delete', path: '/a' }]).success, false);
  assert.equal(JsonPatchArraySchema.safeParse([{ op: 'add', path: 123, value: 1 }]).success, false);
  assert.equal(JsonPatchArraySchema.safeParse([]).success, false); // array vuoto non ammesso
  assert.equal(JsonPatchArraySchema.safeParse('non un array').success, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// applyAndValidatePatch — livello applicativo su SiteBlueprintJSON
// ═══════════════════════════════════════════════════════════════════════════

test('patch valida: aggiunge un campo a un\'entità esistente, passa la validazione, nessuna entità/campo perso', () => {
  const before = gestionaleSchema();
  const patch = [
    { op: 'add', path: '/adminPanel/entities/0/fields/-', value: { id: 'email', type: 'text', label: 'Email' } },
  ];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const clienti = result.schema!.adminPanel.entities.find((e) => e.name === 'clienti')!;
  assert.ok(clienti.fields.some((f) => f.id === 'email'));
  // Le entità/campi preesistenti restano tutti.
  assert.ok(clienti.fields.some((f) => f.id === 'nome'));
  assert.ok(clienti.fields.some((f) => f.id === 'telefono'));
  assert.equal(result.schema!.adminPanel.entities.length, 2);
});

test('patch invalida/malformata: JSON non conforme a RFC6902 -> ok:false (segnale di fallback per il chiamante)', () => {
  const before = gestionaleSchema();
  assert.equal(applyAndValidatePatch(before, { non: 'un array di operazioni' }).ok, false);
  assert.equal(applyAndValidatePatch(before, [{ op: 'boh', path: '/x' }]).ok, false);
  assert.equal(applyAndValidatePatch(before, null).ok, false);
  assert.equal(applyAndValidatePatch(before, []).ok, false);
});

test('patch ambigua: path/indice che non esiste sul documento corrente -> ok:false', () => {
  const before = gestionaleSchema();
  const patch = [{ op: 'replace', path: '/adminPanel/entities/9/label', value: 'Non esiste' }];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(';'), /Applicazione patch fallita/);
});

test('patch che elimina accidentalmente un\'entità (replace ampio invece di remove esplicita) -> ok:false', () => {
  const before = gestionaleSchema();
  // Il modello "riscrive" l'intero array entities lasciando fuori "interventi"
  // invece di usare una remove esplicita sul suo indice: nessuna "remove"
  // punta esattamente a /adminPanel/entities/1, quindi la sparizione non è
  // considerata intenzionale.
  const onlyClienti = before.adminPanel.entities.filter((e) => e.name === 'clienti');
  const patch = [{ op: 'replace', path: '/adminPanel/entities', value: onlyClienti }];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(';'), /interventi.*scomparsa senza un'operazione "remove" esplicita/);
});

test('patch che elimina accidentalmente un campo (replace del campo padre) -> ok:false', () => {
  const before = gestionaleSchema();
  // replace dell'intera entità "clienti" (indice 0) omettendo "telefono":
  // nessuna remove esplicita su /adminPanel/entities/0/fields/2.
  const clienti = before.adminPanel.entities[0];
  const withoutTelefono = { ...clienti, fields: clienti.fields.filter((f) => f.id !== 'telefono') };
  const patch = [{ op: 'replace', path: '/adminPanel/entities/0', value: withoutTelefono }];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(';'), /campo "telefono".*scomparso senza un'operazione "remove" esplicita/);
});

test('patch con "remove" esplicita di un campo -> consentita, nessun falso positivo di perdita dati', () => {
  const before = gestionaleSchema();
  const patch = [{ op: 'remove', path: '/adminPanel/entities/0/fields/2' }]; // "telefono"
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const clienti = result.schema!.adminPanel.entities.find((e) => e.name === 'clienti')!;
  assert.ok(!clienti.fields.some((f) => f.id === 'telefono'));
  assert.ok(clienti.fields.some((f) => f.id === 'nome')); // il resto resta intatto
});

test('patch con "remove" esplicita di un\'intera entità -> consentita (nessuna pagina la referenzia in questa fixture)', () => {
  const before = gestionaleSchema();
  const patch = [{ op: 'remove', path: '/adminPanel/entities/1' }]; // "interventi"
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.schema!.adminPanel.entities.length, 1);
  assert.equal(result.schema!.adminPanel.entities[0].name, 'clienti');
});

// ═══════════════════════════════════════════════════════════════════════════
// relation/state coerenti dopo la patch
// ═══════════════════════════════════════════════════════════════════════════

test('relation dopo patch: un targetEntity introdotto dalla patch verso un\'entità inesistente viene degradato a testo (comportamento esistente riusato, non una ok:false)', () => {
  const before = gestionaleSchema();
  const patch = [
    { op: 'replace', path: '/adminPanel/entities/1/fields/1/targetEntity', value: 'entita_mai_esistita' },
  ];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const interventi = result.schema!.adminPanel.entities.find((e) => e.name === 'interventi')!;
  const clienteField = interventi.fields.find((f) => f.id === 'cliente_id')!;
  // sanitizeSiteBlueprint (riusato via runValidator) degrada la relation
  // rotta a "text", stesso comportamento già garantito per il motore v2 —
  // qui verifichiamo che valga anche per una relation introdotta da patch.
  assert.equal(clienteField.type, 'text');
});

test('state dopo patch: una transizione introdotta dalla patch verso uno stato inesistente viene filtrata (comportamento esistente riusato)', () => {
  const before = gestionaleSchema();
  const patch = [
    { op: 'add', path: '/adminPanel/entities/1/fields/2/allowedTransitions/aperto/-', value: 'stato_mai_esistito' },
  ];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const interventi = result.schema!.adminPanel.entities.find((e) => e.name === 'interventi')!;
  const statoField = interventi.fields.find((f) => f.id === 'stato')!;
  assert.deepEqual(statoField.allowedTransitions?.aperto, ['chiuso']); // "stato_mai_esistito" filtrato
});

test('rimozione esplicita che comunque rompe un riferimento di pagina -> ok:false (runValidator, riusato, non duplicato)', () => {
  const before = webappSchemaWithListSection();
  // Rimozione esplicita e "autorizzata" dal punto di vista della perdita
  // dati (nessun campo/entità sparisce per sbaglio), ma la pagina "home" ha
  // ancora una sezione "list" che referenzia "clienti": è l'UNICO controllo
  // che runValidator applica davvero su un documento già sanitizzato
  // (sanitizeSiteBlueprint non risolve i riferimenti pagina->entità).
  const patch = [{ op: 'remove', path: '/adminPanel/entities/0' }];
  const result = applyAndValidatePatch(before, patch);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(';'), /entity "clienti" non esiste tra le entità/);
});
