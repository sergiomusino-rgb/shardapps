// ─── Test isolati — Quality Pass v1.1, Fix #2 (normalizeFieldType supporto "number") ──
// node:test nativo, nessuna dipendenza esterna: FieldSchema è la superficie
// pubblica che esercita normalizeFieldType (non esportata direttamente),
// stesso principio dei test in site-schema.test.ts.
//
// Uso: node --test src/lib/blueprint-schema.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldSchema } from './blueprint-schema.ts';

function fieldType(raw: Record<string, unknown>): string {
  return FieldSchema.parse(raw).type;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix #2 — "number" ora riconosciuto (prima cadeva su 'text', bug confermato
// in produzione: v. report Quality Pass v1, TEST 2 Interventi Tecnici,
// campo ore_lavorate/costo dichiarati "number" dal modello e persistiti come
// "text").
// ═══════════════════════════════════════════════════════════════════════════
test('type "number" -> "number" (fix: prima diventava "text")', () => {
  // Nome/label neutri, senza keyword di prezzo: prima di questo fix
  // l'unico modo per un campo "number" di restare numerico era che il nome
  // contenesse una parola come "costo"/"prezzo" (withPriceFieldOverride) —
  // qui verifichiamo che il tipo dichiarato da solo basti.
  assert.equal(fieldType({ id: 'ore_lavorate', type: 'number', label: 'Ore Lavorate' }), 'number');
  assert.equal(fieldType({ id: 'quantita', type: 'NUMBER', label: 'Quantità' }), 'number'); // case-insensitive, comportamento invariato
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione: gli alias SQL-style già mappati restano invariati.
// ═══════════════════════════════════════════════════════════════════════════
test('alias numerici pre-esistenti (integer/int/bigint/decimal/float/double/numeric) restano "number"', () => {
  for (const alias of ['integer', 'int', 'bigint', 'decimal', 'float', 'double', 'numeric']) {
    assert.equal(fieldType({ id: 'x', type: alias, label: 'X' }), 'number', `alias "${alias}" deve restare "number"`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione: tutti gli altri tipi già supportati restano invariati.
// ═══════════════════════════════════════════════════════════════════════════
test('altri tipi già supportati non regrediscono', () => {
  assert.equal(fieldType({ id: 'x', type: 'text', label: 'X' }), 'text');
  assert.equal(fieldType({ id: 'x', type: 'string', label: 'X' }), 'text');
  assert.equal(fieldType({ id: 'x', type: 'currency', label: 'X' }), 'currency');
  assert.equal(fieldType({ id: 'x', type: 'select', label: 'X' }), 'select');
  assert.equal(fieldType({ id: 'x', type: 'multiselect', label: 'X' }), 'multiselect');
  assert.equal(fieldType({ id: 'x', type: 'state', label: 'X', states: ['a', 'b'] }), 'state');
  assert.equal(fieldType({ id: 'x', type: 'date', label: 'X' }), 'date');
  assert.equal(fieldType({ id: 'x', type: 'datetime', label: 'X' }), 'datetime');
  assert.equal(fieldType({ id: 'x', type: 'timestamp', label: 'X' }), 'datetime');
  assert.equal(fieldType({ id: 'x', type: 'boolean', label: 'X' }), 'boolean');
  assert.equal(fieldType({ id: 'x', type: 'bool', label: 'X' }), 'boolean');
  assert.equal(fieldType({ id: 'x', type: 'email', label: 'X' }), 'email');
  assert.equal(fieldType({ id: 'x', type: 'phone', label: 'X' }), 'phone');
  assert.equal(fieldType({ id: 'x', type: 'textarea', label: 'X' }), 'textarea');
  assert.equal(fieldType({ id: 'x', type: 'file', label: 'X' }), 'file');
  assert.equal(fieldType({ id: 'x', type: 'image', label: 'X' }), 'image');
  assert.equal(
    fieldType({ id: 'x', type: 'relation', label: 'X', targetEntity: 'y', displayField: 'nome' }),
    'relation'
  );
});

test('un tipo davvero sconosciuto continua a ricadere su "text" (fallback invariato)', () => {
  assert.equal(fieldType({ id: 'x', type: 'tipo-mai-visto-xyz', label: 'X' }), 'text');
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione mirata: il campo "costo"/"prezzo" con keyword di prezzo nel
// nome continua a funzionare via withPriceFieldOverride ANCHE quando il tipo
// dichiarato era "text" (comportamento pre-esistente, non toccato da questo
// fix — il fix #2 aggiunge un secondo percorso, non sostituisce il primo).
// ═══════════════════════════════════════════════════════════════════════════
test('withPriceFieldOverride resta invariato: un campo "text" con keyword di prezzo nel nome diventa comunque "number"', () => {
  assert.equal(fieldType({ id: 'costo_totale', type: 'text', label: 'Costo Totale' }), 'number');
});
