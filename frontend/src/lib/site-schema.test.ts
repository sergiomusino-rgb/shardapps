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
import { ProjectTypeSchema, SiteBlueprintSchema, sanitizeSiteBlueprint, coerceObviousNumericFieldTypes, type SiteBlueprintJSON } from './site-schema.ts';
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
  assert.equal(result?.pages.length, 1);
  // Quality Pass v1 (Fix #1): prima un gestionale con "sections": [] restava
  // vuoto (era il comportamento previsto della Fase 1) — la landing pubblica
  // vuota era esattamente il gap sistemico osservato nel benchmark
  // CreatorAI vs Totalum. Ora ensurePagesHaveSections riempie sempre una
  // pagina vuota con una landing di fallback deterministica.
  assert.ok((result?.pages[0].sections.length ?? 0) > 0, 'la home non deve più restare vuota');
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

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY PASS v1 — Fix #1 (landing pubblica vuota) e Fix #3 (dashboardCards)
// ═══════════════════════════════════════════════════════════════════════════

test('TEST 11: buildFallbackLandingSections produce una landing coerente col dominio, mai testo hardcoded identico tra domini diversi', () => {
  const resultCrm = sanitizeSiteBlueprint(gestionaleFixture({
    businessConfig: { name: 'Acme CRM', tagline: 'Gestisci i tuoi clienti', language: 'it' },
  } as unknown as Partial<SiteBlueprintJSON>));
  const resultImmobiliare = sanitizeSiteBlueprint(gestionaleFixture({
    businessConfig: { name: 'Rossi Immobiliare', language: 'it' },
    adminPanel: { entities: [
      { name: 'immobili', label: 'Immobile', labelPlural: 'Immobili', icon: '🏠', fields: [{ id: 'id', type: 'id', label: 'ID' }] },
    ] },
  } as unknown as Partial<SiteBlueprintJSON>));

  assert.ok(resultCrm);
  assert.ok(resultImmobiliare);
  const heroCrm = resultCrm?.pages[0].sections.find((s) => s.type === 'hero');
  const heroImmobiliare = resultImmobiliare?.pages[0].sections.find((s) => s.type === 'hero');
  assert.ok(heroCrm);
  assert.ok(heroImmobiliare);
  // Nomi/tagline diversi -> contenuto hero diverso: non è un template fisso.
  assert.notEqual((heroCrm as { title?: string }).title, (heroImmobiliare as { title?: string }).title);
  // L'entità "immobili" (labelPlural) deve comparire da qualche parte nella
  // landing di Rossi Immobiliare: il fallback deriva davvero dalle entità,
  // non da un testo generico scollegato dal dominio.
  const aboutImmobiliare = resultImmobiliare?.pages[0].sections.find((s) => s.type === 'about') as { body?: string } | undefined;
  assert.ok(aboutImmobiliare?.body?.includes('Immobili'));
});

test('TEST 12: una pagina con sezioni reali non viene mai toccata da ensurePagesHaveSections (backward compat)', () => {
  const landing = {
    projectType: 'landing',
    appName: 'Studio Rossi',
    sector: 'consulenza',
    businessConfig: { name: 'Studio Rossi', language: 'it' },
    adminPanel: { entities: [] },
    pages: [{ slug: 'home', label: 'Home', sections: [{ type: 'hero', title: 'Titolo Reale Esistente' }] }],
    actionButtons: [],
    ui: { primaryColor: '#334155' },
  };
  const result = sanitizeSiteBlueprint(landing);
  assert.equal(result?.pages[0].sections.length, 1);
  assert.equal((result?.pages[0].sections[0] as { title?: string }).title, 'Titolo Reale Esistente');
});

test('TEST 13: dashboardCards assente in un blueprint pre-esistente risolve a [] (backward compat, nessun campo nuovo obbligatorio)', () => {
  const result = sanitizeSiteBlueprint(gestionaleFixture());
  assert.deepEqual(result?.dashboardCards, []);
});

test('TEST 14: dashboardCards valide vengono mantenute, quelle con riferimenti rotti vengono scartate (mai un crash a runtime)', () => {
  const withCards = gestionaleFixture({
    adminPanel: { entities: [
      { name: 'opportunita', label: 'Opportunità', labelPlural: 'Opportunità', icon: '💼', fields: [
        { id: 'id', type: 'id', label: 'ID' },
        // "currency", non "number": blueprint-schema.ts::normalizeFieldType
        // normalizza solo un sottoinsieme di alias verso 'number' (integer/
        // int/bigint/decimal/float/double/numeric — comportamento esistente,
        // non toccato da questo fix) — 'currency' è il tipo che questa stessa
        // codebase usa per i valori monetari (vedi mockDataGenerator.ts) ed è
        // sempre preservato correttamente.
        { id: 'valore_stimato', type: 'currency', label: 'Valore Stimato' },
        { id: 'stato', type: 'state', label: 'Stato', states: ['nuovo', 'vinto'] },
      ] },
    ] },
    dashboardCards: [
      { type: 'count', table: 'opportunita', label: 'Opportunità Totali' },
      { type: 'sum', table: 'opportunita', label: 'Valore Pipeline', field: 'valore_stimato' },
      { type: 'sum', table: 'opportunita', label: 'Campo Inesistente', field: 'campo_mai_esistito' },
      { type: 'count', table: 'tabella_mai_esistita', label: 'Card Orfana' },
    ],
  } as unknown as Partial<SiteBlueprintJSON>);

  const result = sanitizeSiteBlueprint(withCards);
  assert.ok(result);
  assert.equal(result?.dashboardCards.length, 2);
  assert.ok(result?.dashboardCards.some((c) => c.label === 'Opportunità Totali'));
  assert.ok(result?.dashboardCards.some((c) => c.label === 'Valore Pipeline'));
  assert.ok(!result?.dashboardCards.some((c) => c.label === 'Campo Inesistente'));
  assert.ok(!result?.dashboardCards.some((c) => c.label === 'Card Orfana'));
});

