// ─── Test isolati — CreatorAI Engine 2.0, Fase 1 (4° projectType "gestionale") ──
// node:test nativo (Node 24), stesso stile/motivazione di app-specification.test.ts:
// nessuna chiamata AI/rete/DB, solo le funzioni pure esportate da site-schema.ts
// (sanitizeSiteBlueprint, ProjectTypeSchema) + gli adattatori di Fase 0
// (app-specification.ts), per verificare che l'aggiunta del 4° projectType non
// rompa nulla del comportamento esistente e che "gestionale" sia realmente
// sector-agnostic.
//
// Uso: node --test src/lib/site-schema.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectTypeSchema, SiteBlueprintSchema, sanitizeSiteBlueprint, type SiteBlueprintJSON } from './site-schema.ts';
import type { BlueprintJSON } from './blueprint-schema.ts';
import { toAppSpecificationFromBlueprint } from './app-specification.ts';

// ─── Fixture base riusabile: gestionale minimale valido ─────────────────────
function gestionaleFixture(overrides: Partial<SiteBlueprintJSON> = {}): unknown {
  return {
    projectType: 'gestionale',
    appName: 'Il Mio Gestionale',
    sector: 'custom',
    description: '',
    businessConfig: { name: 'Il Mio Gestionale', language: 'it' },
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
          ],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — projectType gestionale accettato
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 1: ProjectTypeSchema accetta "gestionale"', () => {
  assert.equal(ProjectTypeSchema.parse('gestionale'), 'gestionale');
});

