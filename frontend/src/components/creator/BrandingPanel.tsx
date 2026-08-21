'use client';

// ─── BrandingPanel ──────────────────────────────────────────────────────────
// (CreatorAI Engine 2.0 — Branding reseller) Pannello "Branding" dell'editor
// Creator: nome brand, logo, richiesta libera. Wrapper React SOTTILE: la
// logica (validazione, costruzione payload, persistenza) vive in
// src/lib/creator/branding.ts (testata lì, node:test — nessun jsdom/React
// Testing Library in questo repo, stesso pattern di VersionHistoryPanel).
//
// RIUSO ARCHITETTURALE: nessuna nuova route, nessuna nuova infrastruttura di
// storage. Il logo è letto come data URL nel browser (FileReader), esatto
// stesso meccanismo già usato da dashboard/projects/[id]/page.tsx — non un
// nuovo upload a un bucket. La persistenza per un'app già pubblicata riusa
// PATCH /api/apps/[id] (stessa route, stesso gate piano Business, stesso
// limite dimensione). Per un'app non ancora pubblicata non c'è nulla da
// salvare qui: il chiamante (AppEditorView) applica il branding subito dopo
// la prima pubblicazione, quando l'appId esiste.
//
// Il campo "Richiesta branding" NON è mai la fonte autorevole del brand: è
// testo libero che il chiamante può opzionalmente inoltrare a
// /api/creator/refactor come un messaggio in chat qualsiasi (stessa route,
// stesso identico contratto) — nessuna nuova capacità per l'AI Engine.

import { useEffect, useState } from 'react';
import { Palette, X, Loader2, AlertCircle, CheckCircle2, Upload, Trash2 } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import {
  EMPTY_BRANDING_FORM,
  buildBrandingPayload,
  validateBrandingLogoFile,
  validateBrandingLogoDataUrl,
  saveBrandingForApp,
  fetchCurrentBranding,
  type BrandingFormState,
} from '@/src/lib/creator/branding';

