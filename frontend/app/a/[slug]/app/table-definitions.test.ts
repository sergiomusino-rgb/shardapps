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
import { selectQuickActionTables, computeDashboardCardValue, sortTablesForSidebar } from './table-definitions.ts';
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
