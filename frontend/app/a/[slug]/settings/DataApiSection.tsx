'use client';

// ─── DataApiSection ─────────────────────────────────────────────────────────
// Scheda "Data & API" in /a/[slug]/settings: export completo dei dati
// dell'app (ZIP) e gestione delle API key della Public API v1
// (/api/v1/apps/:appId/..., backend/routes/public-api.js). Stesso stile e
// stesso pattern (authHeader via sessione Supabase, proxy Next.js verso il
// backend Express) delle altre schede di questa pagina — vedi
// PushNotificationSection.tsx.

import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Key, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function statusBadge(status: ApiKeySummary['status']) {
  const styles: Record<ApiKeySummary['status'], string> = {
    active: 'bg-green-500/20 text-green-400',
    revoked: 'bg-red-500/20 text-red-400',
    expired: 'bg-yellow-500/20 text-yellow-400',
  };
  const labels: Record<ApiKeySummary['status'], string> = {
    active: 'Attiva',
    revoked: 'Revocata',
    expired: 'Scaduta',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>{labels[status]}</span>;
}

export default function DataApiSection({ appId, slug }: { appId: string; slug: string }) {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<{ read: boolean; write: boolean }>({ read: true, write: false });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!appId) return;
    setKeysLoading(true);
    try {
      const res = await fetch(`/api/apps/${appId}/api-keys`, { headers: await authHeader() });
      const data = await res.json();
      if (res.ok) setKeys(data.keys || []);
    } catch {
      // elenco informativo: un errore di rete non deve bloccare il resto della pagina
    } finally {
      setKeysLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/export-all`, { headers: await authHeader() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Errore durante l\'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shardapps-export-${slug}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Errore durante l\'export');
    } finally {
      setExporting(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!newKeyName.trim()) {
      setCreateError('Assegna un nome alla chiave (es. "Integrazione gestionale")');
      return;
    }
    const scopes = [
      ...(newKeyScopes.read ? ['read'] : []),
      ...(newKeyScopes.write ? ['write'] : []),
    ];
    if (scopes.length === 0) {
      setCreateError('Seleziona almeno uno scope (lettura o scrittura)');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`/api/apps/${appId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ name: newKeyName.trim(), scopes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Errore durante la creazione della chiave');
        return;
      }
      setRevealedKey(data.apiKey);
      setNewKeyName('');
      setNewKeyScopes({ read: true, write: false });
      setShowCreateForm(false);
      loadKeys();
    } catch {
      setCreateError('Errore di connessione');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string, name: string) => {
    if (!confirm(`Revocare la chiave "${name}"? Non potrà più essere usata per accedere ai dati.`)) return;
    try {
      const res = await fetch(`/api/apps/${appId}/api-keys/${keyId}/revoke`, {
        method: 'POST',
        headers: await authHeader(),
      });
      if (res.ok) loadKeys();
    } catch {
      // ignorato: l'elenco resta invariato, l'utente può riprovare
    }
  };

  const handleCopy = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard non disponibile (es. contesto non sicuro): l'utente può selezionare a mano
    }
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Key className="w-5 h-5 text-violet-400" />
          Data &amp; API
        </h2>
        <a
          href={`/a/${slug}/settings/api-docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
        >
          Documentazione API <ExternalLink size={14} />
        </a>
      </div>

      {/* ─── Data Export ─────────────────────────────────────────────── */}
      <div className="mb-6 pb-6 border-b border-slate-800">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Esporta i tuoi dati</h3>
        <p className="text-sm text-gray-500 mb-3">
          Scarica un archivio ZIP con schema, definizioni delle tabelle e tutti i record di questa app —
          utile per un backup o per migrare i dati altrove.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 px-4 py-2.5 text-sm font-semibold text-white transition"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download size={16} />}
          Esporta tutti i dati
        </button>
        {exportError && <p className="mt-2 text-sm text-red-400">{exportError}</p>}
      </div>

      {/* ─── API Access ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-300">Accesso API</h3>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="text-violet-400 hover:text-violet-300 text-sm font-medium"
          >
            {showCreateForm ? 'Annulla' : '+ Crea API key'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          Collega questa app a software esterni tramite la Public API v1, autenticata con una API key dedicata.
        </p>

        {revealedKey && (
          <div className="mb-4 p-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
            <div className="flex items-start gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-yellow-300 font-medium">
                Salva questa chiave adesso. Non verrà più mostrata.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-slate-950/60 rounded px-3 py-2 text-xs text-gray-200 font-mono">
                {revealedKey}
              </code>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-gray-300 hover:bg-slate-700"
              >
                <Copy size={13} /> {copied ? 'Copiata!' : 'Copia'}
              </button>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              className="mt-2 text-xs text-gray-400 hover:text-gray-300 underline"
            >
              Ho salvato la chiave, nascondi
            </button>
          </div>
        )}

        {showCreateForm && (
          <form onSubmit={handleCreateKey} className="mb-4 p-4 rounded-lg border border-slate-800 bg-slate-800/30 space-y-3">
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Nome chiave</label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder='es. "Integrazione gestionale esterno"'
                className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1.5">Permessi</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={newKeyScopes.read}
                    onChange={(e) => setNewKeyScopes((s) => ({ ...s, read: e.target.checked }))}
                  />
                  Lettura (GET)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={newKeyScopes.write}
                    onChange={(e) => setNewKeyScopes((s) => ({ ...s, write: e.target.checked }))}
                  />
                  Scrittura (POST/PATCH/DELETE)
                </label>
              </div>
            </div>
            {createError && <p className="text-sm text-red-400">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 px-4 py-2 text-sm font-semibold text-white transition"
            >
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              Genera chiave
            </button>
          </form>
        )}

        {keysLoading ? (
          <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Caricamento...
          </div>
        ) : keys.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">Nessuna API key creata per questa app.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-800/60">
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Nome</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Chiave</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Scope</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Creata</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Ultimo uso</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400">Stato</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-400"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-slate-800">
                    <td className="px-3 py-2 text-gray-200">{k.name}</td>
                    <td className="px-3 py-2 text-gray-400 font-mono text-xs">{k.keyPrefix}…</td>
                    <td className="px-3 py-2 text-gray-400">{k.scopes.join(', ')}</td>
                    <td className="px-3 py-2 text-gray-400">{new Date(k.createdAt).toLocaleDateString('it-IT')}</td>
                    <td className="px-3 py-2 text-gray-400">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString('it-IT') : 'Mai'}
                    </td>
                    <td className="px-3 py-2">{statusBadge(k.status)}</td>
                    <td className="px-3 py-2">
                      {k.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs"
                          title="Revoca chiave"
                        >
                          <Trash2 size={13} /> Revoca
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
