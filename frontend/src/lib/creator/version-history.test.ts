// ─── Test isolati — Version History (CreatorAI Engine 2.0, Hardening 2/2) ───
// node:test nativo, stesso stile delle altre suite: nessuna chiamata di rete
// reale (fetch iniettato come fake), nessun DOM/React — solo la logica pura
// di src/lib/creator/version-history.ts, usata (non duplicata) da
// VersionHistoryPanel.tsx.
//
// Copre i requisiti Hardening 2/2 punto 6: lista versioni, selezione
// versione, rollback riuscito, conferma rollback, rollback fallito, refresh
// preview dopo rollback (il config restituito da rollbackToVersion), stato
// loading (via il contratto Promise di fetchAppVersions/rollbackToVersion).
//
// Uso: node --test src/lib/creator/version-history.test.ts (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVersionListView,
  sourceLabel,
  getPreviewSchema,
  fetchAppVersions,
  rollbackToVersion,
  reduceRollbackConfirm,
  IDLE_ROLLBACK_STATE,
  type RollbackConfirmState,
} from './version-history.ts';
import type { AppVersionRow } from '../app-versions.ts';

function fakeVersion(overrides: Partial<AppVersionRow> = {}): AppVersionRow {
  return {
    id: 'v-1',
    app_id: 'app-1',
    tenant_id: 'tenant-1',
    config: { appName: 'Test' },
    created_by: 'user-1',
    source: 'publish',
    generation_job_id: null,
    created_at: '2026-08-16T10:00:00.000Z',
    ...overrides,
  };
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as typeof fetch;
}

function throwingFetch(): typeof fetch {
  return (async () => { throw new Error('network down'); }) as typeof fetch;
}

// ═══════════════════════════════════════════════════════════════════════════
// LISTA VERSIONI (buildVersionListView)
// ═══════════════════════════════════════════════════════════════════════════

test('lista versioni: la versione attuale è sempre prima, chiaramente identificabile (isCurrent)', () => {
  const versions = [fakeVersion({ id: 'v-2', created_at: '2026-08-16T12:00:00.000Z' }), fakeVersion({ id: 'v-1', created_at: '2026-08-16T10:00:00.000Z' })];
  const list = buildVersionListView(versions, { appName: 'Attuale' }, '2026-08-16T14:00:00.000Z');

  assert.equal(list.length, 3);
  assert.equal(list[0].isCurrent, true);
  assert.equal(list[0].id, 'current');
  assert.deepEqual(list[0].config, { appName: 'Attuale' });
  assert.equal(list.slice(1).every((v) => v.isCurrent === false), true);
});

test('lista versioni: numerazione display (v1 = più vecchia, l\'ultimo numero = attuale)', () => {
  const versions = [fakeVersion({ id: 'v-3' }), fakeVersion({ id: 'v-2' }), fakeVersion({ id: 'v-1' })]; // più recente prima, come da API
  const list = buildVersionListView(versions, { appName: 'X' });

  assert.equal(list[0].versionNumber, 4); // attuale
  assert.equal(list[1].versionNumber, 3); // v-3, la più recente storica
  assert.equal(list[2].versionNumber, 2);
  assert.equal(list[3].versionNumber, 1); // v-1, la più vecchia
});

test('lista versioni: app senza versioni storiche -> solo la voce "attuale"', () => {
  const list = buildVersionListView([], { appName: 'Prima pubblicazione' });
  assert.equal(list.length, 1);
  assert.equal(list[0].isCurrent, true);
  assert.equal(list[0].versionNumber, 1);
});

test('lista versioni: source/created_at/config sono preservati per ogni voce storica', () => {
  const v = fakeVersion({ id: 'v-1', source: 'rollback', created_at: '2026-08-15T09:00:00.000Z', config: { appName: 'Vecchia' } });
  const list = buildVersionListView([v], { appName: 'Nuova' });
  const historical = list[1];
  assert.equal(historical.id, 'v-1');
  assert.equal(historical.source, 'rollback');
  assert.equal(historical.createdAt, '2026-08-15T09:00:00.000Z');
  assert.deepEqual(historical.config, { appName: 'Vecchia' });
});

