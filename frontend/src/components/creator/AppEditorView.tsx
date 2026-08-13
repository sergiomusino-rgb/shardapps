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
  Rocket, CheckCircle2, Copy, X, ExternalLink, Mic, MicOff,
} from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import SitePreview from './SitePreview';
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
}

const DEFAULT_LABELS: AppEditorViewLabels = {
  chatTitle: 'ShardApps Copilot',
  chatSubtitle: 'Scrivi una modifica e la vedi applicata subito a sinistra.',
  inputPlaceholder: 'Es. "Cambia il colore principale in blu navy", "Aggiungi una sezione recensioni in Home"',
  sendButton: 'Invia',
  emptyState: 'Nessuna modifica ancora. Scrivi il primo comando qui sotto.',
  appliedMessage: 'Fatto — modifica applicata.',
  publishButton: 'Pubblica Gestionale',
  publishingButton: 'Pubblicazione in corso…',
  saveButton: 'Salva Modifiche',
};

function CopyField({ label, value }: { label: string; value: string }) {
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
          aria-label={`Copia ${label}`}
        >
          {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function PublishSuccessModal({ result, onClose }: { result: PublishResult; onClose: () => void }) {
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
                {result.updated ? 'Modifiche salvate' : 'Gestionale pubblicato!'}
              </h3>
              <p className="text-xs text-gray-500">
                {result.updated ? 'Le ultime modifiche sono online.' : 'La tua PWA è online e pronta all\'uso.'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <CopyField label="Link app" value={result.url} />
          {!result.updated && result.clientEmail && <CopyField label="Email accesso" value={result.clientEmail} />}
          {!result.updated && result.clientPassword && <CopyField label="Password accesso" value={result.clientPassword} />}
        </div>

        {!result.updated && (
          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            Salva queste credenziali: la password non verrà mostrata di nuovo qui (potrai comunque reimpostarla in seguito).
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            <ExternalLink size={14} /> Apri l&apos;app
          </a>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            Chiudi
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
  const t = { ...DEFAULT_LABELS, ...labels };
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

  const handleSend = async () => {
    const message = input.trim();
    if (!message || isSending) return;

    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setIsSending(true);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setMessages((prev) => [...prev, { role: 'error', content: 'Sessione scaduta, effettua di nuovo il login.' }]);
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
          ? `${t.appliedMessage} La tua richiesta sembra menzionare uno stato/workflow, ma non vedo ancora un campo di questo tipo nello schema — puoi riprovare a chiederlo in modo più esplicito.`
          : t.appliedMessage;
        setMessages((prev) => [...prev, { role: 'assistant', content: appliedMessage }]);
      } else {
        setMessages((prev) => [...prev, { role: 'error', content: data.error || 'Errore durante la modifica.' }]);
      }
    } catch (err) {
      console.error('[AppEditorView] refactor error:', err);
      setMessages((prev) => [...prev, { role: 'error', content: 'Errore di connessione. Riprova.' }]);
    } finally {
      setIsSending(false);
    }
  };

  const handlePublish = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    setPublishError(null);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        setPublishError('Sessione scaduta, effettua di nuovo il login.');
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
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        setPublishError(data.message || 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.');
        router.push(data.redirectTo || '/pricing');
      } else {
        setPublishError(data.error || 'Errore durante la pubblicazione.');
      }
    } catch (err) {
      console.error('[AppEditorView] publish error:', err);
      setPublishError('Errore di connessione. Riprova.');
    } finally {
      setIsPublishing(false);
    }
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
        </div>
        <button
          onClick={handlePublish}
          disabled={isPublishing}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:bg-gray-700"
        >
          {isPublishing ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
          {isPublishing ? t.publishingButton : publishedAppId ? t.saveButton : t.publishButton}
        </button>
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
                  <Loader2 size={13} className="animate-spin" /> Applico la modifica…
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
                  title={isListening ? 'Stop listening' : 'Speak to enter text'}
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
    </div>
  );
}
