'use client';

// ─── AppEditorView ──────────────────────────────────────────────────────────
// Editor split-view del motore Sito/PWA: anteprima live a sinistra (hot
// reload locale, nessuna richiesta di rete al variare dello schema — l'unica
// chiamata di rete è quella verso /api/creator/refactor quando l'utente invia
// un messaggio in chat), copilot a chat a destra.

import { useEffect, useRef, useState } from 'react';
import { Smartphone, Monitor, Send, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import SitePreview, { type PreviewViewport } from './SitePreview';
import type { SiteBlueprintJSON } from '@/src/lib/site-schema';

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

export interface AppEditorViewLabels {
  chatTitle: string;
  chatSubtitle: string;
  inputPlaceholder: string;
  sendButton: string;
  emptyState: string;
  appliedMessage: string;
}

const DEFAULT_LABELS: AppEditorViewLabels = {
  chatTitle: 'ZeusX Copilot',
  chatSubtitle: 'Scrivi una modifica e la vedi applicata subito a sinistra.',
  inputPlaceholder: 'Es. "Cambia il colore principale in blu navy", "Aggiungi una sezione recensioni in Home"',
  sendButton: 'Invia',
  emptyState: 'Nessuna modifica ancora. Scrivi il primo comando qui sotto.',
  appliedMessage: 'Fatto — modifica applicata.',
};

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

  const [schema, setSchema] = useState<SiteBlueprintJSON>(initialSchema);
  const [viewport, setViewport] = useState<PreviewViewport>('mobile');
  const [activePageSlug, setActivePageSlug] = useState(initialSchema.pages[0]?.slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ schema, message, lang, appId }),
      });
      const data = await response.json();

      if (data.success && data.data?.schema) {
        setSchema(data.data.schema);
        onSchemaChange?.(data.data.schema);
        setMessages((prev) => [...prev, { role: 'assistant', content: t.appliedMessage }]);
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

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      {/* ── Colonna sinistra: anteprima live ── */}
      <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-950 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1 overflow-x-auto">
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
          <div className="flex gap-1 rounded-lg border border-gray-800 p-1">
            <button
              onClick={() => setViewport('mobile')}
              aria-pressed={viewport === 'mobile'}
              className={`rounded p-1.5 ${viewport === 'mobile' ? 'bg-gray-800 text-white' : 'text-gray-500'}`}
              title="Mobile"
            >
              <Smartphone size={16} />
            </button>
            <button
              onClick={() => setViewport('desktop')}
              aria-pressed={viewport === 'desktop'}
              className={`rounded p-1.5 ${viewport === 'desktop' ? 'bg-gray-800 text-white' : 'text-gray-500'}`}
              title="Desktop"
            >
              <Monitor size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-start justify-center overflow-y-auto py-2">
          <SitePreview
            schema={schema}
            activePageSlug={activePageSlug}
            onNavigate={setActivePageSlug}
            viewport={viewport}
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
            className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-xs text-white placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
          />
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
  );
}
