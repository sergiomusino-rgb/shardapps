'use client';

// ─── AppEditorView ──────────────────────────────────────────────────────────
// Editor split-view del motore Sito/PWA: anteprima live a sinistra (hot
// reload locale, nessuna richiesta di rete al variare dello schema — l'unica
// chiamata di rete è quella verso /api/creator/refactor quando l'utente invia
// un messaggio in chat), copilot a chat a destra. L'header ospita il pulsante
// di pubblicazione (/api/creator/publish): prima pubblicazione consuma uno
// slot e genera slug + credenziali, le successive ("Salva Modifiche")
// aggiornano l'app già pubblicata in questa sessione di editing.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Loader2, Sparkles, AlertCircle,
  Rocket, CheckCircle2, Copy, X, ExternalLink, Mic, MicOff, Clock, Palette,
} from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';
import SitePreview from './SitePreview';
// Hardening 2/2 (CreatorAI Engine 2.0): pannello "Versioni" + rollback, vedi
// commento in testa a VersionHistoryPanel.tsx per il contratto/sicurezza.
import VersionHistoryPanel from './VersionHistoryPanel';
// Branding reseller (CreatorAI Engine 2.0): pannello "Branding", vedi
// commento in testa a BrandingPanel.tsx per il contratto/sicurezza/riuso.
import BrandingPanel from './BrandingPanel';
import { EMPTY_BRANDING_FORM, buildBrandingPayload, saveBrandingForApp, type BrandingFormState } from '@/src/lib/creator/branding';
import { useVoiceInput } from '@/src/lib/useVoiceInput';
import { promptSuggestsStateButMissing, type SiteBlueprintJSON } from '@/src/lib/site-schema';

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface PublishResult {
  appId: string;
  slug: string;
  url: string;
  clientEmail?: string;
  clientPassword?: string;
  updated: boolean;
}

