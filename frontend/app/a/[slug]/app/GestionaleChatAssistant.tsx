'use client';

// ─── Assistente AI del Gestionale ───────────────────────────────────────────
// Widget di chat operativa per l'Area Riservata (v1, condivisa da /app e
// /gestionale): risponde su dati dell'app (businessConfig/branding, tabelle,
// record recenti della sezione aperta) tramite Groq (vedi
// backend/routes/client-app.js::POST /client/apps/:appId/chat) — ultra-veloce
// e a basso costo, non modifica mai schema o dati (solo consultazione/bozze).

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles } from 'lucide-react';

interface ChatColors {
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  inputBg: string;
  inputBorder: string;
  primary: string;
  danger: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function GestionaleChatAssistant({
  appId,
  authToken,
  activeTable,
  colors,
}: {
  appId?: string;
  authToken?: string;
  activeTable?: string | null;
  colors: ChatColors;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !appId || !authToken) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`/api/client/apps/${appId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ messages: next, activeTable: activeTable || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'Errore durante la risposta');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore di connessione');
    } finally {
      setSending(false);
    }
  };

  if (!appId || !authToken) return null;

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-5 z-50 flex h-[480px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ borderColor: colors.border, background: colors.cardBg }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: colors.border }}>
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: colors.text }}>
              <Sparkles size={16} style={{ color: colors.primary }} /> Assistente
            </div>
            <button onClick={() => setOpen(false)} style={{ color: colors.textSecondary }} aria-label="Chiudi">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-center text-xs" style={{ color: colors.textSecondary }}>
                Chiedimi dei dati della tua attività: contatti, orari, listini o una bozza di messaggio per un cliente.
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-xs leading-relaxed"
                    style={
                      m.role === 'user'
                        ? { background: colors.primary, color: '#fff' }
                        : { background: colors.inputBg, color: colors.text }
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs"
                  style={{ background: colors.inputBg, color: colors.textSecondary }}
                >
                  <Loader2 size={13} className="animate-spin" /> Sto scrivendo…
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-lg px-3 py-2 text-[11px] font-medium" style={{ background: colors.danger + '20', color: colors.danger }}>
                {error}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-end gap-2 border-t p-3" style={{ borderColor: colors.border }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Scrivi un messaggio…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none rounded-lg border p-2.5 text-xs outline-none disabled:opacity-60"
              style={{ background: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-opacity disabled:opacity-40"
              style={{ background: colors.primary }}
              aria-label="Invia"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105"
        style={{ background: colors.primary }}
        aria-label="Assistente AI"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </>
  );
}