test('TEST 15: il percorso di recupero manuale (parse stretto fallito) riempie comunque le pagine vuote e non scarta un blueprint altrimenti valido', () => {
  // "adminPanel" con una entità priva di "labelPlural" (stringa vuota non
  // ammessa da AdminEntitySchema con parse stretto reale in altri casi, ma
  // qui simuliamo un input che fa fallire il parse Zod stretto per un motivo
  // arbitrario diverso dalle pages) forzando il fallback manuale tramite un
  // campo "pages" che il primo passaggio rifiuterebbe come forma ma che
  // normalizePage sa comunque recuperare.
  const malformed = {
    projectType: 'gestionale',
    appName: 'Gestionale Recuperato',
    sector: 'custom',
    businessConfig: { name: 'Gestionale Recuperato', language: 'it' },
    adminPanel: { entities: [
      { name: 'clienti', label: 'Cliente', labelPlural: 'Clienti', icon: '👤', fields: [{ id: 'id', type: 'id', label: 'ID' }] },
    ] },
    // "sections" come stringa anziché array: non valido per il parse Zod
    // stretto di SitePageSchema, forza il fallthrough al recupero manuale.
    pages: [{ slug: 'home', label: 'Home', sections: 'non-un-array' }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  };
  const result = sanitizeSiteBlueprint(malformed);
  assert.ok(result, 'un blueprint recuperabile non deve mai essere scartato del tutto');
  assert.equal(result?.pages.length, 1);
  assert.ok((result?.pages[0].sections.length ?? 0) > 0, 'anche nel percorso di recupero manuale la pagina non deve restare vuota');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V2 — coerceObviousNumericFieldTypes (correzione deterministica
// pre-validazione, mai una chiamata AI)
// ═══════════════════════════════════════════════════════════════════════════

function schemaWithField(fieldId: string, fieldType: string, cardType: 'sum' | 'avg' = 'sum') {
  return {
    projectType: 'gestionale',
    appName: 'Test',
    sector: 'custom',
    businessConfig: { name: 'Test', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'interventi',
          label: 'Intervento',
          labelPlural: 'Interventi',
          icon: '🔧',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: fieldId, type: fieldType, label: fieldId },
          ],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
    dashboardCards: [{ type: cardType, table: 'interventi', label: 'X', field: fieldId }],
  };
}

/** Legge il "type" del secondo campo dell'unica entità della fixture
 * schemaWithField() sopra, senza `any` — solo per questi test. */
function coercedFieldType(fixed: unknown): unknown {
  const entities = (fixed as { adminPanel: { entities: { fields: { type: unknown }[] }[] } }).adminPanel.entities;
  return entities[0].fields[1].type;
}

test('coerceObviousNumericFieldTypes: campo "costo_totale" dichiarato "text" ma referenziato da una sum -> corretto a "currency"', () => {
  const fixed = coerceObviousNumericFieldTypes(schemaWithField('costo_totale', 'text'));
  assert.equal(coercedFieldType(fixed), 'currency');
});

test('coerceObviousNumericFieldTypes: campo "ore_lavorate" dichiarato "text" ma referenziato da una sum -> corretto a "number"', () => {
  const fixed = coerceObviousNumericFieldTypes(schemaWithField('ore_lavorate', 'text'));
  assert.equal(coercedFieldType(fixed), 'number');
});

test('coerceObviousNumericFieldTypes: campo già "number"/"currency" non viene mai declassato o toccato', () => {
  const fixedNumber = coerceObviousNumericFieldTypes(schemaWithField('costo_totale', 'number'));
  assert.equal(coercedFieldType(fixedNumber), 'number');
  const fixedCurrency = coerceObviousNumericFieldTypes(schemaWithField('costo_totale', 'currency'));
  assert.equal(coercedFieldType(fixedCurrency), 'currency');
});

test('coerceObviousNumericFieldTypes: nome campo senza alcuna semantica numerica riconoscibile -> lasciato invariato (mai un\'invenzione)', () => {
  const fixed = coerceObviousNumericFieldTypes(schemaWithField('note_generiche', 'text'));
  assert.equal(coercedFieldType(fixed), 'text');
});

test('coerceObviousNumericFieldTypes: nessuna dashboardCard "sum"/"avg" -> nessuna modifica, nessun crash', () => {
  const schema = { projectType: 'landing', pages: [] };
  assert.equal(coerceObviousNumericFieldTypes(schema), schema);
  assert.equal(coerceObviousNumericFieldTypes(null), null);
  assert.equal(coerceObviousNumericFieldTypes(undefined), undefined);
});