test('sourceLabel: etichette leggibili per ogni source, incluso "current"', () => {
  assert.equal(sourceLabel('current'), 'Versione attuale');
  assert.equal(sourceLabel('publish'), 'Pubblicazione');
  assert.equal(sourceLabel('rollback'), 'Ripristino di una versione precedente');
});

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW DI UNA VERSIONE STORICA — mai JSONB grezzo al renderer
// (audit finale: uno snapshot in app_versions può precedere l'aggiunta di un
// campo introdotto in una fase successiva del motore — SitePreview si aspetta
// uno SiteBlueprintJSON pienamente "defaultato" da sanitizeSiteBlueprint,
// stessa garanzia già data ovunque nel Creator a un config letto dal DB).
// ═══════════════════════════════════════════════════════════════════════════

test('getPreviewSchema: un config storico minimale (campi opzionali di fasi successive assenti, es. authConfig/workflows) viene comunque reso renderizzabile', () => {
  // Nessun "authConfig", nessun "workflows": campi aggiunti in fasi
  // successive del motore (Fase 3/4), entrambi opzionali con default Zod a
  // livello di SiteBlueprintSchema — uno snapshot salvato prima della loro
  // introduzione non li avrebbe mai avuti. "ui" resta presente (vuoto): è
  // nello schema fin dall'inizio, nessun vero snapshot storico ne è privo.
  const oldRawConfig = {
    projectType: 'gestionale',
    appName: 'Vecchia Officina',
    sector: 'officina-meccanica',
    businessConfig: { name: 'Vecchia Officina' },
    adminPanel: { entities: [{ name: 'clienti', label: 'Cliente', fields: [{ id: 'id', type: 'id', label: 'ID' }] }] },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    ui: {},
  };
  const result = getPreviewSchema({ config: oldRawConfig });
  assert.ok(result, 'sanitizeSiteBlueprint deve applicare i default mancanti, non rifiutare lo snapshot');
  assert.ok(result?.ui?.primaryColor); // default applicato dentro SiteUIConfigSchema
  assert.equal(result?.authConfig?.enabled, false); // default applicato per un campo assente nello snapshot
  assert.deepEqual(result?.workflows, []); // idem
  assert.equal(result?.adminPanel.entities[0].name, 'clienti');
});

