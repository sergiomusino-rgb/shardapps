'use client';

// ─── VersionHistoryPanel ────────────────────────────────────────────────────
// (CreatorAI Engine 2.0, Hardening 2/2) Pannello "Versioni" dell'editor
// Creator: elenco versioni pubblicate + dettaglio/anteprima + rollback con
// conferma esplicita. Wrapper React SOTTILE: tutta la logica (fetch, mapping,
// macchina a stati della conferma) vive in src/lib/creator/version-history.ts
// (testata lì, node:test — nessun jsdom/React Testing Library in questo
// repo). Riusa SitePreview per il rendering (nessun secondo renderer).
//
// Sicurezza: nessun accesso diretto al DB dal browser, nessuna decisione di
// tenant/ownership lato client — solo fetch verso /api/creator/rollback
// (GET/POST), la stessa API server-side già testata (auth + tenant/app
// isolation) in Hardening 1/2. Il rollback avviene SOLO su conferma esplicita
// dell'utente, mai automaticamente.

import { useEffect, useState } from 'react';
import { X, Clock, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import SitePreview from './SitePreview';
import type { SiteBlueprintJSON } from '@/src/lib/site-schema';
import {
  buildVersionListView,
  sourceLabel,
  getPreviewSchema,
  fetchAppVersions,
  rollbackToVersion,
  reduceRollbackConfirm,
  IDLE_ROLLBACK_STATE,
  type VersionListEntry,
  type RollbackConfirmState,
} from '@/src/lib/creator/version-history';

export default function VersionHistoryPanel({
  appId,
  currentSchema,
  accessToken,
  onRollback,
  onClose,
}: {
  appId: string;
  currentSchema: SiteBlueprintJSON;
  accessToken: string;
  /** Invocata SOLO dopo un rollback riuscito, con lo schema ripristinato —
   * il chiamante (AppEditorView) aggiorna editor/preview con questo valore. */
  onRollback: (config: SiteBlueprintJSON) => void;
  onClose: () => void;
}) {
  // i18n (root-cause report "/dashboard/creator non traduce"): useLanguage()
  // chiamato direttamente qui, stesso pattern degli altri componenti Creator.
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<VersionListEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | 'current'>('current');
  const [confirmState, setConfirmState] = useState<RollbackConfirmState>(IDLE_ROLLBACK_STATE);

  useEffect(() => {
    // Nessun setState sincrono nel corpo dell'effetto (regola
    // react-hooks/set-state-in-effect): `loading`/`loadError` partono già
    // corretti (true/null, vedi useState sopra) — il pannello viene sempre
    // montato da zero ad ogni apertura (AppEditorView lo renderizza solo
    // quando showVersions è true), quindi questo effetto gira una sola
    // volta per montaggio, non serve "resettare" lo stato qui.
    let cancelled = false;
    fetchAppVersions(appId, accessToken, fetch, t).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEntries(buildVersionListView(result.versions, currentSchema));
      } else {
        setLoadError(result.error);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
    // currentSchema è intenzionalmente fuori dalle dipendenze: la voce
    // "attuale" deve riflettere lo schema al momento dell'apertura del
    // pannello, non ricaricare la lista ad ogni battitura in chat mentre è aperto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, accessToken]);

  const selected = entries.find((e) => e.id === selectedId) || entries[0];
  // Mai passare selected.config (JSONB grezzo di uno snapshot storico)
  // direttamente al renderer — vedi getPreviewSchema in version-history.ts.
  const selectedPreviewSchema = selected ? getPreviewSchema(selected) : null;

  const handleRequestRollback = (versionId: string) => {
    setConfirmState((prev) => reduceRollbackConfirm(prev, { type: 'REQUEST', versionId }));
  };
  const handleCancelRollback = () => {
    setConfirmState((prev) => reduceRollbackConfirm(prev, { type: 'CANCEL' }));
  };
  const handleConfirmRollback = async () => {
    if (confirmState.phase !== 'confirming') return; // evita doppie chiamate: nessuna richiesta pendente da confermare
    const versionId = confirmState.versionId;
    setConfirmState((prev) => reduceRollbackConfirm(prev, { type: 'CONFIRM' }));

    const result = await rollbackToVersion(appId, versionId, accessToken, fetch, t);
    if (result.ok) {
      setConfirmState(IDLE_ROLLBACK_STATE);
      onRollback(result.config as SiteBlueprintJSON);
    } else {
      setConfirmState((prev) => reduceRollbackConfirm(prev, { type: 'FAILURE', message: result.error }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock size={16} className="text-indigo-400" /> {t('creator_v2_versions_button')}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label={t('creator_v2_close')}>
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[220px_1fr]">
          {/* ── Elenco versioni ── */}
          <div className="overflow-y-auto border-b border-gray-800 sm:border-b-0 sm:border-r sm:max-h-full">
            {loading && (
              <div className="flex items-center gap-2 p-4 text-xs text-gray-400">
                <Loader2 size={14} className="animate-spin" /> {t('creator_v2_versions_loading')}
              </div>
            )}
            {loadError && !loading && (
              <div className="flex items-start gap-1.5 p-4 text-xs text-red-400">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {loadError}
              </div>
            )}
            {!loading && !loadError && entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`block w-full border-b border-gray-800/60 px-4 py-3 text-left text-xs transition-colors ${
                  selectedId === entry.id ? 'bg-gray-800' : 'hover:bg-gray-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-white">
                  v{entry.versionNumber}
                  {entry.isCurrent && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">{t('creator_v2_versions_current_badge')}</span>
                  )}
                </div>
                <div className="mt-0.5 text-gray-500">{sourceLabel(entry.source, t)}</div>
                {entry.createdAt && (
                  <div className="mt-0.5 text-gray-600">{new Date(entry.createdAt).toLocaleString()}</div>
                )}
              </button>
            ))}
          </div>

          {/* ── Dettaglio + preview (SitePreview riusato, non duplicato) + rollback ── */}
          <div className="flex min-h-0 flex-col">
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 px-4 py-2.5">
                  <div className="text-xs text-gray-400">
                    v{selected.versionNumber} — {sourceLabel(selected.source, t)}
                    {selected.createdAt && ` · ${new Date(selected.createdAt).toLocaleString()}`}
                  </div>
                  {!selected.isCurrent && (
                    confirmState.phase === 'confirming' && confirmState.versionId === selected.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-400">{t('creator_v2_versions_confirm_question')}</span>
                        <button
                          onClick={handleConfirmRollback}
                          className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
                        >
                          {t('creator_v2_confirm')}
                        </button>
                        <button
                          onClick={handleCancelRollback}
                          className="rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:text-white"
                        >
                          {t('creator_v2_cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRequestRollback(selected.id as string)}
                        disabled={confirmState.phase === 'in-progress'}
                        className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-700"
                      >
                        {confirmState.phase === 'in-progress' && confirmState.versionId === selected.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        {t('creator_v2_versions_restore_button')}
                      </button>
                    )
                  )}
                </div>

                {confirmState.phase === 'error' && confirmState.versionId === selected.id && (
                  <div className="flex items-center gap-1.5 border-b border-gray-800 bg-red-900/20 px-4 py-2 text-xs text-red-300">
                    <AlertCircle size={13} className="shrink-0" /> {confirmState.message}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto bg-white">
                  {selectedPreviewSchema ? (
                    <SitePreview schema={selectedPreviewSchema} />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-gray-400">
                      <AlertCircle size={24} />
                      <p className="text-sm">{t('creator_v2_versions_preview_unavailable')}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
