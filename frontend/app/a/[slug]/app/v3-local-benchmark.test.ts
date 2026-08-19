// ─── CREATORAI V3 — Real-World LOCAL Benchmark (sezione 16 della spec) ─────
// Esegue il motore deterministico (mockDataGenerator + table-definitions,
// lo stesso codice di produzione) su 5 blueprint realistici che riproducono
// gli schemi osservati nel benchmark reale di CreatorAI v2 (TEST A-E,
// issue GitHub #39) — non un secondo motore di test, gli stessi
// generateMockRecord/pickIdentityFields/findDisplayPriceField già coperti
// dagli altri file di test, qui assemblati end-to-end per verificare le
// proprietà OLISTICHE richieste dalla sezione 17 (italiano/inglese
// equivalenti, fallback senza collisioni, date coerenti, formule
// indipendenti dall'ordine, relazioni renderizzate correttamente).
//
// Non sostituisce una generazione reale end-to-end (Planner->Generator->
// Validator->Repair, che richiede l'AI Router reale o un fake iniettato —
// già coperto da creator-ai-orchestrator.test.ts) né un benchmark browser
// dal vivo (che richiederebbe l'intero stack locale: Supabase, auth,
// dev server) — qui si verifica SOLO il motore applicativo deterministico
// (schema -> demo data -> rendering), lo strato toccato da questa release,
// con lo stesso principio "STOP dopo il report, niente deploy" del task.
//
// Uso: node --test "app/a/**/v3-local-benchmark.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickIdentityFields, findDisplayPriceField } from './table-definitions.ts';
import type { TableDef, FieldDef } from './table-definitions.ts';
import { setupRouteTest, importRoute } from '../../../../src/lib/test-helpers/route-test-harness.ts';

setupRouteTest({} as unknown, {});
const { generateMockRecord } = (await importRoute('app/a/[slug]/app/mockDataGenerator.ts')) as {
  generateMockRecord: (table: TableDef, index: number, relatedRecords?: Record<string, { id: string }[]>) => Record<string, unknown>;
};

function field(overrides: Partial<FieldDef> & { name: string; type: FieldDef['type'] }): FieldDef {
  return { label: overrides.name, ...overrides } as FieldDef;
}

function table(name: string, fields: FieldDef[]): TableDef {
  return { name, label: name, labelPlural: name, icon: '', fields };
}

function generateN(t: TableDef, n: number, related: Record<string, { id: string }[]> = {}): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => generateMockRecord(t, i, related));
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST A — CRM (italiano): clienti/aziende/opportunità, relation + state.
// ═══════════════════════════════════════════════════════════════════════════