export interface AppEditorViewLabels {
  chatTitle: string;
  chatSubtitle: string;
  inputPlaceholder: string;
  sendButton: string;
  emptyState: string;
  appliedMessage: string;
  publishButton: string;
  publishingButton: string;
  saveButton: string;
  /** Hardening 2/2: etichetta del pulsante che apre il pannello Versioni
   * (visibile solo dopo la prima pubblicazione, vedi render sotto). */
  versionsButton: string;
  /** Branding reseller: etichetta del pulsante che apre il pannello Branding. */
  brandingButton: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard non disponibile (es. contesto non sicuro): nessun blocco,
      // il valore resta comunque leggibile e selezionabile a mano.
    }
  };
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
        <span className="flex-1 truncate text-sm text-white">{value}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
          aria-label={`${t('creator_v2_copy_prefix')} ${label}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function PublishSuccessModal({ result, onClose }: { result: PublishResult; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {result.updated ? t('creator_v2_publish_success_updated_title') : t('creator_v2_publish_success_new_title')}
              </h3>
              <p className="text-xs text-gray-500">
                {result.updated ? t('creator_v2_publish_success_updated_desc') : t('creator_v2_publish_success_new_desc')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label={t('creator_v2_close')}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <CopyField label={t('creator_v2_copy_link_label')} value={result.url} />
          {!result.updated && result.clientEmail && <CopyField label={t('creator_v2_copy_email_label')} value={result.clientEmail} />}
          {!result.updated && result.clientPassword && <CopyField label={t('creator_v2_copy_password_label')} value={result.clientPassword} />}
        </div>

        {!result.updated && (
          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            {t('creator_v2_publish_success_credentials_note')}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            <ExternalLink size={14} /> {t('creator_v2_open_app')}
          </a>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            {t('creator_v2_close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppEditorView({
  initialSchema,
  onSchemaChange,
  appId,
  lang = 'it',
  labels,
}: {
  initialSchema: SiteBlueprintJSON;
  onSchemaChange?: (schema: SiteBlueprintJSON) => void;
  appId?: string;
  lang?: string;
  labels?: Partial<AppEditorViewLabels>;
}) {
  // i18n (root-cause report "/dashboard/creator non traduce"): useLanguage()
  // chiamato direttamente qui, stesso pattern di ProjectWizard.tsx — `labels`
  // resta un override ESTERNO opzionale invariato, ora sopra default tradotti
  // invece di stringhe fisse.
  const { t: translate } = useLanguage();
  const defaultLabels: AppEditorViewLabels = {
    chatTitle: translate('creator_v2_chat_title'),
    chatSubtitle: translate('creator_v2_chat_subtitle'),
    inputPlaceholder: translate('creator_v2_chat_input_placeholder'),
    sendButton: translate('creator_v2_chat_send'),
    emptyState: translate('creator_v2_chat_empty_state'),
    appliedMessage: translate('creator_v2_chat_applied'),
    publishButton: translate('creator_v2_publish_button'),
    publishingButton: translate('creator_v2_publishing_button'),
    saveButton: translate('creator_v2_save_button'),
    versionsButton: translate('creator_v2_versions_button'),
    brandingButton: translate('creator_v2_toolbar_branding'),
  };
  const t = { ...defaultLabels, ...labels };
  const router = useRouter();

  const [schema, setSchema] = useState<SiteBlueprintJSON>(initialSchema);
  const [activePageSlug, setActivePageSlug] = useState(initialSchema.pages[0]?.slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Comandi AI: dettatura vocale del messaggio in chat, stesso pattern di
  // Generator AI e del prompt iniziale in ProjectWizard.
  const { isListening, isSupported: isVoiceSupported, toggleListening } = useVoiceInput(lang, setInput);

  // Traccia l'app pubblicata in questa sessione di editing: se valorizzato,
  // il pulsante diventa "Salva Modifiche" e aggiorna in-place invece di
  // creare una nuova app (e nuovo slot) ad ogni click.
  const [publishedAppId, setPublishedAppId] = useState<string | undefined>(appId);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Hardening 2/2: pannello Versioni/rollback — visibile solo per un'app già
  // pubblicata (publishedAppId), perché app_versions esiste solo a partire
  // dalla prima ripubblicazione (nessuna riga alla primissima pubblicazione,
  // vedi app-versions.ts). rollbackNotice è un messaggio di successo
  // transitorio (auto-dismiss), stesso trattamento "leggero" di publishError.
  const [showVersions, setShowVersions] = useState(false);
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);

  // Branding reseller: pannello + draft. Il draft serve SOLO quando l'app
  // non è ancora stata pubblicata (nessun appId su cui fare PATCH subito) —
  // una volta pubblicata la prima volta, viene applicato una sola volta
  // (vedi handlePublish) e da lì in poi il pannello salva direttamente,
  // senza più passare dal draft.
  const [showBranding, setShowBranding] = useState(false);
  const [brandingAccessToken, setBrandingAccessToken] = useState<string | null>(null);
  const [brandingDraft, setBrandingDraft] = useState<BrandingFormState>(EMPTY_BRANDING_FORM);

  // Hot-reload locale: qualunque aggiornamento di `schema` (via chat o da un
  // eventuale editor esterno tramite `initialSchema`) si riflette subito
  // nell'anteprima, senza ricaricare la pagina — SitePreview è puramente
  // derivato dallo state React.
  useEffect(() => {
    setSchema(initialSchema);
    setActivePageSlug((prev) => (initialSchema.pages.some((p) => p.slug === prev) ? prev : initialSchema.pages[0]?.slug));
  }, [initialSchema]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!rollbackNotice) return;
    const timer = setTimeout(() => setRollbackNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [rollbackNotice]);

  // Estratta da handleSend così anche il pannello Branding può inoltrare la
  // "Richiesta branding" come un messaggio in chat qualunque — stessa
  // identica chiamata a /api/creator/refactor, nessuna nuova capacità
  // dell'AI Engine: il testo libero non è mai la fonte autorevole del
  // brand (nome/logo restano quelli strutturati salvati separatamente).
  const sendChatMessage = async (message: string) => {
    if (!message || isSending) return;

    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setIsSending(true);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setMessages((prev) => [...prev, { role: 'error', content: translate('creator_v2_error_session_expired') }]);
        return;
      }

      const response = await fetch('/api/creator/refactor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schema, message, lang, appId: publishedAppId }),
      });
      const data = await response.json();

      if (data.success && data.data?.schema) {
        setSchema(data.data.schema);
        onSchemaChange?.(data.data.schema);
        // Product Readiness Audit (P2 — qualità percepita): stesso avviso
        // non bloccante del wizard iniziale (dashboard/creator/page.tsx),
        // qui applicato al messaggio Copilot invece che al prompt iniziale
        // — il caso più comune è proprio "chiedi uno stato via chat e non
        // arriva", osservato empiricamente in sessione.
        const appliedMessage = promptSuggestsStateButMissing(message, data.data.schema)
          ? `${t.appliedMessage} ${translate('creator_v2_chat_state_warning_suffix')}`
          : t.appliedMessage;
        setMessages((prev) => [...prev, { role: 'assistant', content: appliedMessage }]);
      } else {
        setMessages((prev) => [...prev, { role: 'error', content: data.error || translate('creator_v2_error_edit_generic') }]);
      }
    } catch (err) {
      console.error('[AppEditorView] refactor error:', err);
      setMessages((prev) => [...prev, { role: 'error', content: translate('creator_v2_error_connection_retry_short') }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    const message = input.trim();
    if (!message || isSending) return;
    setInput('');
    await sendChatMessage(message);
  };

  const handlePublish = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    setPublishError(null);
    // Catturato PRIMA della chiamata: publishedAppId cambia appena la
    // risposta arriva, ma "era la prima pubblicazione" va deciso guardando
    // lo stato COM'ERA quando l'utente ha premuto il bottone.
    const wasFirstPublish = !publishedAppId;

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setPublishError(translate('creator_v2_error_session_expired'));
        return;
      }

      const response = await fetch('/api/creator/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schema, appId: publishedAppId }),
      });
      const data = await response.json();

      if (data.success && data.data) {
        setPublishedAppId(data.data.appId);
        setPublishResult(data.data);

        // Branding reseller: se l'utente aveva compilato il pannello PRIMA
        // che l'app esistesse (nessun appId su cui fare PATCH allora), lo
        // applica ora che l'app è appena stata creata — una volta sola,
        // stessa route PATCH /api/apps/[id] riusata dal pannello stesso.
        // Best-effort: un fallimento qui non deve mai far sembrare fallita
        // la pubblicazione, che è già andata a buon fine.
        if (wasFirstPublish) {
          const draftPayload = buildBrandingPayload(brandingDraft);
          if (draftPayload) {
            const brandingResult = await saveBrandingForApp(data.data.appId, draftPayload, session.access_token);
            if (!brandingResult.ok) {
              console.error('[AppEditorView] branding draft apply error:', brandingResult.error);
            }
            setBrandingDraft(EMPTY_BRANDING_FORM);
          }
        }
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        setPublishError(data.message || translate('creator_v2_error_slots_exhausted'));
        router.push(data.redirectTo || '/pricing');
      } else {
        setPublishError(data.error || translate('creator_v2_error_publish_generic'));
      }
    } catch (err) {
      console.error('[AppEditorView] publish error:', err);
      setPublishError(translate('creator_v2_error_connection_retry_short'));
    } finally {
      setIsPublishing(false);
    }
  };

  // Hardening 2/2 — Versioni/rollback: il token viene recuperato al momento
  // dell'apertura (mai riusato "vecchio"), stesso pattern di handleSend/
  // handlePublish sopra. Il pannello stesso decide/valida tenant e ownership
  // lato server (API /api/creator/rollback, invariata) — qui non si fa
  // altro che passargli appId + token.
  const [versionsAccessToken, setVersionsAccessToken] = useState<string | null>(null);
  const handleOpenVersions = async () => {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) {
      setPublishError(translate('creator_v2_error_session_expired'));
      return;
    }
    setVersionsAccessToken(session.access_token);
    setShowVersions(true);
  };

  // Invocata dal pannello SOLO dopo un rollback riuscito (mai automatico):
  // aggiorna editor + preview con lo schema ripristinato, propaga al
  // chiamante esterno (stesso contratto di handleSend/handlePublish) e
  // mostra conferma esplicita all'utente.
  const handleRollback = (restoredSchema: SiteBlueprintJSON) => {
    setSchema(restoredSchema);
    setActivePageSlug((prev) => (restoredSchema.pages.some((p) => p.slug === prev) ? prev : restoredSchema.pages[0]?.slug));
    onSchemaChange?.(restoredSchema);
    setShowVersions(false);
    // Il rollback aggiorna apps.config direttamente lato server (stesso
    // contratto già in produzione, invariato): l'app pubblicata è già
    // ripristinata a questo punto, non serve un ulteriore "Salva Modifiche".
    setRollbackNotice(translate('creator_v2_rollback_success'));
  };

  // Branding reseller: stesso pattern token-al-momento-dell'apertura di
  // handleOpenVersions sopra. Il pannello stesso decide se salvare subito
  // (app già pubblicata, PATCH /api/apps/[id]) o solo aggiornare il draft
  // locale (app non ancora pubblicata) — qui si riceve comunque il form
  // aggiornato in `onClose`, così il draft resta sincronizzato in entrambi
  // i casi (utile se l'utente riapre il pannello prima di pubblicare).
  const handleOpenBranding = async () => {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (!session?.access_token) {
      setPublishError(translate('creator_v2_error_session_expired'));
      return;
    }
    setBrandingAccessToken(session.access_token);
    setShowBranding(true);
  };

  const handleCloseBranding = (draft: BrandingFormState) => {
    setBrandingDraft(draft);
    setShowBranding(false);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ── Header: nome app + pubblica/salva ── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{schema.businessConfig.name || schema.appName}</div>
          {publishError && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-red-400">
              <AlertCircle size={12} className="shrink-0" /> {publishError}
            </div>
          )}
          {rollbackNotice && !publishError && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 size={12} className="shrink-0" /> {rollbackNotice}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Branding reseller: sempre visibile, anche prima della prima
              pubblicazione (raccoglie solo il draft finché non esiste un
              appId, vedi handleOpenBranding/handleCloseBranding). */}
          <button
            onClick={handleOpenBranding}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            <Palette size={14} /> {t.brandingButton}
          </button>
          {/* Hardening 2/2: solo per un'app già pubblicata almeno una volta
              (publishedAppId) — nessuna cronologia possibile prima. */}
          {publishedAppId && (
            <button
              onClick={handleOpenVersions}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              <Clock size={14} /> {t.versionsButton}
            </button>
          )}
          <button
            onClick={handlePublish}
            disabled={isPublishing}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:bg-gray-700"
          >
            {isPublishing ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
            {isPublishing ? t.publishingButton : publishedAppId ? t.saveButton : t.publishButton}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* ── Colonna sinistra: anteprima live ──
            Nessun frame/mock (niente bordo telefono, ombra, padding attorno
            al sito): SitePreview qui sotto renderizza il sito pubblico reale
            a piena larghezza/altezza del pannello, esattamente come apparirà
            in produzione — solo la toolbar di navigazione pagine resta UI
            dell'editor, non fa parte del sito. */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
          <div className="flex items-center gap-1 overflow-x-auto p-4 pb-3">
            {schema.pages.map((p) => (
              <button
                key={p.slug}
                onClick={() => setActivePageSlug(p.slug)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activePageSlug === p.slug ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            <SitePreview
              schema={schema}
              activePageSlug={activePageSlug}
              onNavigate={setActivePageSlug}
            />
          </div>
        </div>

        {/* ── Colonna destra: chat copilot ── */}
        <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles size={16} className="text-indigo-400" />
              {t.chatTitle}
            </div>
            <p className="mt-1 text-xs text-gray-500">{t.chatSubtitle}</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-center text-xs text-gray-500">{t.emptyState}</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : m.role === 'error'
                          ? 'flex items-center gap-1.5 bg-red-900/30 text-red-300'
                          : 'bg-gray-800 text-gray-200'
                    }`}
                  >
                    {m.role === 'error' && <AlertCircle size={13} className="shrink-0" />}
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {isSending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" /> {translate('creator_v2_applying_change')}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="flex items-end gap-2 border-t border-gray-800 p-3">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t.inputPlaceholder}
                rows={2}
                disabled={isSending}
                className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 p-2.5 pr-9 text-xs text-white placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              />
              {isVoiceSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={isSending}
                  className={`absolute right-1.5 top-1.5 rounded-md p-1.5 transition-colors disabled:opacity-40 ${
                    isListening
                      ? 'bg-red-500/20 text-red-400 animate-pulse'
                      : 'text-gray-500 hover:bg-gray-700 hover:text-white'
                  }`}
                  title={isListening ? translate('creator_v2_mic_stop') : translate('creator_v2_mic_start')}
                >
                  {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:bg-gray-700"
              aria-label={t.sendButton}
            >
              {isSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      {publishResult && (
        <PublishSuccessModal result={publishResult} onClose={() => setPublishResult(null)} />
      )}

      {showVersions && publishedAppId && versionsAccessToken && (
        <VersionHistoryPanel
          appId={publishedAppId}
          currentSchema={schema}
          accessToken={versionsAccessToken}
          onRollback={handleRollback}
          onClose={() => setShowVersions(false)}
        />
      )}

      {showBranding && brandingAccessToken && (
        <BrandingPanel
          appId={publishedAppId}
          accessToken={brandingAccessToken}
          initialDraft={brandingDraft}
          onClose={handleCloseBranding}
          onApplyInstructions={sendChatMessage}
        />
      )}
    </div>
  );
}
