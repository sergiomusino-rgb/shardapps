// ─── Test isolati — Fix blocker CRUD custom entities (production, "Lumen CRM") ─
// node:test nativo, nessuna dipendenza esterna (designTokens.ts non importa
// nulla di pesante, testabile direttamente). Vedi commento in
// SECTOR_KEYWORD_FALLBACK (designTokens.ts) per il root cause: il keyword
// 'market' matchava come sottostringa anche "marketing", dirottando un
// gestionale/CRM di un'agenzia di marketing sul layout 'ecommerce' invece
// del layout generico 'saas' — qui verifichiamo sia la regressione specifica
// sia che i casi legittimi di retail/e-commerce restino invariati.
//
// Uso: node --test "lib/designTokens.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { getDesignKeyForSector, getLayoutTypeForSector } from './designTokens.ts';

test('un\'agenzia di marketing NON deve risolvere sul design/layout e-commerce (bug "Lumen CRM")', () => {
  assert.notEqual(getDesignKeyForSector('marketing'), 'marketnest');
  assert.notEqual(getLayoutTypeForSector('marketing'), 'ecommerce');
});

test('"agenzia di marketing" come extraText (appName+description) non deve collidere con "market"', () => {
  assert.notEqual(getDesignKeyForSector('gestionale', 'Lumen Marketing Agency CRM per agenzie di marketing'), 'marketnest');
  assert.notEqual(getLayoutTypeForSector('gestionale', 'Lumen Marketing Agency CRM per agenzie di marketing'), 'ecommerce');
});

test('un gestionale/CRM generico (sector "gestionale") risolve sul layout generico "saas", non "ecommerce"', () => {
  assert.equal(getLayoutTypeForSector('gestionale'), 'saas');
});

test('i settori retail/e-commerce legittimi restano invariati (marketnest/ecommerce)', () => {
  for (const sector of ['negozio', 'shop', 'store', 'retail', 'ecommerce', 'artigianato', 'handmade']) {
    assert.equal(getDesignKeyForSector(sector), 'marketnest', `sector "${sector}" deve restare marketnest`);
    assert.equal(getLayoutTypeForSector(sector), 'ecommerce', `sector "${sector}" deve restare layout ecommerce`);
  }
});

test('"marketplace" (match esatto in SECTOR_TO_DESIGN_KEY) resta marketnest', () => {
  assert.equal(getDesignKeyForSector('marketplace'), 'marketnest');
});

test('supermercato/ipermercato restano marketnest via il fallback per keyword specifico', () => {
  assert.equal(getDesignKeyForSector('generale', 'Supermercato del quartiere'), 'marketnest');
  assert.equal(getDesignKeyForSector('generale', 'Catena di ipermercati'), 'marketnest');
});
