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

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ExternalLink, Menu as MenuIcon, Plus, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import DynamicTable, { type TableDef, type FieldDef } from '@/components/DynamicTable';
import { useAppInfo } from '../AppInfoContext';
import { getAuthToken } from '../app/session-helpers';
import { sanitizeSiteBlueprint, type BusinessConfig } from '@/src/lib/site-schema';

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
  const [view, setView] = useState<'entity' | 'settings'>('entity');
  // Rispecchia l'ultimo salvataggio riuscito di businessConfig: sito pubblico
  // e gestionale leggono lo stesso apps.config, ma qui evitiamo un refetch
  // completo della sessione solo per riflettere subito il nuovo dato in UI.
  const [businessConfigOverride, setBusinessConfigOverride] = useState<BusinessConfig | null>(null);
  const [savingBusinessConfig, setSavingBusinessConfig] = useState(false);
  const [businessConfigError, setBusinessConfigError] = useState<string | null>(null);
  const [businessConfigSaved, setBusinessConfigSaved] = useState(false);

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
  const effectiveBusinessConfig = businessConfigOverride || schema?.businessConfig || null;

  const handleSaveBusinessConfig = async (next: BusinessConfig) => {
    if (!appId || !authToken) return;
    setSavingBusinessConfig(true);
    setBusinessConfigError(null);
    setBusinessConfigSaved(false);
    try {
      const res = await fetch(`/api/client/apps/${appId}/business-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Errore durante il salvataggio');
      }
      setBusinessConfigOverride(data.businessConfig as BusinessConfig);
      setBusinessConfigSaved(true);
      setTimeout(() => setBusinessConfigSaved(false), 2500);
    } catch (err) {
      setBusinessConfigError(err instanceof Error ? err.message : 'Errore di connessione');
    } finally {
      setSavingBusinessConfig(false);
    }
  };

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
            {(effectiveBusinessConfig?.name || schema.businessConfig.name).charAt(0).toUpperCase() || 'A'}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold" style={{ color: colors.sidebarText }}>{effectiveBusinessConfig?.name || schema.businessConfig.name}</div>
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
                  onClick={() => { setSelectedEntityName(table.name); setView('entity'); }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors"
                  style={
                    view === 'entity' && selectedEntityName === table.name
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
          <button
            onClick={() => setView('settings')}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
            style={
              view === 'settings'
                ? { background: colors.primary + '25', color: colors.primary }
                : { color: colors.sidebarText }
            }
          >
            ⚙️ Impostazioni Attività
          </button>
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
              {view === 'settings' ? 'Impostazioni Attività' : selectedTable?.labelPlural || 'Seleziona una sezione'}
            </h1>
            {view === 'settings' ? (
              <p className="text-xs" style={{ color: colors.textSecondary }}>Dati dell&apos;attività mostrati sul sito pubblico e nel gestionale</p>
            ) : selectedTable && (
              <p className="text-xs" style={{ color: colors.textSecondary }}>Gestione record — {selectedTable.label}</p>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {view === 'settings' ? (
            <BusinessConfigSettings
              value={effectiveBusinessConfig || schema.businessConfig}
              colors={colors}
              saving={savingBusinessConfig}
              error={businessConfigError}
              saved={businessConfigSaved}
              onSave={handleSaveBusinessConfig}
            />
          ) : selectedTable ? (
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

// ─── Impostazioni Attività ──────────────────────────────────────────────────
// Form di modifica di config.businessConfig (site-schema.ts): stessi dati
// letti dal sito pubblico (Hero, Chi Siamo, Contatti) e dalla sidebar del
// gestionale, quindi il salvataggio li tiene sincronizzati ovunque.

function BusinessConfigSettings({
  value,
  colors,
  saving,
  error,
  saved,
  onSave,
}: {
  value: BusinessConfig;
  colors: ReturnType<typeof getThemeColors>;
  saving: boolean;
  error: string | null;
  saved: boolean;
  onSave: (next: BusinessConfig) => void;
}) {
  // Niente useEffect di risincronizzazione: questo componente viene montato
  // solo mentre view === 'settings' (vedi ternario nel componente padre),
  // quindi ogni volta che l'utente torna su questa vista riparte da zero con
  // l'ultimo `value` — non serve altro per riflettere un save riuscito.
  const [form, setForm] = useState<BusinessConfig>(value);

  const update = <K extends keyof BusinessConfig>(key: K, val: BusinessConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const updateHour = (index: number, field: 'day' | 'hours', val: string) => {
    setForm((prev) => {
      const openingHours = prev.openingHours.map((h, i) => (i === index ? { ...h, [field]: val } : h));
      return { ...prev, openingHours };
    });
  };

  const addHour = () => setForm((prev) => ({ ...prev, openingHours: [...prev.openingHours, { day: '', hours: '' }] }));
  const removeHour = (index: number) =>
    setForm((prev) => ({ ...prev, openingHours: prev.openingHours.filter((_, i) => i !== index) }));

  const handleImageFile = (key: 'logoUrl' | 'heroImageUrl') => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => update(key, ((ev.target?.result as string) || '') as BusinessConfig[typeof key]);
    reader.readAsDataURL(file);
  };

  const inputStyle = { background: colors.inputBg, borderColor: colors.inputBorder, color: colors.text };
  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:opacity-90';
  const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide';
  const sectionCard = 'rounded-xl border p-5';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-10">
      {/* Identità */}
      <div className={sectionCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-4 text-sm font-bold" style={{ color: colors.text }}>Identità</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Nome Azienda</label>
            <input className={inputClass} style={inputStyle} value={form.name} onChange={(e) => update('name', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Subtitle / Payoff</label>
            <input className={inputClass} style={inputStyle} value={form.tagline} onChange={(e) => update('tagline', e.target.value)} placeholder="Frase breve d'effetto" />
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Descrizione / Note</label>
            <textarea className={inputClass} style={inputStyle} rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Presentazione dell'attività mostrata nella pagina Chi Siamo" />
          </div>
        </div>
      </div>

      {/* Contatti */}
      <div className={sectionCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-4 text-sm font-bold" style={{ color: colors.text }}>Contatti</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Indirizzo</label>
            <input className={inputClass} style={inputStyle} value={form.address} onChange={(e) => update('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: colors.textSecondary }}>Telefono</label>
              <input className={inputClass} style={inputStyle} value={form.phone} onChange={(e) => update('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelClass} style={{ color: colors.textSecondary }}>Numero WhatsApp</label>
              <input className={inputClass} style={inputStyle} value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Email</label>
            <input className={inputClass} style={inputStyle} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Immagini */}
      <div className={sectionCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-4 text-sm font-bold" style={{ color: colors.text }}>Logo e Immagine di Copertina</div>
        <div className="flex flex-col gap-4">
          {([
            { key: 'logoUrl' as const, label: 'Logo' },
            { key: 'heroImageUrl' as const, label: 'Immagine di Copertina' },
          ]).map(({ key, label }) => (
            <div key={key}>
              <label className={labelClass} style={{ color: colors.textSecondary }}>{label}</label>
              {form[key] && (
                <img src={form[key]} alt={label} className="mb-2 h-16 max-w-[220px] rounded-lg border object-contain" style={{ borderColor: colors.border }} />
              )}
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  placeholder="https://..."
                />
                <label
                  className="shrink-0 cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium"
                  style={{ borderColor: colors.border, color: colors.text }}
                >
                  Sfoglia...
                  <input type="file" accept="image/*" onChange={handleImageFile(key)} className="hidden" />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Orari di apertura */}
      <div className={sectionCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold" style={{ color: colors.text }}>Orari di Apertura</div>
          <button
            type="button"
            onClick={addHour}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={{ background: colors.primary + '20', color: colors.primary }}
          >
            <Plus size={13} /> Aggiungi
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {form.openingHours.length === 0 ? (
            <p className="text-xs" style={{ color: colors.textSecondary }}>Nessun orario configurato.</p>
          ) : (
            form.openingHours.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={h.day}
                  onChange={(e) => updateHour(i, 'day', e.target.value)}
                  placeholder="Giorni (es. Lun-Ven)"
                />
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={h.hours}
                  onChange={(e) => updateHour(i, 'hours', e.target.value)}
                  placeholder="Orario (es. 09:00-19:00)"
                />
                <button
                  type="button"
                  onClick={() => removeHour(i)}
                  className="shrink-0 rounded-lg p-2"
                  style={{ color: colors.danger }}
                  aria-label="Rimuovi orario"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-medium" style={{ background: colors.danger + '20', color: colors.danger }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(form)}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: colors.primary }}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {saving ? 'Salvataggio...' : 'Salva Modifiche'}
        </button>
        {saved && (
          <span className="text-xs font-medium" style={{ color: colors.success }}>Salvato con successo</span>
        )}
      </div>
    </div>
  );
}
