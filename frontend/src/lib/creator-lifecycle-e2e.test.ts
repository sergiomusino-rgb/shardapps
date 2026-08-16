// ─── Test E2E di lifecycle — CreatorAI Engine 2.0, Fase 7 (chiusura) ────────
// node:test nativo (Node 24), stesso stile delle altre suite: nessuna
// chiamata di rete/AI/DB reale (mai contro OpenRouter/Supabase live — non si
// rischiano mai dati di produzione). Incatena i moduli GIÀ testati
// singolarmente (orchestrator Fase 5, patch engine Fase 6, app-versions Fase
// 6) in un unico flusso end-to-end sullo stesso fake Supabase in-memory:
//
//   generate (orchestrator, AI fake) -> validate -> "publish" v1
//   -> refactor scoped (patch valida) -> "publish" v2 (snapshot v1)
//   -> refactor scoped (patch che perde dati -> fallback simulato) -> "publish" v3 (snapshot v2)
//   -> rollback a v1 (snapshot v3, apps.config torna v1)
//
// "publish" qui è simulato con le stesse primitive che userebbe
// app/api/creator/publish/route.ts (createAppVersion + apps.update) — la
// route HTTP in sé non è testata qui (nessuna infrastruttura di test per le
// route Next.js in questo repo, la sua logica di slot/slug è già fuori
// scope di CreatorAI Engine 2.0), solo il contratto che condivide con
// l'orchestrator/patch-engine: uno SiteBlueprintJSON valido in ingresso.
//
// Uso: node --test src/lib/creator-lifecycle-e2e.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import { runGenerationOrchestrator, type AiCallFn } from './creator-ai-orchestrator.ts';
import { applyAndValidatePatch } from './creator-patch-engine.ts';
import { createAppVersion, listAppVersions, rollbackAppVersion } from './app-versions.ts';
import { sanitizeSiteBlueprint, type SiteBlueprintJSON } from './site-schema.ts';

const GENERATION_JOBS_DEFAULTS = {
  app_id: null, created_by: null, plan: null, specification: null,
  artifacts: {}, error: null, retry_count: 0, fallback_used: false,
};
const APP_VERSIONS_DEFAULTS = { created_by: null, generation_job_id: null };

function fakeAiCall(response: unknown): AiCallFn {
  return async () => ({ content: JSON.stringify(response) });
}

// Schema v1: gestionale con due entità, come le fixture già usate in Fase 5/6.
function rawSchemaV1() {
  return {
    projectType: 'gestionale',
    appName: 'Officina E2E',
    sector: 'officina-meccanica',
    description: '',
    businessConfig: { name: 'Officina E2E', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti', label: 'Cliente', labelPlural: 'Clienti', icon: '👤',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'nome', type: 'text', label: 'Nome', required: true },
          ],
        },
        {
          name: 'interventi', label: 'Intervento', labelPlural: 'Interventi', icon: '🔧',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'cliente_id', type: 'relation', label: 'Cliente', targetEntity: 'clienti', displayField: 'nome' },
          ],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  };
}

