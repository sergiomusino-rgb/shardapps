'use client';

// ─── Admin Panel del motore Sito/PWA (Creator v2) ───────────────────────────
// Sblocca la gestione dati (config.adminPanel.entities) dopo il login a
// password legacy — stessa identica autenticazione del motore v1 (Bearer
// password verso /api/client/apps/:appId/records, vedi backend/routes/
// client-app.js::clientAuthMiddleware), ma senza toccare app/a/[slug]/app
// (troppo grande e già in produzione per il vecchio schema a tabelle): un
// pannello nuovo e minimale che riusa DynamicTable.tsx così com'è, mappando
// le entità del nuovo schema (site-schema.ts) allo stesso TableDef che
// DynamicTable già sa renderizzare.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ExternalLink, Menu as MenuIcon } from 'lucide-react';
import DynamicTable, { type TableDef, type FieldDef } from '@/components/DynamicTable';
import { useAppInfo } from '../AppInfoContext';
import { getAuthToken } from '../app/session-helpers';
import { sanitizeSiteBlueprint } from '@/src/lib/site-schema';

interface StoredSession {
  slug: string;
  password?: string;
  mode?: 'legacy' | 'supabase';
  accessToken?: string;
  appInfo: { id: string };
}

function getThemeColors(primaryColor: string) {
  return {
    bg: '#0a0e1a',
    text: '#ffffff',
    textSecondary: '#94a3b8',
    cardBg: '#1e293b',
    cardBgAlt: '#162032',
    border: '#334155',
    sidebarBg: '#0f172a',
    sidebarText: '#e2e8f0',
    sidebarHover: '#1e293b',
    inputBg: '#0f172a',
    inputBorder: '#334155',
    primary: primaryColor,
    primaryHover: primaryColor + 'dd',
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
  };
}

export default function GestionalePage() {
  const router = useRouter();
  const { slug, config, appId: contextAppId } = useAppInfo();
  const schema = useMemo(() => sanitizeSiteBlueprint(config), [config]);

  const [session, setSession] = useState<StoredSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [selectedEntityName, setSelectedEntityName] = useState<string | null>(null);

  // La sessione vive in localStorage (stesso meccanismo di app/a/[slug]/app):
  // niente login proprio qui, se manca si torna alla pagina pubblica dove
  // "Area Riservata" apre il gate a password condiviso con il motore v1.
  useEffect(() => {
    const raw = localStorage.getItem(`app_session_${slug}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed?.appInfo?.id) setSession(parsed);
      } catch {
        // sessione corrotta, trattata come assente
      }
    }
    setCheckedSession(true);
  }, [slug]);

  useEffect(() => {
    if (checkedSession && !session) {
      router.replace(`/a/${slug}`);
    }
  }, [checkedSession, session, slug, router]);

  const entities = schema?.adminPanel.entities || [];

  useEffect(() => {
    if (!selectedEntityName && entities.length > 0) {
      setSelectedEntityName(entities[0].name);
    }
  }, [entities, selectedEntityName]);

  const tables: TableDef[] = useMemo(
    () =>
      entities.map((e) => ({
        name: e.name,
        label: e.label,
        labelPlural: e.labelPlural,
        icon: e.icon || '',
        fields: e.fields
          .filter((f) => f.type !== 'id')
          .map((f): FieldDef => ({ name: f.id, id: f.id, label: f.label, type: f.type, options: f.options || undefined, required: f.required })),
      })),
    [entities]
  );

  const selectedTable = tables.find((t) => t.name === selectedEntityName) || null;
  const colors = useMemo(() => getThemeColors(schema?.ui.primaryColor || '#6366f1'), [schema]);
  const appId = session?.appInfo.id || contextAppId;
  const authToken = session ? getAuthToken(session) : '';

  const handleLogout = () => {
    localStorage.removeItem(`app_session_${slug}`);
    router.push(`/a/${slug}`);
  };

  if (!checkedSession || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: colors.bg }}>
        <div style={{ color: colors.textSecondary }}>Verifica accesso…</div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center" style={{ background: colors.bg, color: colors.text }}>
        Configurazione app non valida.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ background: colors.bg }}>
      {/* Sidebar */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r" style={{ background: colors.sidebarBg, borderColor: colors.border }}>
        <div className="flex items-center gap-3 border-b p-5" style={{ borderColor: colors.border }}>
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white"
            style={{ background: colors.primary }}
          >
            {schema.businessConfig.name.charAt(0).toUpperCase() || 'A'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold" style={{ color: colors.sidebarText }}>{schema.businessConfig.name}</div>
            <div className="text-xs" style={{ color: colors.textSecondary }}>Gestione dati</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: colors.textSecondary }}>
            Sezioni
          </div>
          {tables.length === 0 ? (
            <p className="px-2 text-xs" style={{ color: colors.textSecondary }}>Nessuna sezione configurata.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {tables.map((table) => (
                <button
                  key={table.name}
                  onClick={() => setSelectedEntityName(table.name)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                  style={
                    selectedEntityName === table.name
                      ? { background: colors.primary + '25', color: colors.primary }
                      : { color: colors.sidebarText }
                  }
                >
                  <span className="truncate">{table.labelPlural}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="flex flex-col gap-1 border-t p-3" style={{ borderColor: colors.border }}>
          <a
            href={`/a/${slug}`}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            style={{ color: colors.sidebarText }}
          >
            <ExternalLink size={15} /> Vedi il sito pubblico
          </a>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
            style={{ color: colors.danger }}
          >
            <LogOut size={15} /> Esci
          </button>
        </div>
      </aside>

      {/* Contenuto */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ background: colors.cardBg, borderColor: colors.border }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: colors.text }}>
              {selectedTable?.labelPlural || 'Seleziona una sezione'}
            </h1>
            {selectedTable && (
              <p className="text-xs" style={{ color: colors.textSecondary }}>Gestione record — {selectedTable.label}</p>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {selectedTable ? (
            <DynamicTable
              table={selectedTable}
              colors={colors}
              radius="rounded-xl"
              shadow="shadow-xl"
              appId={appId}
              password={authToken}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2" style={{ color: colors.textSecondary }}>
              <MenuIcon size={40} />
              <p className="text-sm">Seleziona una sezione dal menu per gestirne i dati.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