test('TEST 1b: SiteBlueprintSchema.parse accetta un blueprint completo con projectType "gestionale"', () => {
  const parsed = SiteBlueprintSchema.parse(gestionaleFixture());
  assert.equal(parsed.projectType, 'gestionale');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 — gestionale genera entities
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 2: sanitizeSiteBlueprint preserva le entities di un gestionale', () => {
  const result = sanitizeSiteBlueprint(gestionaleFixture());
  assert.ok(result);
  assert.equal(result?.adminPanel.entities.length, 1);
  assert.equal(result?.adminPanel.entities[0].name, 'clienti');
  // requisito esplicito Fase 1: pages sempre presenti (min 1, vincolo di
  // site-schema.ts invariato) ma vuote di contenuto pubblico per gestionale.
  assert.equal(result?.pages.length, 1);
  assert.deepEqual(result?.pages[0].sections, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — settore libero funziona (nessun hardcoding di dominio)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 3: un settore libero/non catalogato passa invariato (nessun vincolo di dominio)', () => {
  const result = sanitizeSiteBlueprint(gestionaleFixture({ sector: 'apicoltura-biologica-artigianale' } as Partial<SiteBlueprintJSON>));
  assert.equal(result?.sector, 'apicoltura-biologica-artigianale');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4 — CRM (entities con relazioni e stati)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 4: CRM (clienti/aziende/opportunità con relation e state) è rappresentabile', () => {
  const crm = gestionaleFixture({
    sector: 'crm',
    adminPanel: {
      entities: [
        { name: 'aziende', label: 'Azienda', labelPlural: 'Aziende', icon: '🏢', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'ragione_sociale', type: 'text', label: 'Ragione Sociale', required: true },
        ], actions: [] },
        { name: 'opportunita', label: 'Opportunità', labelPlural: 'Opportunità', icon: '💼', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'azienda_id', type: 'relation', label: 'Azienda', targetEntity: 'aziende', displayField: 'ragione_sociale' },
          { id: 'stato', type: 'state', label: 'Stato', states: ['lead', 'qualified', 'proposal', 'won', 'lost'],
            allowedTransitions: { lead: ['qualified'], qualified: ['proposal'], proposal: ['won', 'lost'] } },
        ], actions: [
          { id: 'segna_vinta', label: 'Segna vinta', type: 'change_state', targetState: 'won' },
        ] },
      ],
    },
  } as unknown as Partial<SiteBlueprintJSON>) as { adminPanel: unknown };

  const result = sanitizeSiteBlueprint(crm);
  assert.ok(result);
  const opportunita = result?.adminPanel.entities.find((e) => e.name === 'opportunita');
  const relationField = opportunita?.fields.find((f) => f.id === 'azienda_id');
  assert.equal(relationField?.targetEntity, 'aziende');
  assert.equal(relationField?.displayField, 'ragione_sociale');
  const stateField = opportunita?.fields.find((f) => f.id === 'stato');
  assert.deepEqual(stateField?.states, ['lead', 'qualified', 'proposal', 'won', 'lost']);
  assert.equal(opportunita?.actions.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5 — helpdesk (dominio diverso dal CRM, stessa genericità)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 5: helpdesk (ticket/operatori) è rappresentabile con lo stesso motore, nessun hardcoding', () => {
  const helpdesk = gestionaleFixture({
    sector: 'helpdesk-it',
    adminPanel: {
      entities: [
        { name: 'operatori', label: 'Operatore', labelPlural: 'Operatori', icon: '🧑‍💻', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'nome', type: 'text', label: 'Nome', required: true },
        ], actions: [] },
        { name: 'ticket', label: 'Ticket', labelPlural: 'Ticket', icon: '🎫', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'operatore_id', type: 'relation', label: 'Assegnato a', targetEntity: 'operatori', displayField: 'nome' },
          { id: 'stato', type: 'state', label: 'Stato', states: ['aperto', 'in_lavorazione', 'chiuso'],
            allowedTransitions: { aperto: ['in_lavorazione'], in_lavorazione: ['chiuso'] } },
        ], actions: [
          { id: 'chiudi', label: 'Chiudi ticket', type: 'change_state', targetState: 'chiuso' },
        ] },
      ],
    },
  } as unknown as Partial<SiteBlueprintJSON>) as { adminPanel: unknown };

  const result = sanitizeSiteBlueprint(helpdesk);
  assert.ok(result);
  assert.equal(result?.adminPanel.entities.length, 2);
  assert.equal(result?.sector, 'helpdesk-it');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6 — relazione tra entità (validazione semantica esistente, non ri-derivata)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 6: relation verso un\'entità inesistente viene degradata a text (comportamento esistente, non ri-implementato)', () => {
  const withDanglingRelation = gestionaleFixture({
    adminPanel: {
      entities: [
        { name: 'ordini', label: 'Ordine', labelPlural: 'Ordini', icon: '📦', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'cliente_id', type: 'relation', label: 'Cliente', targetEntity: 'entita_mai_esistita', displayField: 'nome' },
        ], actions: [] },
      ],
    },
  } as unknown as Partial<SiteBlueprintJSON>) as { adminPanel: unknown };

  const result = sanitizeSiteBlueprint(withDanglingRelation);
  const field = result?.adminPanel.entities[0].fields.find((f) => f.id === 'cliente_id');
  assert.equal(field?.type, 'text');
  assert.equal(field?.targetEntity, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7 — state machine (transizioni verso stati inesistenti filtrate)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 7: allowedTransitions verso uno stato inesistente viene filtrata (comportamento esistente, non ri-implementato)', () => {
  const withBadTransition = gestionaleFixture({
    adminPanel: {
      entities: [
        { name: 'progetti', label: 'Progetto', labelPlural: 'Progetti', icon: '📋', fields: [
          { id: 'id', type: 'id', label: 'ID' },
          { id: 'stato', type: 'state', label: 'Stato', states: ['nuovo', 'in_corso', 'completato'],
            allowedTransitions: { nuovo: ['in_corso', 'stato_inventato'], in_corso: ['completato'] } },
        ], actions: [] },
      ],
    },
  } as unknown as Partial<SiteBlueprintJSON>) as { adminPanel: unknown };

  const result = sanitizeSiteBlueprint(withBadTransition);
  const field = result?.adminPanel.entities[0].fields.find((f) => f.id === 'stato');
  assert.deepEqual(field?.allowedTransitions?.nuovo, ['in_corso']);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 — app v1 (BlueprintJSON) ancora adattabile ad AppSpecification
// (regressione sugli adattatori di Fase 0, riusati qui senza modifiche)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 8: un BlueprintJSON v1 resta correttamente adattabile ad AppSpecification dopo le modifiche di Fase 1', () => {
  const v1: BlueprintJSON = {
    appName: 'Gestionale Legacy',
    sector: 'legacy-sector',
    description: '',
    logo: '',
    schema: { tables: [{ name: 'contatti', label: 'Contatto', labelPlural: 'Contatti', icon: '', fields: [
      { id: 'id', type: 'id', label: 'ID', required: false, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
    ] }] },
    ui: { primaryColor: '#6366f1', sidebar: [], dashboardCards: [] },
  };
  const spec = toAppSpecificationFromBlueprint(v1);
  assert.equal(spec.projectType, 'gestionale');
  assert.equal(spec.entities.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9 — app v2 esistente (landing) non regressa dall'aggiunta del 4° tipo
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 9: un blueprint "landing" già esistente continua a validare esattamente come prima', () => {
  const landing = {
    projectType: 'landing',
    appName: 'Studio Rossi',
    sector: 'consulenza',
    description: '',
    businessConfig: { name: 'Studio Rossi', language: 'it' },
    adminPanel: { entities: [] },
    pages: [{ slug: 'home', label: 'Home', sections: [{ type: 'hero', title: 'Benvenuto' }] }],
    actionButtons: [],
    ui: { primaryColor: '#334155' },
  };
  const result = sanitizeSiteBlueprint(landing);
  assert.ok(result);
  assert.equal(result?.projectType, 'landing');
  assert.equal(result?.adminPanel.entities.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 10 — gli altri 3 projectType continuano a funzionare (per ciascuno)
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 10: landing/webapp-pwa/ecommerce restano tutti e tre validi in ProjectTypeSchema e SiteBlueprintSchema', () => {
  for (const pt of ['landing', 'webapp-pwa', 'ecommerce'] as const) {
    assert.equal(ProjectTypeSchema.parse(pt), pt);
    const fixture = {
      projectType: pt,
      appName: `App ${pt}`,
      sector: 'test',
      businessConfig: { name: `App ${pt}`, language: 'it' },
      adminPanel: { entities: [] },
      pages: [{ slug: 'home', label: 'Home', sections: [] }],
      actionButtons: [],
      ui: { primaryColor: '#6366f1' },
    };
    const parsed = SiteBlueprintSchema.parse(fixture);
    assert.equal(parsed.projectType, pt);
  }
});
