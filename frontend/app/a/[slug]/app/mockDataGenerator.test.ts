// ─── Test isolati — Quality Pass v1, Fix #2 (demo data con placeholder generici) ──
// node:test nativo. mockDataGenerator.ts importa `@/lib/recordPlaceholderImages`
// (alias di progetto, risolto da Next.js/webpack ma non da `node --test`
// diretto) — riusa lo stesso loader di risoluzione alias già usato dai test
// HTTP delle route (route-test-harness.ts/route-test-loader.mjs, Fase 5/6)
// per caricare il modulo reale con un import dinamico, invece di duplicare
// quel meccanismo qui.
//
// Uso: node --test "app/a/[slug]/app/mockDataGenerator.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute } from '../../../../src/lib/test-helpers/route-test-harness.ts';
import type { TableDef, FieldDef } from './table-definitions.ts';

setupRouteTest({} as unknown, {}); // registra il loader di risoluzione alias per questo processo
const { generateMockRecord } = (await importRoute('app/a/[slug]/app/mockDataGenerator.ts')) as {
  generateMockRecord: (table: TableDef, index: number) => Record<string, unknown>;
};

function field(overrides: Partial<FieldDef> & { name: string; type: FieldDef['type'] }): FieldDef {
  return { label: overrides.name, ...overrides } as FieldDef;
}

function table(name: string, fields: FieldDef[]): TableDef {
  return { name, label: name, labelPlural: name, icon: '', fields };
}

// ═══════════════════════════════════════════════════════════════════════════
// Bug del benchmark: più campi non riconosciuti sullo stesso record
// collassavano tutti sullo stesso identity.categoryTitle ("Elemento Epsilon"
// ripetuto). I test sotto coprono i due case mancanti che causavano questo
// (state, campi con id composto) più il fallback monetario testuale.
// ═══════════════════════════════════════════════════════════════════════════

test('campo type:"state" pesca da field.states, non dal titolo generico condiviso', () => {
  const t = table('opportunita', [
    field({ name: 'stato', type: 'state', states: ['nuovo', 'contattato', 'vinto'] }),
  ]);
  for (let i = 0; i < 6; i++) {
    const rec = generateMockRecord(t, i);
    assert.ok(['nuovo', 'contattato', 'vinto'].includes(rec.stato as string));
  }
});

test('campo type:"state" senza vocabolario (field.states assente) ricade su "Standard", mai su categoryTitle', () => {
  const t = table('opportunita', [field({ name: 'stato', type: 'state' })]);
  const rec = generateMockRecord(t, 0);
  assert.equal(rec.stato, 'Standard');
});

test('un id di campo composto ("nome_lead") viene comunque riconosciuto come nome proprio, non collassa sul titolo generico', () => {
  const t = table('lead_generici', [field({ name: 'nome_lead', type: 'text' })]);
  const rec = generateMockRecord(t, 0);
  // Deve essere uno dei nomi propri della word bank, non un "Elemento ..."
  // né un titolo di categoria placeholder.
  assert.ok(typeof rec.nome_lead === 'string' && !(rec.nome_lead as string).startsWith('Elemento'));
});

test('un campo testuale con nome monetario composto ("valore_stimato") produce un numero plausibile, non il titolo generico', () => {
  const t = table('opportunita_generiche', [field({ name: 'valore_stimato', type: 'text' })]);
  const rec = generateMockRecord(t, 0);
  assert.equal(typeof rec.valore_stimato, 'number');
});

test('bug del benchmark: due campi non riconosciuti diversi sullo stesso record NON producono più lo stesso valore ripetuto', () => {
  // "stato" (state) e "valore_stimato" (fallback monetario) sono entrambi
  // campi che PRIMA di questo fix ricadevano sullo stesso identity.categoryTitle
  // del record (bug osservato nel benchmark, "Elemento Epsilon" ripetuto).
  const t = table('tabella_senza_categoria_nota', [
    field({ name: 'stato', type: 'state', states: ['a', 'b'] }),
    field({ name: 'valore_stimato', type: 'text' }),
    field({ name: 'note_libere_non_riconosciute_xyz', type: 'text' }),
  ]);
  const rec = generateMockRecord(t, 2);
  // I primi due non devono valere identity.categoryTitle (il terzo, non
  // riconosciuto da nessuna euristica, può legittimamente ricadervi: è il
  // comportamento di fallback finale, invariato e corretto per un campo
  // davvero senza alcun indizio semantico).
  assert.notEqual(rec.stato, rec.note_libere_non_riconosciute_xyz);
  assert.notEqual(rec.valore_stimato, rec.note_libere_non_riconosciute_xyz);
});

test('select senza opzioni ricade su "Standard" (comportamento esistente, invariato)', () => {
  const t = table('generico', [field({ name: 'categoria', type: 'select' })]);
  const rec = generateMockRecord(t, 0);
  assert.equal(rec.categoria, 'Standard');
});

test('categoria di placeholder differisce per dominio (veicoli vs tabella senza categoria nota)', () => {
  const veicoli = table('veicoli', [field({ name: 'descrizione_libera_xyz', type: 'text' })]);
  const generico = table('tabella_senza_categoria_nota_2', [field({ name: 'descrizione_libera_xyz', type: 'text' })]);
  const recVeicoli = generateMockRecord(veicoli, 0);
  const recGenerico = generateMockRecord(generico, 0);
  assert.notEqual(recVeicoli.descrizione_libera_xyz, recGenerico.descrizione_libera_xyz);
});

test('deterministico: stesso indice -> stesso record, ad ogni chiamata', () => {
  const t = table('clienti', [
    field({ name: 'nome', type: 'text' }),
    field({ name: 'email', type: 'email' }),
    field({ name: 'importo', type: 'currency' }),
  ]);
  const a = generateMockRecord(t, 3);
  const b = generateMockRecord(t, 3);
  assert.deepEqual(a, b);
});
