// ─── Test isolati — CreatorAI Engine 2.0, Fase 0 ────────────────────────────
// node:test nativo (Node 24, TypeScript eseguito via type-stripping — stesso
// stile dei *.test.js esistenti in questa cartella, qui in .test.ts perché il
// modulo sotto test usa tipi/valori Zod). Nessuna chiamata di rete/DB/AI,
// nessun import di route Next.js: solo app-specification.ts, in isolamento.
//
// Le fixture v1/v2 sotto sono scritte come letterali già "sanitizzati"
// (stessa forma che blueprint-schema.ts::sanitizeBlueprint / site-schema.ts::
// sanitizeSiteBlueprint produrrebbero), non richiamano quei sanitizer: gli
// adattatori assumono input già valido, per costruzione (vedi commento in
// testa a app-specification.ts).
//
// Uso: node --test src/lib/app-specification.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintJSON } from './blueprint-schema.ts';
import type { SiteBlueprintJSON } from './site-schema';
import {
  AppSpecificationSchema,
  toAppSpecificationFromBlueprint,
  toAppSpecificationFromSiteBlueprint,
  toBlueprintCompatibleTables,
  toAdminPanelCompatibleEntities,
} from './app-specification.ts';

// ─── Fixture v1 (BlueprintJSON, motore "gestionale") ────────────────────────
const V1_BLUEPRINT: BlueprintJSON = {
  appName: 'Gestionale Officina',
  sector: 'officina-meccanica',
  description: 'Gestionale per officina meccanica',
  logo: 'https://example.com/logo.png',
  schema: {
    tables: [
      {
        name: 'clienti',
        label: 'Cliente',
        labelPlural: 'Clienti',
        icon: '👤',
        fields: [
          { id: 'id', type: 'id', label: 'ID', required: false, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
          { id: 'nome', type: 'text', label: 'Nome', required: true, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
        ],
      },
      {
        name: 'interventi',
        label: 'Intervento',
        labelPlural: 'Interventi',
        icon: '🔧',
        fields: [
          { id: 'id', type: 'id', label: 'ID', required: false, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
          // campo relation: deve puntare a un'altra tabella dello stesso schema
          { id: 'cliente_id', type: 'relation', label: 'Cliente', required: false, options: [], target: 'clienti', targetLabel: 'nome', targetEntity: 'clienti', displayField: 'nome', states: undefined, allowedTransitions: undefined },
          // campo state: macchina a stati con transizioni
          {
            id: 'stato', type: 'state', label: 'Stato', required: false, options: [],
            target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined,
            states: ['aperto', 'in_lavorazione', 'chiuso'],
            allowedTransitions: { aperto: ['in_lavorazione'], in_lavorazione: ['chiuso'] },
          },
        ],
      },
    ],
  },
  ui: {
    primaryColor: '#6366f1',
    sidebar: ['clienti', 'interventi'],
    dashboardCards: [{ type: 'count', table: 'interventi', label: 'Interventi aperti', field: '' }],
  },
};

// ─── Fixture v2 (SiteBlueprintJSON, motore "sito/PWA/e-commerce") ───────────
const V2_BLUEPRINT: SiteBlueprintJSON = {
  projectType: 'webapp-pwa',
  appName: 'Pizzeria Da Mario',
  sector: 'ristorazione',
  description: 'Pizzeria con menu e prenotazioni',
  // Fase 4 (Logic/Workflow Engine): campo aggiunto a SiteBlueprintJSON dopo
  // la Fase 0, richiesto qui solo perché questa fixture è un letterale del
  // tipo OUTPUT (post-default) di SiteBlueprintSchema, non un input passato
  // a sanitizeSiteBlueprint — un'app reale generata prima della Fase 4
  // continua a leggere [] di default, invariata.
  workflows: [],
  businessConfig: {
    name: 'Da Mario',
    logoUrl: 'https://example.com/mario-logo.png',
    heroImageUrl: '',
    tagline: 'La vera pizza napoletana',
    description: 'Pizzeria storica dal 1980',
    address: 'Via Roma 1, Napoli',
    whatsapp: '+39 333 1234567',
    phone: '+39 081 1234567',
    email: 'info@damario.it',
    openingHours: [{ day: 'Lun-Dom', hours: '19:00-23:00' }],
    language: 'it',
  },
  adminPanel: {
    entities: [
      {
        name: 'menu',
        label: 'Pizza',
        labelPlural: 'Pizze',
        icon: '🍕',
        fields: [
          { id: 'id', type: 'id', label: 'ID', required: false, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
          { id: 'nome', type: 'text', label: 'Nome', required: true, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
          { id: 'prezzo', type: 'number', label: 'Prezzo', required: true, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
        ],
        actions: [],
      },
      {
        name: 'prenotazioni',
        label: 'Prenotazione',
        labelPlural: 'Prenotazioni',
        icon: '📅',
        fields: [
          { id: 'id', type: 'id', label: 'ID', required: false, options: [], target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined },
          {
            id: 'stato', type: 'state', label: 'Stato', required: false, options: [],
            target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined,
            states: ['nuova', 'confermata', 'annullata'],
            allowedTransitions: { nuova: ['confermata', 'annullata'] },
          },
        ],
        actions: [
          { id: 'conferma', label: 'Conferma', type: 'change_state', targetState: 'confermata', requiredRole: 'operator', webhookUrl: undefined },
        ],
      },
    ],
  },
  pages: [
    {
      slug: 'home',
      label: 'Home',
      sections: [
        { type: 'hero', title: 'Benvenuto da Mario', subtitle: '', imageUrl: '', ctaLabel: '', ctaHref: '' },
        { type: 'list', title: 'Il nostro menu', entity: 'menu', layout: 'grid', emptyLabel: 'Nessuna pizza disponibile' },
        { type: 'form', title: 'Prenota', entity: 'prenotazioni', submitLabel: 'Prenota ora' },
      ],
    },
  ],
  actionButtons: [
    { type: 'whatsapp', label: 'Ordina su WhatsApp', value: '', icon: '' },
  ],
  ui: { primaryColor: '#e11d48', secondaryColor: '#fbbf24', font: 'Inter' },
  authConfig: { enabled: true, supportedRoles: ['admin', 'operator'], defaultRole: 'operator' },
};

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — Blueprint v1 valido -> AppSpecification valido
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 1: Blueprint v1 valido -> AppSpecification valido', () => {
  const spec = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const parsed = AppSpecificationSchema.parse(spec);
  assert.equal(parsed.appName, 'Gestionale Officina');
  assert.equal(parsed.projectType, 'gestionale');
  assert.equal(parsed.entities.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2 — SiteBlueprint v2 valido -> AppSpecification valido
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 2: SiteBlueprint v2 valido -> AppSpecification valido', () => {
  const spec = toAppSpecificationFromSiteBlueprint(V2_BLUEPRINT);
  const parsed = AppSpecificationSchema.parse(spec);
  assert.equal(parsed.appName, 'Pizzeria Da Mario');
  assert.equal(parsed.projectType, 'webapp-pwa');
  assert.equal(parsed.entities.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — Blueprint con relation -> relation preservata
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 3: campo relation (targetEntity/displayField) preservato', () => {
  const spec = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const interventi = spec.entities.find((e) => e.name === 'interventi');
  const relationField = interventi?.fields.find((f) => f.id === 'cliente_id');
  assert.ok(relationField);
  assert.equal(relationField?.type, 'relation');
  assert.equal(relationField?.targetEntity, 'clienti');
  assert.equal(relationField?.displayField, 'nome');
  // legacy target/targetLabel devono restare sincronizzati (comportamento
  // già garantito dal transform di FieldSchema, riusato qui senza modifiche)
  assert.equal(relationField?.target, 'clienti');
  assert.equal(relationField?.targetLabel, 'nome');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4 — Blueprint con state -> states e allowedTransitions preservati
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 4: campo state (states/allowedTransitions) preservato', () => {
  const spec = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const interventi = spec.entities.find((e) => e.name === 'interventi');
  const stateField = interventi?.fields.find((f) => f.id === 'stato');
  assert.ok(stateField);
  assert.deepEqual(stateField?.states, ['aperto', 'in_lavorazione', 'chiuso']);
  assert.deepEqual(stateField?.allowedTransitions, { aperto: ['in_lavorazione'], in_lavorazione: ['chiuso'] });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5 — SiteBlueprint con pages -> pages preservate
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 5: pages (sezioni, entity referenziate) preservate', () => {
  const spec = toAppSpecificationFromSiteBlueprint(V2_BLUEPRINT);
  assert.equal(spec.pages?.length, 1);
  const home = spec.pages?.[0] as unknown as { slug: string; sections: { type: string; entity?: string }[] };
  assert.equal(home.slug, 'home');
  assert.equal(home.sections.length, 3);
  const listSection = home.sections.find((s) => s.type === 'list');
  assert.equal(listSection?.entity, 'menu');
  const formSection = home.sections.find((s) => s.type === 'form');
  assert.equal(formSection?.entity, 'prenotazioni');
  // le entità referenziate dalle sezioni devono esistere davvero tra le
  // entità dell'AppSpecification (stessa garanzia già data da
  // resolveEntityRelations lato site-schema.ts, qui solo verificata non
  // ri-derivata)
  const entityNames = new Set(spec.entities.map((e) => e.name));
  assert.ok(entityNames.has(listSection!.entity!));
  assert.ok(entityNames.has(formSection!.entity!));
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6 — Blueprint senza pages -> AppSpecification valida
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 6: AppSpecification da motore v1 (nessuna pagina pubblica) è valida con pages: []', () => {
  const spec = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const parsed = AppSpecificationSchema.parse(spec);
  assert.deepEqual(parsed.pages, []);
  // il progetto resta comunque valido e completo per il proprio scopo
  // (pannello admin, nessuna superficie pubblica) — pages opzionale non
  // significa "app incompleta"
  assert.equal(parsed.entities.length > 0, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7 — Legacy config con campi opzionali mancanti -> default appropriati
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 7: AppSpecification "a mano" con solo i campi obbligatori applica default sicuri', () => {
  const minimal = AppSpecificationSchema.parse({
    appName: 'App Minima',
    sector: 'custom',
    projectType: 'gestionale',
    ui: { primaryColor: '#6366f1' },
    entities: [],
  });
  assert.equal(minimal.description, '');
  assert.deepEqual(minimal.pages, []);
  assert.deepEqual(minimal.actionButtons, []);
  assert.deepEqual(minimal.entities, []);
  assert.equal(minimal.branding, undefined);
  assert.equal(minimal.businessConfig, undefined);
  assert.equal(minimal.authConfig, undefined);
  assert.equal(minimal.navigation, undefined);
  assert.equal(minimal.dashboard, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8 — Input originale immutato dopo conversione
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 8: gli adattatori non mutano l\'input originale (v1 e v2)', () => {
  // structuredClone, non JSON.parse(JSON.stringify(...)): quest'ultimo
  // eliminerebbe silenziosamente le chiavi con valore `undefined` presenti
  // nelle fixture (es. target/targetLabel/states sui campi non-relation/
  // non-state), producendo uno snapshot strutturalmente diverso dall'originale
  // ancora PRIMA di qualunque mutazione e facendo fallire il confronto per un
  // motivo estraneo alla mutazione che il test vuole verificare.
  const v1Snapshot = structuredClone(V1_BLUEPRINT);
  const v2Snapshot = structuredClone(V2_BLUEPRINT);

  const specFromV1 = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const specFromV2 = toAppSpecificationFromSiteBlueprint(V2_BLUEPRINT);

  // muta lo spec risultante: se condividesse riferimenti con l'input,
  // questa mutazione si propagherebbe alla fixture originale
  specFromV1.entities[0].fields[0].label = 'MUTATO';
  specFromV1.entities.push({ name: 'x', label: 'x', labelPlural: 'x', icon: '', fields: [], actions: [] });
  (specFromV2.pages as unknown as { sections: unknown[] }[])[0].sections.push({ type: 'text', title: '', body: 'MUTATO' });

  assert.deepEqual(V1_BLUEPRINT, v1Snapshot);
  assert.deepEqual(V2_BLUEPRINT, v2Snapshot);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9 — Campi non rappresentabili: fallimento esplicito, NON perdita silenziosa
// ═══════════════════════════════════════════════════════════════════════════
test('TEST 9: un\'entità senza campi viene rifiutata esplicitamente da AppSpecificationSchema (mai silenziosamente svuotata/accettata)', () => {
  assert.throws(() => {
    AppSpecificationSchema.parse({
      appName: 'X',
      sector: 'custom',
      projectType: 'gestionale',
      ui: { primaryColor: '#6366f1' },
      entities: [
        { name: 'vuota', label: 'Vuota', labelPlural: 'Vuote', fields: [] }, // fields vuoto: EntitySchema richiede min(1)
      ],
    });
  }, /entities/);
});

test('TEST 9b: un projectType non riconosciuto viene rifiutato esplicitamente (nessun fallback silenzioso a un valore arbitrario)', () => {
  assert.throws(() => {
    AppSpecificationSchema.parse({
      appName: 'X',
      sector: 'custom',
      projectType: 'tipo-inventato',
      ui: { primaryColor: '#6366f1' },
      entities: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Proiezioni inverse minime — compatibilità con i renderer esistenti
// ═══════════════════════════════════════════════════════════════════════════
test('proiezione inversa: entità v1 -> Table[]-compatibile senza perdita di campi/relation/state', () => {
  const spec = toAppSpecificationFromBlueprint(V1_BLUEPRINT);
  const tables = toBlueprintCompatibleTables(spec);
  assert.equal(tables.length, 2);
  const interventi = tables.find((t) => t.name === 'interventi');
  assert.equal(interventi?.fields.some((f) => f.type === 'relation' && f.targetEntity === 'clienti'), true);
  assert.equal(interventi?.fields.some((f) => f.type === 'state' && f.states?.includes('chiuso')), true);
});

test('proiezione inversa: entità v2 -> AdminEntity[]-compatibile con actions preservate', () => {
  const spec = toAppSpecificationFromSiteBlueprint(V2_BLUEPRINT);
  const entities = toAdminPanelCompatibleEntities(spec);
  const prenotazioni = entities.find((e) => e.name === 'prenotazioni');
  assert.equal(prenotazioni?.actions.length, 1);
  assert.equal(prenotazioni?.actions[0].type, 'change_state');
  assert.equal(prenotazioni?.actions[0].targetState, 'confermata');
});
