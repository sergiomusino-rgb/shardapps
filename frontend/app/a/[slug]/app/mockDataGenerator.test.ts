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
  generateMockRecord: (
    table: TableDef,
    index: number,
    relatedRecords?: Record<string, { id: string }[]>
  ) => Record<string, unknown>;
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

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V2 — Fix F.1: inferenza semantica dei campi numerici + coerenza
// matematica tra campi collegati sullo stesso record.
// ═══════════════════════════════════════════════════════════════════════════

function interventoNumericTable(): TableDef {
  return table('interventi', [
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
  ]);
}

test('F.1: campi numerici semanticamente diversi (ore/tariffa/costi) sullo stesso record NON ricevono tutti lo stesso valore', () => {
  const t = interventoNumericTable();
  const rec = generateMockRecord(t, 0);
  const values = [rec.ore_lavorate, rec.tariffa_oraria, rec.costo_manodopera, rec.costo_materiali, rec.costo_totale];
  assert.ok(values.every((v) => typeof v === 'number'));
  const distinct = new Set(values);
  assert.ok(distinct.size >= 3, `attesi almeno 3 valori distinti su 5 campi numerici diversi, trovati: ${JSON.stringify(values)}`);
});

test('F.1: costo_manodopera ≈ ore_lavorate × tariffa_oraria quando entrambi i campi esistono sullo stesso record (relazione matematica plausibile)', () => {
  const t = interventoNumericTable();
  const rec = generateMockRecord(t, 1);
  assert.equal(rec.costo_manodopera, (rec.ore_lavorate as number) * (rec.tariffa_oraria as number));
});

test('F.1: costo_totale ≈ costo_manodopera + costo_materiali quando entrambe le "cost part" esistono sullo stesso record', () => {
  const t = interventoNumericTable();
  const rec = generateMockRecord(t, 2);
  assert.equal(rec.costo_totale, (rec.costo_manodopera as number) + (rec.costo_materiali as number));
});

test('F.1: ore_lavorate resta un intero piccolo e plausibile (una quantità di tempo, non una valuta)', () => {
  const t = table('interventi', [field({ name: 'ore_lavorate', type: 'number' })]);
  for (let i = 0; i < 8; i++) {
    const rec = generateMockRecord(t, i);
    assert.ok((rec.ore_lavorate as number) >= 1 && (rec.ore_lavorate as number) <= 10);
  }
});

test('F.1: senza campi collegati (solo costo_totale isolato), nessun crash — fallback indipendente invariato', () => {
  const t = table('generico', [field({ name: 'costo_totale', type: 'number' })]);
  const rec = generateMockRecord(t, 0);
  assert.equal(typeof rec.costo_totale, 'number');
});