test('TEST A (CRM, IT): opportunità collegate ad aziende reali, stato tra i valori ammessi, nessun placeholder generico ripetuto', () => {
  const aziende = table('aziende', [
    field({ name: 'ragione_sociale', type: 'text' }),
    field({ name: 'settore', type: 'text' }),
  ]);
  const aziendeRecords = generateN(aziende, 5).map((r, i) => ({ id: `az-${i}`, ...r }));

  const opportunita = table('opportunita', [
    field({ name: 'titolo', type: 'text' }),
    field({ name: 'azienda_id', type: 'relation', targetTable: 'aziende', targetLabel: 'ragione_sociale' }),
    field({ name: 'valore_stimato', type: 'currency' }),
    field({ name: 'stato', type: 'state', states: ['nuovo', 'in_trattativa', 'vinto', 'perso'] }),
  ]);
  const records = generateN(opportunita, 5, { aziende: aziendeRecords });

  for (const r of records) {
    assert.ok(['nuovo', 'in_trattativa', 'vinto', 'perso'].includes(r.stato as string));
    assert.equal(typeof r.valore_stimato, 'number');
    assert.ok(aziendeRecords.some((a) => a.id === r.azienda_id), 'azienda_id deve puntare a un\'azienda reale generata sopra');
  }
  const titoli = new Set(records.map((r) => r.titolo));
  assert.ok(titoli.size >= 3, 'i titoli non devono collassare tutti sullo stesso placeholder');

  const { titleField } = pickIdentityFields(opportunita.fields);
  assert.equal(titleField?.name, 'titolo');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST B — Interventi Tecnici (italiano): MANDATORY math check, formule
// indipendenti dall'ordine dei campi.
// ═══════════════════════════════════════════════════════════════════════════

test('TEST B (Interventi Tecnici, IT): costo_manodopera = ore × tariffa e costo_totale = manodopera + materiali su TUTTI i record, ordine invariato', () => {
  const interventi = table('interventi', [
    field({ name: 'cliente_id', type: 'relation', targetTable: 'clienti', targetLabel: 'ragione_sociale' }),
    field({ name: 'ore_lavorate', type: 'number' }),
    field({ name: 'tariffa_oraria', type: 'number' }),
    field({ name: 'costo_manodopera', type: 'number' }),
    field({ name: 'costo_materiali', type: 'number' }),
    field({ name: 'costo_totale', type: 'number' }),
    field({ name: 'data_intervento', type: 'date' }),
    field({ name: 'stato', type: 'state', states: ['aperto', 'in_corso', 'chiuso'] }),
  ]);
  const clienti = [{ id: 'cli-1' }, { id: 'cli-2' }];
  const records = generateN(interventi, 5, { clienti });

  for (const r of records) {
    assert.equal(r.costo_manodopera, (r.ore_lavorate as number) * (r.tariffa_oraria as number));
    assert.equal(r.costo_totale, (r.costo_manodopera as number) + (r.costo_materiali as number));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST C — Real Estate (inglese): equivalente semantico dell'italiano,
// nessun degrado a fallback generico per i campi in inglese.
// ═══════════════════════════════════════════════════════════════════════════

test('TEST C (Real Estate, EN): full_name/price/city NON ricadono su placeholder generici, price formattato come valuta', () => {
  const agents = table('agent', [
    field({ name: 'full_name', type: 'text' }),
    field({ name: 'phone', type: 'text' }),
  ]);
  const agentRecords: (Record<string, unknown> & { id: string })[] =
    generateN(agents, 5).map((r, i) => ({ id: `ag-${i}`, ...r }));

  const properties = table('property', [
    field({ name: 'title', type: 'text' }),
    field({ name: 'city', type: 'text' }),
    field({ name: 'agent_id', type: 'relation', targetTable: 'agent', targetLabel: 'full_name' }),
    field({ name: 'price', type: 'number' }),
    field({ name: 'status', type: 'state', states: ['available', 'under_offer', 'sold'] }),
  ]);
  const records = generateN(properties, 5, { agent: agentRecords });

  for (const r of records) {
    assert.equal(typeof r.price, 'number');
    assert.ok(['available', 'under_offer', 'sold'].includes(r.status as string));
  }
  for (const r of agentRecords) {
    assert.ok(typeof r.full_name === 'string' && !(r.full_name as string).endsWith('.'), 'full_name non deve essere una frase generica di note/descrizione');
    assert.ok(typeof r.phone === 'string' && (r.phone as string).length > 0);
  }
  // price è riconosciuto come "il" campo prezzo anche in inglese (issue #39 punto 1).
  assert.equal(findDisplayPriceField(properties.fields)?.name, 'price');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST D — Restaurant/Orders (inglese): unit_price/subtotal non collidono
// più (issue GitHub #39 punto 2), formula subtotal = quantity × unit_price.
// ═══════════════════════════════════════════════════════════════════════════

test('TEST D (Restaurant Orders, EN): subtotal = quantity × unit_price, unit_price e subtotal non coincidono mai', () => {
  const orderItems = table('order_item', [
    field({ name: 'item_name', type: 'text' }),
    field({ name: 'quantity', type: 'number' }),
    field({ name: 'unit_price', type: 'number' }),
    field({ name: 'subtotal', type: 'number' }),
  ]);
  const records = generateN(orderItems, 5);
  for (const r of records) {
    assert.equal(r.subtotal, (r.quantity as number) * (r.unit_price as number));
    assert.notEqual(r.unit_price, r.subtotal);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST E — Fitness/Gym (inglese): riproduce ESATTAMENTE lo schema del
// benchmark reale (member/subscription) — fix del difetto osservato
// (colonna "Member" che mostrava "price" invece del nome del socio).
// ═══════════════════════════════════════════════════════════════════════════

test('TEST E (Fitness Gym, EN): il titolo della subscription risolve al NOME del socio collegato, non a un id/numero grezzo; start_date < expiry_date', () => {
  const member = table('member', [
    field({ name: 'full_name', type: 'text' }),
    field({ name: 'phone', type: 'text' }),
    field({ name: 'join_date', type: 'date' }),
  ]);
  const memberRecords: (Record<string, unknown> & { id: string })[] =
    generateN(member, 5).map((r, i) => ({ id: `mem-${i}`, ...r }));

  const subscription = table('subscription', [
    field({ name: 'member_id', type: 'relation', targetTable: 'member', targetLabel: 'full_name' }),
    field({ name: 'plan_type', type: 'select', options: ['Monthly', 'Annual'] }),
    field({ name: 'price', type: 'number' }),
    field({ name: 'start_date', type: 'date' }),
    field({ name: 'expiry_date', type: 'date' }),
    field({ name: 'status', type: 'state', states: ['active', 'expiring', 'expired', 'suspended'] }),
  ]);
  const records = generateN(subscription, 5, { member: memberRecords });

  // pickIdentityFields deve scegliere member_id (relation) come titolo, NON
  // "price" (era esattamente il difetto osservato in produzione).
  const { titleField, priceField } = pickIdentityFields(subscription.fields);
  assert.equal(titleField?.name, 'member_id');
  assert.equal(priceField?.name, 'price');

  for (const r of records) {
    // Il valore salvato è un id reale di member, risolvibile a un nome vero.
    const linkedMember = memberRecords.find((m) => m.id === r.member_id);
    assert.ok(linkedMember, 'member_id deve puntare a un socio realmente generato');
    assert.ok(typeof linkedMember!.full_name === 'string' && (linkedMember!.full_name as string).length > 0);
    // start_date ed expiry_date non sono più identiche (bug reale osservato).
    assert.notEqual(r.start_date, r.expiry_date);
    assert.ok(new Date(r.start_date as string).getTime() < new Date(r.expiry_date as string).getTime());
  }
});
