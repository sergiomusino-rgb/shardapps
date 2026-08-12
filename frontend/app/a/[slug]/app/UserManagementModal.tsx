'use client';

// ─── UserManagementModal ────────────────────────────────────────────────────
// Pannello "Gestione Team / Utenti" (Fase 4 CreatorAI): visibile solo agli
// admin di un'app auth_mode='rbac' (gating a monte, vedi page.tsx — questo
// componente non ri-verifica il ruolo, si fida del chiamante come tutti gli
// altri modali di questo pannello, es. SettingsModal). Elenca/crea/revoca
// utenti in app_rbac_users tramite gli endpoint dedicati
// (backend/routes/client-app.js, guardia requireAdminRbac).

import { useEffect, useState } from 'react';
import { Plus, Trash2, Users, X, ShieldCheck } from 'lucide-react';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RbacUser {
  id: string;
  client_email: string;
  role: 'admin' | 'operator' | 'viewer';
  created_at: string;
}

const ROLE_LABEL: Record<RbacUser['role'], string> = {
  admin: 'Amministratore',
  operator: 'Operatore',
  viewer: 'Sola lettura',
};

const SELECT_CLASSES = 'flex h-10 w-full appearance-none rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3.5 py-2 text-sm text-tenant-text outline-none transition-colors focus:border-tenant-primary';

export default function UserManagementModal({
  appId,
  authToken,
  onClose,
}: {
  appId: string;
  authToken: string;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<RbacUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'operator' | 'viewer'>('operator');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/client/apps/${appId}/users`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Errore caricamento utenti');
        setUsers([]);
        return;
      }
      setUsers(data.users || []);
    } catch {
      setLoadError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Stesso pattern già usato altrove nel pannello (es. loadRecords in
    // page.tsx): fetch-on-mount, la prima cosa che loadUsers fa è
    // setLoading(true) (già il valore iniziale qui, ma il pattern resta
    // identico per i re-fetch su cambio app).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    // loadUsers è ridefinita ad ogni render (non useCallback): includerla
    // nelle dep innescherebbe un loop di fetch, stesso motivo per cui gli
    // effetti equivalenti altrove nel pannello (es. loadRecords in page.tsx)
    // dipendono solo dagli id, non dalla funzione.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!email.trim() || !email.includes('@')) {
      setFormError('Inserisci un\'email valida');
      return;
    }
    if (password.length < 6) {
      setFormError('La password deve avere almeno 6 caratteri');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/client/apps/${appId}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Errore durante la creazione');
        return;
      }
      setEmail('');
      setPassword('');
      setRole('operator');
      await loadUsers();
    } catch {
      setFormError('Errore di connessione');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (user: RbacUser) => {
    if (!confirm(`Revocare l'accesso a ${user.client_email}?`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch(`/api/client/apps/${appId}/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Errore durante la revoca');
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch {
      alert('Errore di connessione');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidthClassName="max-w-[640px]">
      <DialogHeader title="Gestione Team" onClose={onClose} />

      <div className="flex flex-col gap-4.5">
        {/* ─── Elenco utenti ─── */}
        <div className="rounded-xl border border-tenant-border bg-tenant-card-alt p-5">
          <div className="mb-3 flex items-center gap-2 text-[15px] font-bold uppercase tracking-wide text-tenant-text">
            <Users size={16} /> Utenti ({users.length})
          </div>

          {loading ? (
            <p className="p-4 text-center text-[13px] text-tenant-text-secondary">Caricamento...</p>
          ) : loadError ? (
            <p className="p-4 text-center text-[13px] text-tenant-danger">{loadError}</p>
          ) : users.length === 0 ? (
            <p className="p-4 text-center text-[13px] text-tenant-text-secondary">Nessun utente ancora.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg border border-tenant-border bg-tenant-card px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-tenant-text">{u.client_email}</div>
                    <div className="flex items-center gap-1 text-xs text-tenant-text-secondary">
                      {u.role === 'admin' && <ShieldCheck size={12} className="text-tenant-primary" />}
                      {ROLE_LABEL[u.role]}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleDelete(u)}
                    disabled={deletingId === u.id}
                    title="Revoca accesso"
                  >
                    {deletingId === u.id ? <X size={14} className="animate-pulse" /> : <Trash2 size={14} />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Nuovo utente ─── */}
        <div className="rounded-xl border border-tenant-border bg-tenant-card-alt p-5">
          <div className="mb-3 text-[15px] font-bold uppercase tracking-wide text-tenant-text">Aggiungi Utente</div>
          <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.com"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Almeno 6 caratteri"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Ruolo</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'operator' | 'viewer')}
                className={SELECT_CLASSES}
              >
                <option value="operator">Operatore — può creare/modificare i dati ed eseguire azioni consentite</option>
                <option value="viewer">Sola lettura — può solo consultare i dati</option>
              </select>
            </div>

            {formError && (
              <div className="rounded-lg bg-tenant-danger/15 px-3.5 py-2.5 text-[13px] text-tenant-danger">
                {formError}
              </div>
            )}

            <Button type="submit" disabled={creating} className="self-start">
              <Plus size={14} /> {creating ? 'Creazione...' : 'Aggiungi utente'}
            </Button>
          </form>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Chiudi</Button>
        </div>
      </div>
    </Dialog>
  );
}
