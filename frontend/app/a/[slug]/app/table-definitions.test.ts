// ─── Test isolati — Quality Pass v1, Fix #3 (dashboardCards) e Fix #4 ────────
// (navigazione entità centrale). node:test nativo, nessuna dipendenza esterna
// (table-definitions.ts non importa nulla, testabile direttamente).
//
// Uso: node --test "app/a/[slug]/app/table-definitions.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
// TableDef/FieldDef sono interface (nessun binding a runtime): import type
// separato, altrimenti il type-stripping nativo di `node --test` cerca
// (fallendo) un export reale con quel nome — stesso motivo/pattern già
// applicato in mockDataGenerator.ts per lo stesso import.
import { selectQuickActionTables, computeDashboardCardValue, sortTablesForSidebar, pickIdentityFields, findDisplayPriceField, isRestaurantMenuGridTable } from './table-definitions.ts';
import type { TableDef, FieldDef } from './table-definitions.ts';

function field(overrides: Partial<FieldDef> & { name: string; type: FieldDef['type'] }): FieldDef {
  return { label: overrides.name, ...overrides } as FieldDef;
}

function table(name: string, fields: FieldDef[]): TableDef {
  return { name, label: name, labelPlural: name, icon: '', fields };
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix #4 — selectQuickActionTables: l'entità centrale (con un campo di stato,
// cioè un flusso di lavoro operativo) deve comparire in "Azioni Rapide" anche
// se non è tra le prime 4 dichiarate nel blueprint.
// ═══════════════════════════════════════════════════════════════════════════

test('un CRM con 5 entità: "opportunità" (l\'unica con un campo state) resta visibile in Azioni Rapide anche se è la 5ª del blueprint', () => {
  const tables = [
    table('attivita', [field({ name: 'titolo', type: 'text' })]),
    table('note', [field({ name: 'testo', type: 'textarea' })]),
    table('clienti', [field({ name: 'nome', type: 'text' })]),
    table('aziende', [field({ name: 'ragione_sociale', type: 'text' })]),
    table('opportunita', [field({ name: 'stato', type: 'state', states: ['nuovo', 'vinto'] })]),
  ];
  const quick = selectQuickActionTables(tables);
  assert.ok(quick.some((t) => t.name === 'opportunita'), 'l\'entità con flusso di lavoro deve essere raggiungibile dalle Azioni Rapide');
  assert.ok(quick.length <= 4);
});

test('nessuna tabella con stato: l\'ordine originale (= ordine del blueprint) è preservato, invariato rispetto a prima', () => {
  const tables = [table('a', []), table('b', []), table('c', []), table('d', []), table('e', [])];
  const quick = selectQuickActionTables(tables);
  assert.deepEqual(quick.map((t) => t.name), ['a', 'b', 'c', 'd']);
});

test('le tabelle di sistema (fatture/documenti) restano escluse dalle Azioni Rapide, come già dalla sidebar', () => {
  const tables = [
    table('fatture', [field({ name: 'stato', type: 'state', states: ['bozza', 'emessa'] })]),
    table('clienti', [field({ name: 'nome', type: 'text' })]),
  ];
  const quick = selectQuickActionTables(tables);
  assert.ok(!quick.some((t) => t.name === 'fatture'));
});

test('selectQuickActionTables non altera sortTablesForSidebar (la sidebar mostra sempre l\'elenco completo)', () => {
  const tables = [
    table('attivita', []),
    table('opportunita', [field({ name: 'stato', type: 'state', states: ['a', 'b'] })]),
    table('fatture', []),
  ];
  const sidebar = sortTablesForSidebar(tables);
  assert.deepEqual(sidebar.map((t) => t.name), ['attivita', 'opportunita', 'fatture']);
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix #3 — computeDashboardCardValue: calcolo delle KPI di dominio sui record
// reali già scaricati dalla Dashboard.
// ═══════════════════════════════════════════════════════════════════════════

const RECORDS = [
  { data: { stato: 'nuovo', valore: 1000 }, createdAt: '2026-01-01T00:00:00Z' },
  { data: { stato: 'vinto', valore: 500 }, createdAt: '2026-01-03T00:00:00Z' },
  { data: { stato: 'nuovo', valore: 250 }, createdAt: '2026-01-02T00:00:00Z' },
];

test('type "count" senza filtro: conta tutti i record', () => {
  const v = computeDashboardCardValue({ type: 'count', table: 'opportunita', label: 'Totali' }, RECORDS);
  assert.equal(v, '3');
});

test('type "count" con filtro {campo: {in: [...]}}: conta solo i record che matchano', () => {
  const v = computeDashboardCardValue(
    { type: 'count', table: 'opportunita', label: 'Aperte', filter: { stato: { in: ['nuovo'] } } },
    RECORDS
  );
  assert.equal(v, '2');
});

test('type "sum": somma il campo indicato sui record (filtrati, se presente un filtro)', () => {
  const v = computeDashboardCardValue({ type: 'sum', table: 'opportunita', label: 'Pipeline', field: 'valore' }, RECORDS);
  assert.equal(v, '1750');
});

test('type "avg": media del campo indicato', () => {
  const v = computeDashboardCardValue(
    { type: 'avg', table: 'opportunita', label: 'Media', field: 'valore', filter: { stato: { in: ['nuovo'] } } },
    RECORDS
  );
  assert.equal(v, String((1000 + 250) / 2));
});

test('type "avg" senza record corrispondenti: "0", nessuna divisione per zero', () => {
  const v = computeDashboardCardValue(
    { type: 'avg', table: 'opportunita', label: 'Media', field: 'valore', filter: { stato: { in: ['inesistente'] } } },
    RECORDS
  );
  assert.equal(v, '0');
});

test('type "latest": il valore del campo sul record più recente (per createdAt)', () => {
  const v = computeDashboardCardValue({ type: 'latest', table: 'opportunita', label: 'Ultimo Stato', field: 'stato' }, RECORDS);
  assert.equal(v, 'vinto'); // 2026-01-03 è il più recente
});

test('type "latest" senza record: "—", nessun crash', () => {
  const v = computeDashboardCardValue({ type: 'latest', table: 'opportunita', label: 'Ultimo Stato', field: 'stato' }, []);
  assert.equal(v, '—');
});

test('un filtro su una condizione non riconosciuta non filtra nulla (fail-open, mai una card che sparisce per un formato inatteso)', () => {
  const v = computeDashboardCardValue(
    { type: 'count', table: 'opportunita', label: 'Totali', filter: { stato: 'nuovo' } as unknown as Record<string, unknown> },
    RECORDS
  );
  assert.equal(v, '3');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — Fix TEST E (issue GitHub #39, punto 3): pickIdentityFields
// non deve più scegliere ciecamente fields[0] come titolo quando non c'è un
// campo testo — un campo relation/number/date/state come titolo veniva poi
// mostrato come valore GREZZO (o vuoto) invece che tramite risoluzione della
// relazione. Riproduce esattamente lo schema "subscription" osservato nel
// benchmark reale (member_id relation, plan_type select, price number,
// start_date/expiry_date date, status state — nessun campo "text").
// ═══════════════════════════════════════════════════════════════════════════

function subscriptionLikeFields(): FieldDef[] {
  return [
    field({ name: 'member_id', type: 'relation', label: 'Member', targetTable: 'member', targetLabel: 'full_name' }),
    field({ name: 'plan_type', type: 'select', label: 'Plan Type', options: ['Monthly', 'Annual'] }),
    field({ name: 'price', type: 'number', label: 'Price' }),
    field({ name: 'start_date', type: 'date', label: 'Start Date' }),
    field({ name: 'expiry_date', type: 'date', label: 'Expiry Date' }),
    field({ name: 'status', type: 'state', label: 'Status', states: ['active', 'expired'] }),
  ];
}

test('pickIdentityFields: senza alcun campo "text", sceglie il campo relation come titolo (mai un number/date/state grezzo)', () => {
  const { titleField } = pickIdentityFields(subscriptionLikeFields());
  assert.equal(titleField?.type, 'relation');
  assert.equal(titleField && (titleField.name), 'member_id');
});

test('pickIdentityFields: il campo prezzo (anche in inglese, "price") è escluso dal sottotitolo grazie a findDisplayPriceField language-independent', () => {
  const { subtitleFields, priceField } = pickIdentityFields(subscriptionLikeFields());
  assert.equal(priceField?.name, 'price');
  assert.ok(!subtitleFields.some((f) => f.name === 'price'), 'price non deve comparire tra i sottotitoli: è già il campo prezzo dedicato');
});

test('pickIdentityFields: con un campo "text" presente, il comportamento pre-esistente resta invariato (nessuna regressione)', () => {
  const fields = [
    field({ name: 'nome_prodotto', type: 'text', label: 'Nome Prodotto' }),
    field({ name: 'categoria', type: 'select', label: 'Categoria', options: ['A', 'B'] }),
    field({ name: 'prezzo', type: 'currency', label: 'Prezzo' }),
  ];
  const { titleField } = pickIdentityFields(fields);
  assert.equal(titleField?.name, 'nome_prodotto');
});

test('findDisplayPriceField: riconosce "price" (EN) esattamente come "prezzo"/"costo" (IT) — nessuna dipendenza dalla lingua', () => {
  const enFields = [field({ name: 'price', type: 'number', label: 'Price' })];
  const itFields = [field({ name: 'prezzo', type: 'number', label: 'Prezzo' })];
  assert.equal(findDisplayPriceField(enFields)?.name, 'price');
  assert.equal(findDisplayPriceField(itFields)?.name, 'prezzo');
});

test('findDisplayPriceField: esclude "prezzo_acquisto"/"purchase_price" (costo interno), preferisce "prezzo_vendita"/"selling_price"', () => {
  const fields = [
    field({ name: 'prezzo_acquisto', type: 'number', label: 'Prezzo Acquisto' }),
    field({ name: 'prezzo_vendita', type: 'number', label: 'Prezzo Vendita' }),
  ];
  assert.equal(findDisplayPriceField(fields)?.name, 'prezzo_vendita');
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX BLOCKER TEST D (debug V3, app "ristorazione") — isRestaurantMenuGridTable
//
// Bug reale riprodotto in produzione: RestaurantLayoutContent
// (DynamicLayoutRenderer.tsx, layout dedicato al settore "ristorazione",
// PRE-ESISTENTE — mai toccato da CreatorAI v2/v3) ha una griglia "menu"
// hardcoded pensata per UNA SOLA tabella, "piatti" — ma la applicava a
// QUALUNQUE tabella attiva del blueprint. Per un'app "Trattoria da Marco"
// con schema legittimo a 4 tabelle (piatti/clienti/ordini/righe_ordine),
// selezionare "Clienti", "Ordini" o "Righe Ordine" mostrava una griglia
// vuota SENZA alcun pulsante "Nuovo" né messaggio "Nessun record presente"
// — un vicolo cieco totale, non un semplice difetto estetico.
// ═══════════════════════════════════════════════════════════════════════════

test('isRestaurantMenuGridTable: "piatti" è l\'unica tabella per cui la griglia menu ha senso', () => {
  assert.equal(isRestaurantMenuGridTable('piatti'), true);
});

test('isRestaurantMenuGridTable: le altre 3 tabelle reali dell\'app "Trattoria da Marco" (blocker TEST D) richiedono il fallback generico', () => {
  assert.equal(isRestaurantMenuGridTable('clienti'), false);
  assert.equal(isRestaurantMenuGridTable('ordini'), false);
  assert.equal(isRestaurantMenuGridTable('righe_ordine'), false);
});

test('isRestaurantMenuGridTable: nessuna tabella attiva (null/undefined) -> false, mai un crash', () => {
  assert.equal(isRestaurantMenuGridTable(undefined), false);
  assert.equal(isRestaurantMenuGridTable(null), false);
});