test('lifecycle E2E: generate -> validate -> publish v1 -> refactor patch -> publish v2 -> refactor con fallback -> publish v3 -> rollback a v1', async () => {
  const supabase = makeFakeSupabase(
    { generation_jobs: GENERATION_JOBS_DEFAULTS, app_versions: APP_VERSIONS_DEFAULTS },
    { apps: [] }
  );
  const tenantId = 'tenant-e2e';
  const userId = 'user-e2e';
  const appId = 'app-e2e-1';

  // ─── 1. GENERATE (orchestrator: planner fake -> generator fake -> validator) ──
  const genResult = await runGenerationOrchestrator({
    supabase, tenantId, userId,
    userPrompt: 'Gestionale per la mia officina meccanica',
    projectType: 'gestionale', lang: 'it',
    generate: async () => rawSchemaV1(),
    plannerCall: fakeAiCall({ projectType: 'gestionale', sector: 'officina-meccanica', mainEntities: ['clienti', 'interventi'] }),
  });
  assert.equal(genResult.status, 'ready');
  assert.ok(genResult.schema);
  const schemaV1 = genResult.schema!;
  assert.equal(schemaV1.adminPanel.entities.length, 2);

  // ─── 2. PUBLISH v1 (prima pubblicazione: nessuna versione precedente da cui
  // fare snapshot — stesso comportamento di publish/route.ts, ramo "nuova app"). ──
  await (supabase.from('apps') as any).insert({ id: appId, tenant_id: tenantId, config: schemaV1 });
  const versionsAfterV1 = await listAppVersions(supabase, appId, tenantId);
  assert.deepEqual(versionsAfterV1, []); // "app esistente senza versioni"

  // ─── 3. REFACTOR SCOPED (patch RFC6902 valida): aggiunge un campo "telefono" ──
  const patchV1toV2 = [
    { op: 'add', path: '/adminPanel/entities/0/fields/-', value: { id: 'telefono', type: 'text', label: 'Telefono' } },
  ];
  const patchResult = applyAndValidatePatch(schemaV1, patchV1toV2);
  assert.equal(patchResult.ok, true, JSON.stringify(patchResult.errors));
  const schemaV2 = patchResult.schema!;
  assert.ok(schemaV2.adminPanel.entities[0].fields.some((f) => f.id === 'telefono'));
  // Nessuna entità/campo preesistente perso dal refactor.
  assert.equal(schemaV2.adminPanel.entities.length, 2);
  assert.ok(schemaV2.adminPanel.entities[0].fields.some((f) => f.id === 'nome'));

  // ─── 4. PUBLISH v2 (ripubblicazione: snapshot di v1 PRIMA di sovrascrivere,
  // stesso ordine di operazioni di publish/route.ts). ──────────────────────
  await createAppVersion(supabase, { appId, tenantId, config: schemaV1, createdBy: userId, source: 'publish' });
  await (supabase.from('apps') as any).update({ config: schemaV2 }).eq('id', appId);

  const versionsAfterV2 = await listAppVersions(supabase, appId, tenantId);
  assert.equal(versionsAfterV2.length, 1);
  assert.deepEqual(versionsAfterV2[0].config, schemaV1);
  assert.equal(versionsAfterV2[0].source, 'publish');

  // ─── 5. REFACTOR SCOPED che causa una perdita di dati non dichiarata ->
  // fallback OBBLIGATORIO alla riscrittura completa (qui simulata: un output
  // AI "full rewrite" plausibile, passato comunque per lo stesso
  // sanitizeSiteBlueprint usato da refactor/route.ts nel ramo di fallback). ──
  const onlyClienti = schemaV2.adminPanel.entities.filter((e) => e.name === 'clienti');
  const dataLossPatch = [{ op: 'replace', path: '/adminPanel/entities', value: onlyClienti }]; // "interventi" sparisce senza remove esplicita
  const dataLossResult = applyAndValidatePatch(schemaV2, dataLossPatch);
  assert.equal(dataLossResult.ok, false); // rifiutata: nessuna "remove" esplicita su "interventi"
  assert.match(dataLossResult.errors.join(';'), /interventi.*scomparsa senza un'operazione "remove" esplicita/);

  // Fallback: riscrittura completa che aggiunge un'entità "veicoli" mantenendo
  // tutto il resto (stesso schema v2 + una entità in più), sanitizzata come
  // farebbe la route reale.
  const fullRewriteRaw = {
    ...schemaV2,
    adminPanel: {
      entities: [
        ...schemaV2.adminPanel.entities,
        { name: 'veicoli', label: 'Veicolo', labelPlural: 'Veicoli', icon: '🚗', fields: [{ id: 'id', type: 'id', label: 'ID' }, { id: 'targa', type: 'text', label: 'Targa' }] },
      ],
    },
  };
  const schemaV3 = sanitizeSiteBlueprint(fullRewriteRaw) as SiteBlueprintJSON;
  assert.ok(schemaV3);
  assert.equal(schemaV3.adminPanel.entities.length, 3);
  // Nessuna perdita rispetto a v2 nel fallback (il fallback riscrive tutto,
  // ma qui il "modello" ha correttamente preservato quanto non richiesto).
  assert.ok(schemaV3.adminPanel.entities.some((e) => e.name === 'interventi'));
  assert.ok(schemaV3.adminPanel.entities.some((e) => e.name === 'clienti'));

  // ─── 6. PUBLISH v3 (snapshot di v2 prima di sovrascrivere). ─────────────
  await createAppVersion(supabase, { appId, tenantId, config: schemaV2, createdBy: userId, source: 'publish' });
  await (supabase.from('apps') as any).update({ config: schemaV3 }).eq('id', appId);

  const versionsAfterV3 = await listAppVersions(supabase, appId, tenantId);
  assert.equal(versionsAfterV3.length, 2);
  assert.deepEqual(versionsAfterV3[0].config, schemaV2); // più recente prima
  assert.deepEqual(versionsAfterV3[1].config, schemaV1);

  const { data: appAtV3 } = await (supabase.from('apps').select('*').eq('id', appId) as any);
  assert.deepEqual(appAtV3[0].config, schemaV3);

  // ─── 7. ROLLBACK a v1 (azione umana esplicita, mai automatica) ──────────
  const v1VersionRow = versionsAfterV3.find((v) => JSON.stringify(v.config) === JSON.stringify(schemaV1))!;
  const rollbackResult = await rollbackAppVersion(supabase, { versionId: v1VersionRow.id, appId, tenantId, createdBy: userId });
  assert.equal(rollbackResult.ok, true);
  assert.deepEqual((rollbackResult as { restoredConfig: unknown }).restoredConfig, schemaV1);

  const { data: appAfterRollback } = await (supabase.from('apps').select('*').eq('id', appId) as any);
  assert.deepEqual(appAfterRollback[0].config, schemaV1); // ripristinato

  // Il rollback è a sua volta reversibile: v3 (lo stato PRIMA del rollback)
  // è stato salvato come nuova versione, source:'rollback' — nessun dato perso.
  const versionsAfterRollback = await listAppVersions(supabase, appId, tenantId);
  assert.equal(versionsAfterRollback.length, 3);
  const rollbackSnapshot = versionsAfterRollback.find((v) => v.source === 'rollback');
  assert.ok(rollbackSnapshot);
  assert.deepEqual(rollbackSnapshot?.config, schemaV3);

  // ─── 8. Tenant isolation lungo tutto il flusso: un altro tenant non vede
  // nulla di questa app/cronologia. ────────────────────────────────────────
  const versionsForOtherTenant = await listAppVersions(supabase, appId, 'tenant-attacker');
  assert.deepEqual(versionsForOtherTenant, []);
  const rollbackByOtherTenant = await rollbackAppVersion(supabase, { versionId: v1VersionRow.id, appId, tenantId: 'tenant-attacker' });
  assert.equal(rollbackByOtherTenant.ok, false);
});
