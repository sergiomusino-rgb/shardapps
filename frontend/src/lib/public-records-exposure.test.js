// ─── Test della decisione di esposizione (Public Records API — fix Blocker #1
// audit pre-lancio 2026-08-14) ───────────────────────────────────────────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js/Supabase — copre solo isEntityExposedInPublicPages (logica
// pura), stesso pattern degli altri *-authorization.test.js di questa
// cartella.
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { isEntityExposedInPublicPages } = require('./public-records-exposure');

// Blueprint con una sezione pubblica 'list' su 'menu_items' (es. il menu di
// un ristorante) e un'entità 'clienti' MAI referenziata da nessuna pagina
// pubblica (gestita solo dal pannello admin) — lo scenario esatto del
// BLOCKER #1: prima della patch, per un'app non-rbac, 'clienti' sarebbe
// stata comunque leggibile da qui.
const BLUEPRINT_MIXED = {
  pages: [
    {
      sections: [
        { type: 'hero' },
        { type: 'list', entity: 'menu_items' },
      ],
    },
    {
      sections: [
        { type: 'form', entity: 'contact_requests' },
      ],
    },
  ],
};

const BLUEPRINT_NO_SECTIONS = { pages: [] };

test('entità referenziata da una sezione "list" pubblica -> esposta', () => {
  assert.equal(isEntityExposedInPublicPages(BLUEPRINT_MIXED, 'menu_items'), true);
});

test('entità referenziata da una sezione "form" pubblica -> esposta', () => {
  assert.equal(isEntityExposedInPublicPages(BLUEPRINT_MIXED, 'contact_requests'), true);
});

test('BLOCKER #1: entità presente solo in adminPanel.entities, mai in una sezione pubblica -> NON esposta', () => {
  // "clienti" non compare in nessuna sezione list/form del blueprint sopra:
  // deve restare privata a prescindere da auth_mode dell'app (quel controllo
  // vive ora nella route, non più qui).
  assert.equal(isEntityExposedInPublicPages(BLUEPRINT_MIXED, 'clienti'), false);
});

test('sezione di tipo diverso da list/form con lo stesso nome entity -> NON esposta', () => {
  const blueprint = { pages: [{ sections: [{ type: 'hero', entity: 'clienti' }] }] };
  assert.equal(isEntityExposedInPublicPages(blueprint, 'clienti'), false);
});

test('blueprint senza pagine -> nessuna entità esposta', () => {
  assert.equal(isEntityExposedInPublicPages(BLUEPRINT_NO_SECTIONS, 'menu_items'), false);
});