test('getPreviewSchema: un config irrecuperabile (non un oggetto) ritorna null, mai un\'eccezione', () => {
  assert.equal(getPreviewSchema({ config: null }), null);
  assert.equal(getPreviewSchema({ config: 'stringa non valida' }), null);
  assert.equal(getPreviewSchema({ config: 42 }), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// FETCH VERSIONI (stato loading = finché la Promise non risolve)
// ═══════════════════════════════════════════════════════════════════════════

test('fetchAppVersions: risposta success -> versions restituite, nessun accesso diretto al DB (solo fetch verso /api/creator/rollback)', async () => {
  let capturedUrl = '';
  let capturedAuth = '';
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedAuth = (init?.headers as Record<string, string>)?.Authorization || '';
    return { status: 200, json: async () => ({ success: true, data: { versions: [fakeVersion()] } }) } as Response;
  }) as typeof fetch;

  const result = await fetchAppVersions('app-1', 'tok-abc', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal((result as { versions: AppVersionRow[] }).versions.length, 1);
  assert.match(capturedUrl, /^\/api\/creator\/rollback\?appId=app-1$/);
  assert.equal(capturedAuth, 'Bearer tok-abc');
});

test('fetchAppVersions: risposta di errore dal server -> ok:false con il messaggio del server', async () => {
  const fetchImpl = fakeFetch([{ status: 401, body: { success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' } }]);
  const result = await fetchAppVersions('app-1', 'tok-scaduto', fetchImpl);
  assert.equal(result.ok, false);
  assert.equal((result as { error: string }).error, 'Autenticazione richiesta');
});

test('fetchAppVersions: errore di rete -> ok:false, mai un\'eccezione non gestita', async () => {
  const result = await fetchAppVersions('app-1', 'tok', throwingFetch());
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /connessione/);
});

// ═══════════════════════════════════════════════════════════════════════════
// ROLLBACK RIUSCITO / FALLITO — refresh preview dopo rollback
// ═══════════════════════════════════════════════════════════════════════════

test('rollback riuscito: rollbackToVersion invoca POST con appId/versionId e restituisce il config ripristinato (per il refresh della preview)', async () => {
  let capturedBody: unknown = null;
  let capturedMethod = '';
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    capturedMethod = init?.method || '';
    capturedBody = JSON.parse(String(init?.body));
    return { status: 200, json: async () => ({ success: true, data: { appId: 'app-1', config: { appName: 'Ripristinata' } } }) } as Response;
  }) as typeof fetch;

  const result = await rollbackToVersion('app-1', 'v-1', 'tok-abc', fetchImpl);
  assert.equal(result.ok, true);
  assert.deepEqual((result as { config: unknown }).config, { appName: 'Ripristinata' });
  assert.equal(capturedMethod, 'POST');
  assert.deepEqual(capturedBody, { appId: 'app-1', versionId: 'v-1' });
});

test('rollback fallito: risposta 404 VERSION_NOT_FOUND -> ok:false con messaggio leggibile', async () => {
  const fetchImpl = fakeFetch([{ status: 404, body: { success: false, error: 'Versione non trovata', code: 'VERSION_NOT_FOUND' } }]);
  const result = await rollbackToVersion('app-1', 'v-inesistente', 'tok', fetchImpl);
  assert.equal(result.ok, false);
  assert.equal((result as { error: string }).error, 'Versione non trovata');
});

test('rollback fallito: errore di rete -> ok:false, mai un\'eccezione non gestita', async () => {
  const result = await rollbackToVersion('app-1', 'v-1', 'tok', throwingFetch());
  assert.equal(result.ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFERMA ROLLBACK (macchina a stati) — click multipli, cancel, retry
// ═══════════════════════════════════════════════════════════════════════════

test('conferma rollback: REQUEST porta a "confirming", MAI direttamente a "in-progress" (conferma esplicita obbligatoria)', () => {
  const s1 = reduceRollbackConfirm(IDLE_ROLLBACK_STATE, { type: 'REQUEST', versionId: 'v-1' });
  assert.deepEqual(s1, { phase: 'confirming', versionId: 'v-1' });
});

test('conferma rollback: CONFIRM da "confirming" avvia il rollback ("in-progress")', () => {
  const confirming: RollbackConfirmState = { phase: 'confirming', versionId: 'v-1' };
  const inProgress = reduceRollbackConfirm(confirming, { type: 'CONFIRM' });
  assert.deepEqual(inProgress, { phase: 'in-progress', versionId: 'v-1' });
});

test('conferma rollback: CONFIRM senza una richiesta pendente (idle) non ha effetto', () => {
  const result = reduceRollbackConfirm(IDLE_ROLLBACK_STATE, { type: 'CONFIRM' });
  assert.deepEqual(result, IDLE_ROLLBACK_STATE);
});

test('conferma rollback: CANCEL da "confirming" torna a idle (annulla prima di partire)', () => {
  const confirming: RollbackConfirmState = { phase: 'confirming', versionId: 'v-1' };
  assert.deepEqual(reduceRollbackConfirm(confirming, { type: 'CANCEL' }), IDLE_ROLLBACK_STATE);
});

test('evitare click multipli: REQUEST/CANCEL durante "in-progress" non hanno alcun effetto (nessuna seconda chiamata avviabile)', () => {
  const inProgress: RollbackConfirmState = { phase: 'in-progress', versionId: 'v-1' };
  assert.deepEqual(reduceRollbackConfirm(inProgress, { type: 'REQUEST', versionId: 'v-2' }), inProgress);
  assert.deepEqual(reduceRollbackConfirm(inProgress, { type: 'CANCEL' }), inProgress);
  assert.deepEqual(reduceRollbackConfirm(inProgress, { type: 'CONFIRM' }), inProgress);
});

test('rollback fallito (stato): FAILURE da "in-progress" porta a "error" col messaggio, permette un nuovo REQUEST (retry)', () => {
  const inProgress: RollbackConfirmState = { phase: 'in-progress', versionId: 'v-1' };
  const errored = reduceRollbackConfirm(inProgress, { type: 'FAILURE', message: 'Versione non trovata' });
  assert.deepEqual(errored, { phase: 'error', versionId: 'v-1', message: 'Versione non trovata' });

  const retried = reduceRollbackConfirm(errored, { type: 'REQUEST', versionId: 'v-1' });
  assert.deepEqual(retried, { phase: 'confirming', versionId: 'v-1' });
});

test('rollback riuscito (stato): SUCCESS da "in-progress" torna a idle', () => {
  const inProgress: RollbackConfirmState = { phase: 'in-progress', versionId: 'v-1' };
  assert.deepEqual(reduceRollbackConfirm(inProgress, { type: 'SUCCESS' }), IDLE_ROLLBACK_STATE);
});
