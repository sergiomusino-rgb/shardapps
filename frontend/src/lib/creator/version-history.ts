// ─── Version History — logica pura (CreatorAI Engine 2.0, Hardening 2/2) ───
// Nessun componente React qui dentro: fetch/trasformazione dati verso l'API
// /api/creator/rollback GIÀ ESISTENTE (nessun nuovo endpoint, nessun accesso
// diretto al DB dal browser — solo fetch verso la stessa route testata in
// Hardening 1/2) + la macchina a stati della conferma di rollback, tutto
// testabile con node:test senza jsdom/React Testing Library — non presenti
// in questo repo (vedi package.json), stessa scelta già fatta per
// component-registry.ts (registry puro, componenti React sottili sopra).
// VersionHistoryPanel.tsx (il wrapper React) USA queste funzioni, non le
// duplica.

import type { AppVersionRow, AppVersionSource } from '../app-versions.ts';
import { sanitizeSiteBlueprint, type SiteBlueprintJSON } from '../site-schema.ts';

// ─── Vista elenco: versione "attuale" (sintetica, mai in app_versions — è lo
// stato live di apps.config/dell'editor) + le versioni storiche già
// restituite da GET /api/creator/rollback (più recente prima). Numerazione
// puramente display-only: v1 = la più vecchia, l'ultimo numero = attuale —
// nessun numero è persistito lato server, deriva solo dalla posizione. ────

export interface VersionListEntry {
  id: string | 'current';
  isCurrent: boolean;
  versionNumber: number;
  createdAt: string | null;
  source: AppVersionSource | 'current';
  config: unknown;
}

export function buildVersionListView(
  versions: AppVersionRow[],
  currentConfig: unknown,
  currentCreatedAt: string | null = null
): VersionListEntry[] {
  const total = versions.length;
  const historical: VersionListEntry[] = versions.map((v, idx) => ({
    id: v.id,
    isCurrent: false,
    versionNumber: total - idx,
    createdAt: v.created_at,
    source: v.source,
    config: v.config,
  }));
  const current: VersionListEntry = {
    id: 'current',
    isCurrent: true,
    versionNumber: total + 1,
    createdAt: currentCreatedAt,
    source: 'current',
    config: currentConfig,
  };
  return [current, ...historical];
}

/**
 * Ri-sanitizza il config di una voce prima di darlo in pasto al renderer
 * (SitePreview) — MAI il JSONB grezzo di uno snapshot storico direttamente:
 * uno snapshot in app_versions è stato validato al MOMENTO in cui è stato
 * salvato, ma può precedere l'aggiunta di un campo introdotto in una fase
 * successiva del motore. Stessa ri-sanitizzazione già applicata ovunque nel
 * Creator prima di usare un config letto dal DB (es. la riapertura di
 * un'app via dashboard/creator/page.tsx?appId=). Ritorna null se il config
 * risulta irrecuperabile (mai un crash del renderer).
 */
export function getPreviewSchema(entry: Pick<VersionListEntry, 'config'>): SiteBlueprintJSON | null {
  return sanitizeSiteBlueprint(entry.config);
}

export function sourceLabel(source: AppVersionSource | 'current'): string {
  if (source === 'current') return 'Versione attuale';
  if (source === 'rollback') return 'Ripristino di una versione precedente';
  return 'Pubblicazione';
}

// ─── Chiamate all'API rollback ESISTENTE (nessun contratto nuovo/cambiato) ──
// `fetchImpl` iniettabile per i test (mai una vera richiesta di rete nei
// test, stesso principio del resto della suite CreatorAI).

export type FetchVersionsResult =
  | { ok: true; versions: AppVersionRow[] }
  | { ok: false; error: string };

export async function fetchAppVersions(
  appId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchVersionsResult> {
  try {
    const res = await fetchImpl(`/api/creator/rollback?appId=${encodeURIComponent(appId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!data?.success) {
      return { ok: false, error: data?.error || 'Errore nel caricamento delle versioni.' };
    }
    return { ok: true, versions: (data.data?.versions ?? []) as AppVersionRow[] };
  } catch {
    return { ok: false, error: 'Errore di connessione. Riprova.' };
  }
}

export type RollbackApiResult =
  | { ok: true; config: unknown }
  | { ok: false; error: string };

export async function rollbackToVersion(
  appId: string,
  versionId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<RollbackApiResult> {
  try {
    const res = await fetchImpl('/api/creator/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ appId, versionId }),
    });
    const data = await res.json();
    if (!data?.success) {
      return { ok: false, error: data?.error || 'Errore durante il ripristino della versione.' };
    }
    return { ok: true, config: data.data?.config };
  } catch {
    return { ok: false, error: 'Errore di connessione. Riprova.' };
  }
}

// ─── Macchina a stati della conferma di rollback ────────────────────────────
// "conferma esplicita prima dell'azione" (requisito 3) + "evitare click
// multipli durante rollback" (requisito 5): un ripristino richiede SEMPRE un
// passaggio REQUEST -> CONFIRM esplicito (mai diretto da REQUEST a
// in-progress), e una volta in 'in-progress' un ulteriore CONFIRM/REQUEST
// non ha effetto finché non arriva SUCCESS/FAILURE — la UI disabilita i
// pulsanti in base a `phase === 'in-progress'`, questa funzione garantisce
// che anche un evento doppio non avvii due chiamate.

export type RollbackConfirmState =
  | { phase: 'idle' }
  | { phase: 'confirming'; versionId: string }
  | { phase: 'in-progress'; versionId: string }
  | { phase: 'error'; versionId: string; message: string };

export type RollbackConfirmAction =
  | { type: 'REQUEST'; versionId: string }
  | { type: 'CANCEL' }
  | { type: 'CONFIRM' }
  | { type: 'SUCCESS' }
  | { type: 'FAILURE'; message: string };

export const IDLE_ROLLBACK_STATE: RollbackConfirmState = { phase: 'idle' };

export function reduceRollbackConfirm(state: RollbackConfirmState, action: RollbackConfirmAction): RollbackConfirmState {
  switch (action.type) {
    case 'REQUEST':
      // Sempre permesso (anche da 'error': l'utente può ritentare la stessa
      // o un'altra versione), MAI da 'in-progress' — non deve poter aprire
      // una seconda richiesta mentre la prima è ancora in volo.
      if (state.phase === 'in-progress') return state;
      return { phase: 'confirming', versionId: action.versionId };
    case 'CANCEL':
      if (state.phase === 'in-progress') return state; // non annullabile a metà chiamata
      return IDLE_ROLLBACK_STATE;
    case 'CONFIRM':
      if (state.phase !== 'confirming') return state; // nessuna richiesta pendente da confermare
      return { phase: 'in-progress', versionId: state.versionId };
    case 'SUCCESS':
      return IDLE_ROLLBACK_STATE;
    case 'FAILURE':
      if (state.phase !== 'in-progress') return state;
      return { phase: 'error', versionId: state.versionId, message: action.message };
    default:
      return state;
  }
}