test('F.1: due campi "cost part" indipendenti (senza ore/tariffa) su tabelle diverse NON ricevono lo stesso valore per lo stesso indice (era il bug esatto osservato in produzione)', () => {
  const a = table('tabella_a', [field({ name: 'costo_materiali', type: 'number' })]);
  const b = table('tabella_a', [field({ name: 'canone_mensile', type: 'number' })]);
  const recA = generateMockRecord(a, 0);
  const recB = generateMockRecord(b, 0);
  assert.notEqual(recA.costo_materiali, recB.canone_mensile);
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V2 — Fix F.2: fallback semantico per campi TESTUALI il cui nome
// è chiaramente riconducibile a una data.
// ═══════════════════════════════════════════════════════════════════════════

test('F.2: "data_chiusura_prevista" (text) produce una data plausibile, non una frase generica', () => {
  const t = table('opportunita', [field({ name: 'data_chiusura_prevista', type: 'text' })]);
  const rec = generateMockRecord(t, 0);
  assert.match(rec.data_chiusura_prevista as string, /^\d{4}-\d{2}-\d{2}$/);
});

test('F.2: altri nomi "data-simili" (scadenza, deadline, data_apertura come text) producono anch\'essi una data plausibile', () => {
  const t = table('pratiche', [
    field({ name: 'scadenza', type: 'text' }),
    field({ name: 'deadline_progetto', type: 'text' }),
    field({ name: 'data_apertura', type: 'text' }),
  ]);
  const rec = generateMockRecord(t, 0);
  for (const key of ['scadenza', 'deadline_progetto', 'data_apertura']) {
    assert.match(rec[key] as string, /^\d{4}-\d{2}-\d{2}$/, `${key} deve essere una data plausibile`);
  }
});

test('F.2: un campo dichiarato esplicitamente "date"/"datetime" continua a prevalere (invariato, non passa dal fallback testuale)', () => {
  const t = table('interventi', [field({ name: 'data_intervento', type: 'date' })]);
  const rec = generateMockRecord(t, 0);
  assert.match(rec.data_intervento as string, /^\d{4}-\d{2}-\d{2}$/);
});

test('F.2: normali stringhe che NON devono diventare date restano invariate (nessuna trasformazione indiscriminata)', () => {
  const t = table('clienti', [
    field({ name: 'ragione_sociale', type: 'text' }),
    field({ name: 'note', type: 'text' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.ok(typeof rec.ragione_sociale === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(rec.ragione_sociale as string));
  assert.ok(typeof rec.note === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(rec.note as string));
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V2 — Relazioni: demo data coerente tra entità collegate.
// ═══════════════════════════════════════════════════════════════════════════

test('Relations: un campo "relation" con record correlati reali disponibili si collega a uno di essi (id reale, non vuoto)', () => {
  const t = table('interventi', [
    field({ name: 'cliente_id', type: 'relation', targetTable: 'clienti' } as Partial<FieldDef> & { name: string; type: FieldDef['type'] }),
  ]);
  const relatedRecords = { clienti: [{ id: 'cli-1' }, { id: 'cli-2' }, { id: 'cli-3' }] };
  const rec = generateMockRecord(t, 0, relatedRecords);
  assert.ok(['cli-1', 'cli-2', 'cli-3'].includes(rec.cliente_id as string));
});

test('Relations: senza record correlati disponibili, il campo relation resta undefined (comportamento pre-esistente invariato, mai un id inventato)', () => {
  const t = table('interventi', [
    field({ name: 'cliente_id', type: 'relation', targetTable: 'clienti' } as Partial<FieldDef> & { name: string; type: FieldDef['type'] }),
  ]);
  const rec = generateMockRecord(t, 0, {});
  assert.equal('cliente_id' in rec, false);
  const recNoArg = generateMockRecord(t, 0);
  assert.equal('cliente_id' in recNoArg, false);
});

test('Relations: relation verso una tabella diversa da quella con record disponibili non si collega per errore', () => {
  const t = table('interventi', [
    field({ name: 'tecnico_id', type: 'relation', targetTable: 'tecnici' } as Partial<FieldDef> & { name: string; type: FieldDef['type'] }),
  ]);
  const relatedRecords = { clienti: [{ id: 'cli-1' }] }; // nessun record per "tecnici"
  const rec = generateMockRecord(t, 0, relatedRecords);
  assert.equal('tecnico_id' in rec, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V2 — Final Semantic Consistency Check: la coerenza matematica
// (F.1) NON deve dipendere dall'ordine dei campi nel blueprint — un modello
// non garantisce mai un ordine di dichiarazione specifico. Bug reale
// verificato PRIMA di questo fix: con "costo_manodopera" dichiarato prima
// di "ore_lavorate"/"tariffa_oraria", il calcolo ricadeva sul fallback
// indipendente invece che sul prodotto ore×tariffa (numberCtx.duration/
// rate non erano ancora stati calcolati in quel punto dell'iterazione).
// ═══════════════════════════════════════════════════════════════════════════

function assertCoerentiOreCostoTotale(rec: Record<string, unknown>) {
  assert.equal(typeof rec.ore_lavorate, 'number');
  assert.equal(typeof rec.tariffa_oraria, 'number');
  assert.equal(typeof rec.costo_manodopera, 'number');
  assert.equal(typeof rec.costo_materiali, 'number');
  assert.equal(typeof rec.costo_totale, 'number');
  assert.equal(rec.costo_manodopera, (rec.ore_lavorate as number) * (rec.tariffa_oraria as number), 'costo_manodopera deve essere ore_lavorate × tariffa_oraria');
  assert.equal(rec.costo_totale, (rec.costo_manodopera as number) + (rec.costo_materiali as number), 'costo_totale deve essere costo_manodopera + costo_materiali');
  // Requisito esplicito: mai costo_totale === costo_materiali quando esiste
  // anche una manodopera non-zero (altrimenti la manodopera è stata ignorata).
  assert.notEqual(rec.costo_totale, rec.costo_materiali);
}

test('Caso A — ordine normale (ore, tariffa, manodopera, materiali, totale): relazioni coerenti', () => {
  const t = table('interventi', [
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
  ]);
  assertCoerentiOreCostoTotale(generateMockRecord(t, 0));
});

test('Caso B — ordine invertito (totale, materiali, manodopera, tariffa, ore): stesse relazioni coerenti, non dipende dalla posizione nel blueprint', () => {
  const t = table('interventi', [
    field({ name: 'costo_totale', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'ore_lavorate', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assertCoerentiOreCostoTotale(rec);
  // L'ordine delle CHIAVI nel record restituito segue comunque l'ordine di
  // dichiarazione originale (dettaglio di rendering, invariato) — solo
  // l'ordine di CALCOLO interno è cambiato.
  assert.deepEqual(Object.keys(rec), ['costo_totale', 'costo_materiali', 'costo_manodopera', 'tariffa_oraria', 'ore_lavorate']);
});

test('Caso C — ordine misto (manodopera, ore, totale, tariffa, materiali): relazioni coerenti indipendentemente dalla posizione', () => {
  const t = table('interventi', [
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
  ]);
  assertCoerentiOreCostoTotale(generateMockRecord(t, 1));
});

test('Caso D — campi parziali (solo ore_lavorate, tariffa_oraria, costo_totale, senza manodopera/materiali): nessun crash, valori plausibili', () => {
  const t = table('interventi', [
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.equal(typeof rec.ore_lavorate, 'number');
  assert.ok((rec.ore_lavorate as number) >= 1 && (rec.ore_lavorate as number) <= 10);
  assert.equal(typeof rec.tariffa_oraria, 'number');
  assert.ok((rec.tariffa_oraria as number) >= 20 && (rec.tariffa_oraria as number) <= 80);
  // Nessuna "cost part" dichiarata: costo_totale resta un fallback
  // indipendente plausibile (mai un crash, mai NaN/undefined).
  assert.equal(typeof rec.costo_totale, 'number');
  assert.ok(Number.isFinite(rec.costo_totale as number));
});

test('Caso E — campi numerici semanticamente INDIPENDENTI (numero_dipendenti, punteggio, anno, quantita): mai trattati come costi correlati', () => {
  const t = table('aziende', [
    field({ name: 'numero_dipendenti', type: 'number' }),
    field({ name: 'punteggio', type: 'number' }),
    field({ name: 'anno_fondazione', type: 'number' }),
    field({ name: 'quantita_prodotti', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.equal(typeof rec.numero_dipendenti, 'number');
  assert.equal(typeof rec.punteggio, 'number');
  assert.equal(typeof rec.anno_fondazione, 'number');
  assert.equal(typeof rec.quantita_prodotti, 'number');
  // "anno_fondazione" deve restare un anno plausibile (2010-2024), non un
  // importo o una quantità generica — prova che il ruolo "year" resta
  // riconosciuto e non viene confuso con "costPart"/"generic".
  assert.ok((rec.anno_fondazione as number) >= 2010 && (rec.anno_fondazione as number) <= 2024);
  // "quantita_prodotti" deve restare nel range quantità (1-50), non nel
  // range valuta (15-1500).
  assert.ok((rec.quantita_prodotti as number) >= 1 && (rec.quantita_prodotti as number) <= 50);
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — multilingua: gli stessi test F.1/F.2/Relations, ma con nomi
// campo in INGLESE, devono produrre lo stesso comportamento degli
// equivalenti italiani già testati sopra (issue GitHub #39, punto 1).
// ═══════════════════════════════════════════════════════════════════════════

test('V3 multilingua: campi in inglese (full_name, phone, price) NON ricadono più su frasi generiche di note/descrizione', () => {
  const t = table('members', [
    field({ name: 'full_name', type: 'text' }),
    field({ name: 'phone', type: 'text' }),
  ]);
  const rec = generateMockRecord(t, 0);
  // Un nome vero (word bank), mai una frase (i pool GENERIC_* sono tutte
  // frasi con spazi multipli/punteggiatura finale — un nome proprio no).
  assert.ok(typeof rec.full_name === 'string' && !(rec.full_name as string).endsWith('.'));
  assert.ok(typeof rec.phone === 'string' && (rec.phone as string).length > 0);
});

test('V3 multilingua: "labor_cost = hours_worked × hourly_rate" (EN) coerente esattamente come "costo_manodopera = ore_lavorate × tariffa_oraria" (IT)', () => {
  const t = table('work_orders', [
    field({ name: 'hours_worked', type: 'number' }),
    field({ name: 'hourly_rate', type: 'number' }),
    field({ name: 'labor_cost', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 1);
  assert.equal(rec.labor_cost, (rec.hours_worked as number) * (rec.hourly_rate as number));
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — sezione 6: nuove formule (subtotal = quantity × unit_price,
// total = subtotal + tax - discount, margin = revenue - cost), indipendenti
// dall'ordine dei campi nel blueprint (stesso principio già garantito per
// ore×tariffa/costo_totale in v2 — vedi Caso B sopra).
// ═══════════════════════════════════════════════════════════════════════════

test('V3 formule: subtotal = quantity × unit_price quando entrambi i campi esistono sullo stesso record', () => {
  const t = table('order_items', [
    field({ name: 'quantity', type: 'number' }),
    field({ name: 'unit_price', type: 'number' }),
    field({ name: 'subtotal', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.equal(rec.subtotal, (rec.quantity as number) * (rec.unit_price as number));
});

test('V3 formule: subtotal = quantity × unit_price resta coerente indipendentemente dall\'ordine dei campi nel blueprint', () => {
  const t = table('order_items', [
    field({ name: 'subtotal', type: 'number' }),
    field({ name: 'unit_price', type: 'number' }),
    field({ name: 'quantity', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 2);
  assert.equal(rec.subtotal, (rec.quantity as number) * (rec.unit_price as number));
});

test('V3 formule: total = subtotal + tax - discount quando tutti i campi esistono sullo stesso record', () => {
  const t = table('orders', [
    field({ name: 'quantity', type: 'number' }),
    field({ name: 'unit_price', type: 'number' }),
    field({ name: 'subtotal', type: 'number' }),
    field({ name: 'tax', type: 'number' }),
    field({ name: 'discount', type: 'number' }),
    field({ name: 'total', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  const expected = (rec.subtotal as number) + (rec.tax as number) - (rec.discount as number);
  assert.equal(rec.total, expected);
});

test('V3 formule: margin = revenue - total_cost quando entrambi disponibili sullo stesso record', () => {
  const t = table('projects', [
    field({ name: 'labor_cost', type: 'number' }),
    field({ name: 'material_cost', type: 'number' }),
    field({ name: 'total_cost', type: 'number' }),
    field({ name: 'revenue', type: 'number' }),
    field({ name: 'margin', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.equal(rec.total_cost, (rec.labor_cost as number) + (rec.material_cost as number));
  assert.equal(rec.margin, (rec.revenue as number) - (rec.total_cost as number));
});

test('V3 formule: "unit_price"/"subtotal" (entrambi NON riconosciuti da nessuna regex italiana) non collidono più sullo stesso valore (issue GitHub #39, punto 2)', () => {
  const t = table('order_items', [
    field({ name: 'unit_price', type: 'number' }),
    field({ name: 'subtotal', type: 'number' }),
  ]);
  // Senza quantity, subtotal ricade sul fallback indipendente — il punto è
  // che NON deve più condividere lo stesso seed di unit_price.
  for (let i = 0; i < 5; i++) {
    const rec = generateMockRecord(t, i);
    assert.notEqual(rec.unit_price, rec.subtotal, `record ${i}: unit_price e subtotal non devono coincidere`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — sezione 5: date semantiche. Due campi "date" diversi sullo
// stesso record (es. start_date/expiry_date) non devono più ricevere lo
// stesso valore identico (bug reale osservato in TEST E del benchmark v2,
// issue GitHub #39 punto 2) — e quando i ruoli sono riconoscibili
// (inizio/fine), la relazione start < end deve valere sempre.
// ═══════════════════════════════════════════════════════════════════════════

test('V3 date: "start_date" ed "expiry_date" (entrambi type:"date") NON ricevono più lo stesso valore identico sullo stesso record', () => {
  const t = table('subscriptions', [
    field({ name: 'start_date', type: 'date' }),
    field({ name: 'expiry_date', type: 'date' }),
  ]);
  for (let i = 0; i < 5; i++) {
    const rec = generateMockRecord(t, i);
    assert.notEqual(rec.start_date, rec.expiry_date, `record ${i}: start_date ed expiry_date non devono coincidere`);
  }
});

test('V3 date: "start_date" < "expiry_date" sempre, quando entrambi i ruoli sono riconoscibili (relazione plausibile inizio < fine)', () => {
  const t = table('subscriptions', [
    field({ name: 'start_date', type: 'date' }),
    field({ name: 'expiry_date', type: 'date' }),
  ]);
  for (let i = 0; i < 5; i++) {
    const rec = generateMockRecord(t, i);
    const start = new Date(rec.start_date as string).getTime();
    const end = new Date(rec.expiry_date as string).getTime();
    assert.ok(start < end, `record ${i}: start_date (${rec.start_date}) deve precedere expiry_date (${rec.expiry_date})`);
  }
});

test('V3 date: coerenza start < end indipendente dall\'ordine dei campi nel blueprint', () => {
  const t = table('subscriptions', [
    field({ name: 'expiry_date', type: 'date' }),
    field({ name: 'start_date', type: 'date' }),
  ]);
  const rec = generateMockRecord(t, 3);
  const start = new Date(rec.start_date as string).getTime();
  const end = new Date(rec.expiry_date as string).getTime();
  assert.ok(start < end);
  // L'ordine delle chiavi resta comunque quello di dichiarazione originale.
  assert.deepEqual(Object.keys(rec), ['expiry_date', 'start_date']);
});

test('V3 date: un campo "data_nascita" resta un\'età adulta plausibile, mai confuso con una data di creazione/scadenza recente', () => {
  const t = table('members', [field({ name: 'data_nascita', type: 'date' })]);
  const rec = generateMockRecord(t, 0);
  const years = (Date.now() - new Date(rec.data_nascita as string).getTime()) / (365 * 24 * 3600 * 1000);
  assert.ok(years >= 17 && years <= 71, `data_nascita deve essere un'età adulta plausibile, trovato ${years.toFixed(1)} anni`);
});

test('V3 date: due campi "date" senza ruolo inizio/fine riconoscibile restano comunque distinti (variazione per-campo)', () => {
  const t = table('logs', [
    field({ name: 'data_evento_a', type: 'date' }),
    field({ name: 'data_evento_b', type: 'date' }),
  ]);
  const rec = generateMockRecord(t, 0);
  assert.notEqual(rec.data_evento_a, rec.data_evento_b);
});

test('Caso E bis — campi indipendenti su una tabella che HA ANCHE campi di costo correlati: i due gruppi non si mescolano', () => {
  const t = table('interventi', [
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
    field({ name: 'punteggio_soddisfazione', type: 'number' }),
  ]);
  const rec = generateMockRecord(t, 0);
  // costo_totale === ESATTAMENTE manodopera + materiali (asserito da
  // assertCoerentiOreCostoTotale) dimostra già che "punteggio_soddisfazione"
  // non è stato incluso nella somma delle cost part: se lo fosse stato,
  // questa uguaglianza esatta non potrebbe reggere (punteggio è sempre >= 1,
  // mai 0 — randomInt(1,100,...) — quindi un'inclusione erronea sposterebbe
  // sempre il totale).
  assertCoerentiOreCostoTotale(rec);
  assert.equal(typeof rec.punteggio_soddisfazione, 'number');
});
