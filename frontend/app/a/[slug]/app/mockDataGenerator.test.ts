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

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY PASS v1.1 — Fix #1 (placeholder residui): campi come descrizione/
// note/titolo/ore_lavorate su un'entità la cui tabella non rientra in nessuna
// categoria nota (es. "interventi", "lead", "aziende") non devono più
// condividere lo stesso valore, né tra loro né tra record diversi — bug
// residuo confermato dalla validazione reale in produzione del Quality Pass
// v1 (TEST 1 CRM e TEST 2 Interventi Tecnici).
// ═══════════════════════════════════════════════════════════════════════════

// Stessa tabella/entità usata nella validazione reale che ha fatto emergere
// il bug: "interventi", nessuna categoria nota associata.
function interventiTable(): TableDef {
  return table('interventi', [
    field({ name: 'descrizione', type: 'text' }),
    field({ name: 'note', type: 'text' }),
    field({ name: 'titolo', type: 'text' }),
    field({ name: 'ore_lavorate', type: 'text' }),
  ]);
}

test('1. due record della stessa entità non ricevono lo stesso placeholder per lo stesso campo testuale', () => {
  const t = interventiTable();
  const recA = generateMockRecord(t, 0);
  const recB = generateMockRecord(t, 1);
  assert.notEqual(recA.descrizione, recB.descrizione, 'descrizione deve variare tra record diversi');
  assert.notEqual(recA.note, recB.note, 'note deve variare tra record diversi');
  assert.notEqual(recA.titolo, recB.titolo, 'titolo deve variare tra record diversi');
});

test('2. campi diversi sullo stesso record non ricevono tutti lo stesso valore (bug residuo del Quality Pass v1)', () => {
  const t = interventiTable();
  const rec = generateMockRecord(t, 0);
  const values = [rec.descrizione, rec.note, rec.titolo];
  const distinct = new Set(values);
  assert.equal(distinct.size, values.length, `attesi ${values.length} valori distinti, trovati: ${JSON.stringify(values)}`);
  // ore_lavorate: coerente con un campo numerico (il tipo dichiarato è
  // "text", ma il nome indica chiaramente una quantità, come già avviene
  // per il fallback monetario esistente) — mai una stringa placeholder.
  assert.equal(typeof rec.ore_lavorate, 'number');
});

test('3. le categorie già funzionanti continuano a funzionare (nessuna regressione su prodotto/veicoli/immobili)', () => {
  // "nome_prodotto" su una tabella "veicoli" (categoria nota): deve restare
  // esattamente identity.categoryTitle (comportamento pre-esistente, mai
  // toccato da questo fix) — un nome di veicolo reale, non un pool generico.
  const veicoli = table('veicoli', [field({ name: 'nome_prodotto', type: 'text' })]);
  const rec = generateMockRecord(veicoli, 0);
  const CATEGORY_TITLES_VEICOLI = ['Volkswagen Passat Variant', 'Fiat 500', 'Peugeot 3008', 'Toyota Yaris Hybrid', 'BMW Serie 3 320d', 'Audi A4', 'Renault Clio', 'Ford Focus'];
  assert.ok(CATEGORY_TITLES_VEICOLI.includes(rec.nome_prodotto as string));
});

test('4. stati, prezzi, indirizzi, nomi e date già corretti non regrediscono', () => {
  const t = table('interventi_completo', [
    field({ name: 'stato', type: 'state', states: ['aperto', 'chiuso'] }),
    field({ name: 'valore_stimato', type: 'text' }),
    field({ name: 'indirizzo', type: 'text' }),
    field({ name: 'nome', type: 'text' }),
    field({ name: 'data_apertura', type: 'date' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.ok(['aperto', 'chiuso'].includes(rec.stato as string));
  assert.equal(typeof rec.valore_stimato, 'number');
  assert.ok(typeof rec.indirizzo === 'string' && rec.indirizzo.length > 0);
  assert.ok(typeof rec.nome === 'string' && rec.nome.length > 0);
  assert.match(rec.data_apertura as string, /^\d{4}-\d{2}-\d{2}$/);
});
