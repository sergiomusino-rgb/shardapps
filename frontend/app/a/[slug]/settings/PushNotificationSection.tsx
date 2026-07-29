'use client';

// ─── PushNotificationSection ────────────────────────────────────────────────
// Scheda "Notifiche Push" in /a/[slug]/settings: mostra il numero di iscritti
// attivi e permette all'owner di inviare una notifica broadcast (titolo,
// messaggio, URL di destinazione) a tutti i visitatori della PWA che hanno
// attivato le notifiche (vedi components/PushNotificationBanner.tsx).

import { useEffect, useState } from 'react';
import { Bell, Loader2, Send, Users } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function PushNotificationSection({ appId }: { appId: string }) {
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('/');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!appId) return;
    (async () => {
      try {
        const res = await fetch(`/api/apps/${appId}/send-push`, { headers: await authHeader() });
        const data = await res.json();
        if (res.ok) setSubscriberCount(data.count);
      } catch {
        // Il contatore è informativo: se la fetch fallisce resta a "-",
        // non blocca il resto della scheda impostazioni.
      }
    })();
  }, [appId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/apps/${appId}/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ title, message, url: url || '/' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ type: 'error', text: data.error || 'Errore invio notifica' });
        return;
      }
      setResult({ type: 'success', text: `Inviata a ${data.sent} iscritti${data.removed ? ` (${data.removed} subscription scadute rimosse)` : ''}.` });
      setTitle('');
      setMessage('');
      setUrl('/');
    } catch {
      setResult({ type: 'error', text: 'Errore di connessione' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Bell className="w-5 h-5 text-violet-400" />
          Notifiche Push
        </h2>
        <span className="flex items-center gap-1.5 text-sm text-gray-400">
          <Users size={15} />
          {subscriberCount === null ? '—' : subscriberCount} iscritti
        </span>
      </div>

      <form onSubmit={handleSend} className="space-y-4">
        <div>
          <label className="block text-gray-400 text-sm mb-2">Titolo</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es. Il tuo ordine è pronto!"
            required
            maxLength={100}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">Messaggio</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Es. Passa a ritirarlo quando vuoi!"
            required
            maxLength={300}
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">URL di destinazione</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
          />
          <p className="text-xs text-gray-500 mt-1">Aperta quando l&apos;utente tocca la notifica (es. /a/{'{slug}'}/ordini).</p>
        </div>

        {result && (
          <div className={`p-3 rounded-lg text-sm ${result.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>
            {result.text}
          </div>
        )}

        <button
          type="submit"
          disabled={sending || !subscriberCount}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          {sending ? 'Invio...' : 'Invia Notifica'}
        </button>
        {!subscriberCount && subscriberCount !== null && (
          <p className="text-xs text-center text-gray-500">Nessun iscritto attivo: la notifica non ha destinatari.</p>
        )}
      </form>
    </div>
  );
}