export default function BrandingPanel({
  appId,
  accessToken,
  initialDraft,
  onClose,
  onApplyInstructions,
}: {
  /** Assente finché l'app non è stata pubblicata almeno una volta: in quel
   * caso il pannello raccoglie solo il DRAFT, applicato dal chiamante subito
   * dopo la prima pubblicazione (vedi AppEditorView). */
  appId?: string;
  accessToken: string;
  /** Draft salvato da una precedente apertura del pannello (solo rilevante
   * quando `appId` è assente: una volta pubblicata l'app, i valori correnti
   * si leggono dal server, vedi fetchCurrentBranding sotto). */
  initialDraft?: BrandingFormState;
  onClose: (draft: BrandingFormState) => void;
  /** Invocata SOLO se l'utente lascia una "Richiesta branding" non vuota e
   * conferma — il chiamante decide come inoltrarla (reindirizza al normale
   * flusso chat di /api/creator/refactor, invariato). */
  onApplyInstructions?: (instructions: string) => void;
}) {
  // i18n (root-cause report "/dashboard/creator non traduce"): useLanguage()
  // chiamato direttamente qui, stesso pattern degli altri componenti Creator.
  const { t } = useLanguage();
  const [form, setForm] = useState<BrandingFormState>(appId ? EMPTY_BRANDING_FORM : (initialDraft || EMPTY_BRANDING_FORM));
  const [existingLogoNote, setExistingLogoNote] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(!!appId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Nessun setState sincrono nel corpo dell'effetto (regola
    // react-hooks/set-state-in-effect, stesso fix già applicato a
    // VersionHistoryPanel in Hardening 2/2): quando `appId` è assente,
    // `loadingExisting` è già `false` (vedi useState(!!appId) sopra), non
    // c'è nulla da "resettare" qui — l'unico caso da gestire è quando
    // l'effetto DEVE fare qualcosa, cioè quando appId esiste.
    if (!appId) return;
    let cancelled = false;
    fetchCurrentBranding(appId, accessToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setForm((prev) => ({ ...prev, name: result.name }));
        setExistingLogoNote(result.hasLogo ? t('creator_v2_branding_logo_existing_note') : null);
      }
      setLoadingExisting(false);
    });
    return () => { cancelled = true; };
    // `t` incluso nelle dipendenze (i18n): stabile per locale (useCallback in
    // LanguageContext), quindi non introduce un loop — si limita a
    // ripetere il fetch se l'utente cambia lingua a pannello aperto, per
    // riflettere `creator_v2_branding_logo_existing_note` nella lingua giusta.
  }, [appId, accessToken, t]);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    const fileCheck = validateBrandingLogoFile({ size: file.size, type: file.type });
    if (!fileCheck.ok) { setError(fileCheck.error); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = (ev.target?.result as string) || '';
      const check = validateBrandingLogoDataUrl(dataUrl);
      if (!check.ok) { setError(check.error); return; }
      setForm((prev) => ({ ...prev, logoDataUrl: dataUrl }));
      setExistingLogoNote(null);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    setSaved(false);

    const payload = buildBrandingPayload(form);

    // Nessuna app pubblicata ancora: nulla da salvare adesso, il chiamante
    // applica il draft subito dopo la prossima pubblicazione riuscita.
    if (!appId) {
      if (form.instructions.trim()) onApplyInstructions?.(form.instructions.trim());
      onClose(form);
      return;
    }

    if (payload) {
      setSaving(true);
      const result = await saveBrandingForApp(appId, payload, accessToken);
      setSaving(false);
      if (!result.ok) {
        setError(result.code === 'PLAN_REQUIRED' ? t('creator_v2_branding_plan_required_error') : result.error);
        return;
      }
    }

    setSaved(true);
    if (form.instructions.trim()) onApplyInstructions?.(form.instructions.trim());
    setTimeout(() => onClose(form), payload ? 900 : 0);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
              <Palette size={16} />
            </div>
            <h3 className="text-sm font-bold text-white">{t('creator_v2_branding_modal_title')}</h3>
          </div>
          <button onClick={() => onClose(form)} className="text-gray-500 hover:text-white" aria-label={t('creator_v2_close')}>
            <X size={18} />
          </button>
        </div>

        {loadingExisting ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
            <Loader2 size={15} className="animate-spin" /> {t('creator_v2_loading_generic')}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('creator_v2_branding_name_label')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('creator_v2_branding_name_placeholder')}
                maxLength={80}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('creator_v2_branding_logo_label')}</label>
              {existingLogoNote && <p className="mb-1.5 text-xs text-gray-500">{existingLogoNote}</p>}
              <div className="flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-700 bg-gray-800 px-3 py-2.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white">
                  <Upload size={13} />
                  {form.logoDataUrl ? t('creator_v2_branding_replace_logo') : t('creator_v2_branding_upload_logo')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
                </label>
                {form.logoDataUrl && (
                  <>
                    <img src={form.logoDataUrl} alt={t('creator_v2_branding_logo_preview_alt')} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, logoDataUrl: '' }))}
                      className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
                      aria-label={t('creator_v2_branding_remove_logo')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t('creator_v2_branding_instructions_label')}</label>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
                placeholder={t('creator_v2_branding_instructions_placeholder')}
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-white placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-[11px] leading-snug text-gray-600">
                {t('creator_v2_branding_instructions_hint')}
              </p>
            </div>

            {!form.name.trim() && !form.logoDataUrl.trim() && (
              <p className="rounded-lg bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
                {t('creator_v2_branding_default_notice')}
              </p>
            )}

            {error && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                <CheckCircle2 size={13} className="shrink-0" /> {t('creator_v2_branding_saved_notice')}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              {saving ? t('creator_v2_saving') : appId ? t('creator_v2_branding_save_button') : t('creator_v2_branding_apply_on_publish_button')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
