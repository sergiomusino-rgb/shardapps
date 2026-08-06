'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DynamicDataTable from './DynamicDataTable';
import DynamicRecordModal from './DynamicRecordModal';
import CreateCustomTableModal from './CreateCustomTableModal';
import EditTableModal from './EditTableModal';
import CustomTableRenderer, { type CustomTableDef, type CustomRecord, type ColumnDef } from './CustomTableRenderer';
import CustomRecordModal from './CustomRecordModal';
import {
  LayoutDashboard, Plus, LogOut,
  Clock, XCircle,
  Download, Upload, Database, CreditCard,
} from 'lucide-react';
  import { QRCodeCanvas } from 'qrcode.react';
  import { useLanguage } from '@/src/lib/LanguageContext';
  import { applyDesignTokens, getDesignTokens, getLayoutTypeForSector, cssVar, type DesignTokens } from '@/lib/designTokens';
  import DynamicLayoutRenderer from './DynamicLayoutRenderer';
  import { resolveIcon } from './iconResolver';
  import { StatusBadge } from './cellRenderers';
  import { getAuthToken } from './session-helpers';
  import { supabaseBrowser } from '@/src/lib/supabase-browser';
  import { useAppInfo, type SubscriptionStatus } from '../AppInfoContext';
  import { useRouter, usePathname } from 'next/navigation';
  import { usePwaSetup } from '@/hooks/usePwaSetup';
  import InstallAppBanner from '@/components/InstallAppBanner';
  import { getDatiAziendaliTable, ensureImageField, stripReservedIdField } from './table-definitions';
  import { generateMockRecord } from './mockDataGenerator';
  import AppTopBar from './AppTopBar';
  import ViewerSidebar from './ViewerSidebar';
  import { tenantThemeVars } from './tenant-theme';
  import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { cn } from '@/lib/utils';
  import { Dialog, DialogHeader } from '@/components/ui/dialog';
  import AgendaCalendar from './AgendaCalendar';

// ─── Interfaces ───────────────────────────────────────────────────────────────

// Re-export types from table-definitions for local use
import type { FieldDef as TableFieldDef, TableDef as TableDefType } from './table-definitions';
type FieldDef = TableFieldDef;
type TableDef = TableDefType;

// Motore Sito/PWA (Creator v2): adminPanel.entities usa lo stesso Field di
// blueprint-schema.ts (site-schema.ts lo riusa direttamente), businessConfig
// è il suo equivalente di branding/dati azienda.
import type { AdminEntity, BusinessConfig } from '@/src/lib/site-schema';
import BusinessConfigForm from './BusinessConfigSettings';
import GestionaleChatAssistant from './GestionaleChatAssistant';
import PaymentSettings from './PaymentSettings';
import { getPaymentSettings, type PaymentSettings as PaymentSettingsType } from '@/src/lib/payment-settings';

// Helper per ottenere il nome del campo (supporta sia name che id)
function fieldName(f: FieldDef): string {
  return f.name || f.id || '';
}

// blueprint-schema.ts normalizza il type dei campi in modo libero (stringa),
// mentre FieldDef di questo motore (table-definitions.ts) usa un'unione
// chiusa: rimappa qui i valori non coincidenti invece di un cast non sicuro.
const V2_TO_V1_FIELD_TYPE: Record<string, FieldDef['type']> = {
  text: 'text', number: 'number', email: 'email', tel: 'tel', phone: 'tel',
  date: 'date', datetime: 'datetime', select: 'select', multiselect: 'multiselect',
  textarea: 'textarea', checkbox: 'checkbox', boolean: 'checkbox', currency: 'currency',
  image: 'image', file: 'file', relation: 'relation',
};

// Un array vuoto è truthy in JS: usato con `||` per scegliere il primo
// fallback "buono" tra le varie forme storiche di config, un `[]` intercetta
// la catena prima di arrivare a quello giusto (successo per le app v1, ma per
// le app Creator v2 il backend valorizza SEMPRE blueprint.schema.tables come
// `[]`, vedi backend/routes/client-app.js POST /a/:slug — quello stesso `[]`
// altrimenti blocca la catena prima di raggiungere adminPanel.entities).
function nonEmpty<T>(arr: T[] | undefined | null): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined;
}

function adaptedEntitiesOrUndefined(entities: AdminEntity[] | undefined | null): TableDef[] | undefined {
  const list = nonEmpty(entities);
  return list ? adaptAdminEntitiesToTables(list) : undefined;
}

// Adatta le entità generate dal motore Sito/PWA (config.adminPanel.entities)
// allo stesso TableDef che questo pannello (v1) già sa renderizzare: stessa
// identica API di lettura/scrittura record (/api/client/apps/:id/records,
// keyed su table_name), quindi nessuna modifica al resto del motore serve
// oltre a fornirgli tabelle nel formato che si aspetta.
function adaptAdminEntitiesToTables(entities: AdminEntity[]): TableDef[] {
  return entities.map((e) => ({
    name: e.name,
    label: e.label,
    labelPlural: e.labelPlural,
    icon: e.icon || '',
    fields: e.fields
      .filter((f) => f.type !== 'id')
      .map((f): FieldDef => ({
        name: f.id,
        id: f.id,
        label: f.label,
        type: V2_TO_V1_FIELD_TYPE[f.type] || 'text',
        options: f.options?.length ? f.options : undefined,
        required: f.required,
      })),
  }));
}

interface AppConfig {
  id: string;
  slug: string;
  appName?: string;
  name?: string;
  logo?: string;
  blocked?: boolean;
  // La struttura reale: { id, slug, name, config: { schema: { tables }, ... } }
  config?: {
    schema?: {
      tables: TableDef[];
    };
    blueprint?: {
      schema?: {
        tables: TableDef[];
      };
      tables?: TableDef[];
      sector?: string;
      // Sessione legacy (password in chiaro, vedi backend/routes/client-app.js
      // POST /a/:slug): il backend spalma l'intero apps.config qui dentro
      // (...appConfig), quindi per le app Creator v2 autenticate così è
      // QUESTO il percorso reale di adminPanel.entities/businessConfig, non
      // il livello superiore.
      adminPanel?: { entities: AdminEntity[] };
      businessConfig?: BusinessConfig;
    };
    tables?: TableDef[];
    // Motore Sito/PWA (Creator v2, site-schema.ts): niente config.schema.tables,
    // le tabelle "di lavoro" vivono qui e i dati aziendali in businessConfig
    // invece che in branding.
    adminPanel?: { entities: AdminEntity[] };
    businessConfig?: BusinessConfig;
    branding?: {
      company_name?: string;
      logo_url?: string;
      primary_color?: string;
      theme?: 'dark' | 'light';
    };
    appName?: string;
    logo?: string;
    [key: string]: unknown;
  };
  // Fallback per strutture piatte
  schema?: { tables: TableDef[] };
  branding?: {
    company_name?: string;
    logo_url?: string;
    primary_color?: string;
    theme?: 'dark' | 'light';
  };
  blueprint?: {
    schema?: { tables: TableDef[] };
    tables?: TableDef[];
    sector?: string;
    adminPanel?: { entities: AdminEntity[] };
    businessConfig?: BusinessConfig;
  };
  tables?: TableDef[];
  adminPanel?: { entities: AdminEntity[] };
  businessConfig?: BusinessConfig;
  [key: string]: unknown;
}

interface AppSession {
  slug: string;
  // Legacy: password condivisa in chiaro. Supabase: stringa vuota, non usata
  // (l'autenticazione vera passa da accessToken, vedi getAuthToken).
  password: string;
  appInfo: AppConfig;
  // Assente/'legacy' per le app esistenti (comportamento invariato).
  // 'supabase' per le nuove app: la sessione arriva da dashboard/page.tsx
  // con un vero access token Supabase Auth.
  mode?: 'legacy' | 'supabase';
  accessToken?: string;
}

interface AppRecord {
  id: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UserPrefs {
  layout: 'corporate' | 'modern' | 'compact';
  theme: 'dark' | 'light';
  primaryColor: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYOUT_CONFIG = {
  corporate:  { sidebarWidth: 'w-72', padding: 'p-8', radius: 'rounded-2xl', shadow: 'shadow-2xl' },
  modern:     { sidebarWidth: 'w-64', padding: 'p-6', radius: 'rounded-xl',  shadow: 'shadow-xl' },
  compact:    { sidebarWidth: 'w-56', padding: 'p-4', radius: 'rounded-lg',  shadow: 'shadow-lg' },
};

// ─── Theme Helpers ────────────────────────────────────────────────────────────

/** Forma della palette passata come prop `colors` a DynamicDataTable, DynamicRecordModal, ecc. */
interface ThemeVars {
  bg: string;
  text: string;
  textSecondary: string;
  cardBg: string;
  cardBgAlt: string;
  border: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarHover: string;
  inputBg: string;
  inputBorder: string;
  primary: string;
  primaryHover: string;
  danger: string;
  success: string;
  warning: string;
}

// Adatta i design token di settore (design.md, da lib/designTokens.ts) alla
// stessa forma di ThemeVars, così tutti i componenti che già ricevono
// `colors` come prop (DynamicDataTable, DynamicRecordModal, CustomTableRenderer,
// CreateCustomTableModal, EditTableModal, CustomRecordModal,
// SettingsModal, ecc.) ottengono la palette del settore senza alcuna modifica
// al loro codice interno — cambia solo come `colors` viene calcolato qui sotto.
// Schiarisce (percent > 0) o scurisce (percent < 0) un colore esadecimale,
// mescolandolo verso il bianco o il nero. Usata per derivare la sidebar dal
// colore primario scelto in Impostazioni (vedi designTokensToThemeVars).
function shadeHex(hex: string, percent: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return hex;
  const target = percent < 0 ? 0 : 255;
  const p = Math.min(Math.abs(percent), 1);
  const channel = (shift: number) => {
    const v = (num >> shift) & 255;
    return Math.round((target - v) * p) + v;
  };
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`;
}

// Contenuto principale generico per il tema scuro/chiaro forzato dall'utente,
// quando disaccorda con la luminosità nativa della palette di settore (es.
// sceglie "Scuro" su un settore progettato chiaro come cliniclife). Stessi
// valori già usati altrove in questo motore (DynamicRecordModal, ecc.) per
// coerenza visiva tra i due percorsi.
const FORCED_THEME_BASE = {
  dark: { bg: '#0a0e1a', cardBg: '#161f32', cardBgAlt: '#1c273d', text: '#f1f5f9', textSecondary: '#94a3b8', border: '#2c3a52', inputBg: '#111a2c', inputBorder: '#2c3a52' },
  light: { bg: '#f8fafc', cardBg: '#ffffff', cardBgAlt: '#f1f5f9', text: '#0f172a', textSecondary: '#64748b', border: '#e2e8f0', inputBg: '#f8fafc', inputBorder: '#e2e8f0' },
} as const;

function designTokensToThemeVars(tokens: DesignTokens, primaryColorOverride?: string, themeOverride?: 'dark' | 'light') {
  const c = tokens.colors;
  const primary = primaryColorOverride || c.primary;
  // Col colore primario di default del settore, la sidebar resta sulla
  // palette dedicata (design.md). Appena l'utente sceglie un colore
  // personalizzato in Impostazioni, la sidebar si ritinge di conseguenza:
  // è il "brand" dell'app, deve seguire il colore scelto, non restare fissa.
  const sidebar = primaryColorOverride
    ? {
        bg: shadeHex(primaryColorOverride, -0.55),
        text: '#f8fafc',
        hover: shadeHex(primaryColorOverride, -0.4),
      }
    : { bg: c['sidebar-bg'], text: c['sidebar-text'], hover: c['sidebar-hover'] };

  // Il contenuto principale (sfondo/card/testo) segue invece la scelta
  // Scuro/Chiaro dell'utente: se coincide con la luminosità nativa del
  // settore, usiamo la palette design.md (più curata); solo quando l'utente
  // la ribalta esplicitamente passiamo a una base scura/chiara generica,
  // mantenendo comunque il colore primario/sidebar del brand.
  const sectorIsDark = isColorDark(c.bg);
  const forceDark = themeOverride === 'dark' && !sectorIsDark;
  const forceLight = themeOverride === 'light' && sectorIsDark;
  const base = forceDark
    ? FORCED_THEME_BASE.dark
    : forceLight
      ? FORCED_THEME_BASE.light
      : { bg: c.bg, cardBg: c['card-bg'], cardBgAlt: c['card-bg-alt'], text: c.text, textSecondary: c['text-secondary'], border: c.border, inputBg: c['input-bg'], inputBorder: c.border };

  return {
    bg: base.bg,
    text: base.text,
    textSecondary: base.textSecondary,
    cardBg: base.cardBg,
    cardBgAlt: base.cardBgAlt,
    border: base.border,
    sidebarBg: sidebar.bg,
    sidebarText: sidebar.text,
    sidebarHover: sidebar.hover,
    inputBg: base.inputBg,
    inputBorder: base.inputBorder,
    primary,
    primaryHover: primaryColorOverride ? primaryColorOverride + 'dd' : c['primary-hover'],
    danger: c.error,
    success: c.success,
    warning: c.warning,
  };
}

// Luminosità percepita di un colore esadecimale (formula standard), per
// dedurre se la palette di un settore è "scura di proposito" (es. coinpulse,
// glassmorphism, industrial-dark) e va trattata come tema scuro di default.
function isColorDark(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length < 6) return false;
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  if ([r, g, b].some((n) => isNaN(n))) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
}

function KpiCard({ title, value, icon }: KpiCardProps) {
  return (
    <Card className="relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(16,24,40,0.1)]">
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-tenant-primary opacity-10 blur-2xl" />
      <CardContent className="relative flex flex-col gap-3 p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-tenant-text-secondary">{title}</span>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-tenant-primary/12 text-tenant-primary">
            {icon}
          </div>
        </div>
        <span className="text-[28px] font-bold leading-none text-tenant-text">{value}</span>
      </CardContent>
    </Card>
  );
}

// ─── Dashboard Component ──────────────────────────────────────────────────────

interface RecentActivityItem {
  tableName: string;
  tableLabel: string;
  icon: React.ReactNode;
  recordLabel: string;
  timestamp: string | null;
  statusValue: string | null;
}

interface AgendaItem {
  tableName: string;
  tableLabel: string;
  icon: React.ReactNode;
  recordLabel: string;
  date: string;
  timeLabel: string | null;
  statusValue: string | null;
}

/** Forma grezza di un record come lo restituisce l'API records (prima di essere appiattito). */
interface RawActivityRecord {
  id: string;
  created_at?: string;
  updated_at?: string;
  data?: Record<string, unknown>;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'adesso';
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} ${diffH === 1 ? 'ora' : 'ore'} fa`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD} ${diffD === 1 ? 'giorno' : 'giorni'} fa`;
  return date.toLocaleDateString('it-IT');
}

interface DashboardProps {
  companyName: string;
  tables: TableDef[];
  appId?: string;
  authToken?: string;
  onQuickAdd: (tableName: string) => void;
}

function Dashboard({ companyName, tables, appId, authToken, onQuickAdd }: DashboardProps) {
  const { t } = useLanguage();
  const [totalRecords, setTotalRecords] = useState(0);
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Conta i record per tabella e costruisce il feed attività recenti
    // riusando gli stessi dati già scaricati (nessuna chiamata aggiuntiva).
    async function loadDashboardData() {
      try {
        const password = authToken;
        if (!appId || !password) { setLoading(false); return; }

        let total = 0;
        const counts: Record<string, number> = {};
        const activity: RecentActivityItem[] = [];
        const agenda: AgendaItem[] = [];

        for (const table of tables) {
          try {
            const res = await fetch(`/api/client/apps/${appId}/records?table=${table.name}`, {
              headers: { Authorization: `Bearer ${password}` },
            });
            if (res.ok) {
              const data = await res.json();
              const recs: RawActivityRecord[] = Array.isArray(data) ? data : data.records || data.data || [];
              counts[table.name] = recs.length;
              total += recs.length;

              const textField = table.fields.find((f) => ['text', 'email', 'tel'].includes(f.type) && fieldName(f) !== 'id');
              const statusField = table.fields.find((f) => f.type === 'select');
              // Tabella "agenda" = ha un campo data/datetime (appuntamenti,
              // prenotazioni, ordini con scadenza, ecc.) — generico per
              // qualsiasi settore, non solo per chi genera un'app medica.
              const dateField = table.fields.find((f) => (f.type === 'date' || f.type === 'datetime') && fieldName(f) !== 'id');
              const timeField = table.fields.find((f) => f.type === 'text' && /^(ora|orario|time|ora_inizio)$/i.test(fieldName(f)));

              for (const r of recs) {
                const ts = (r.updated_at || r.created_at) as string | undefined;
                const label = textField ? String(r.data?.[fieldName(textField)] ?? '').trim() : '';
                activity.push({
                  tableName: table.name,
                  tableLabel: table.labelPlural || table.label,
                  icon: resolveIcon(table.icon || '', table.name),
                  recordLabel: label || `#${String(r.id).slice(0, 6)}`,
                  timestamp: ts || null,
                  statusValue: statusField ? (r.data?.[fieldName(statusField)] ? String(r.data[fieldName(statusField)]) : null) : null,
                });

                const dateValueRaw = dateField ? r.data?.[fieldName(dateField)] : null;
                const dateValue = dateValueRaw != null ? String(dateValueRaw) : null;
                if (dateValue && !isNaN(new Date(dateValue).getTime())) {
                  agenda.push({
                    tableName: table.name,
                    tableLabel: table.labelPlural || table.label,
                    icon: resolveIcon(table.icon || '', table.name),
                    recordLabel: label || `#${String(r.id).slice(0, 6)}`,
                    date: String(dateValue),
                    timeLabel: timeField ? String(r.data?.[fieldName(timeField)] ?? '').trim() || null : null,
                    statusValue: statusField ? (r.data?.[fieldName(statusField)] ? String(r.data[fieldName(statusField)]) : null) : null,
                  });
                }
              }
            }
          } catch { /* skip table */ }
        }

        activity.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        setRecentActivity(activity.slice(0, 6));

        // Tutti gli item con data (passati e futuri): il casellario calendario
        // naviga i mesi da sé, quindi non filtriamo/tronchiamo qui.
        setAgendaItems(agenda);

        setTableCounts(counts);
        setTotalRecords(total);
      } catch { /* ignore */ }
      setLoading(false);
    }
    loadDashboardData();
  }, [tables, appId, authToken]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="m-0 text-[28px] font-bold text-tenant-text">{t('nav_dashboard')}</h1>
          <p className="mt-1 text-sm text-tenant-text-secondary">{t('dashboard_overview')} {companyName}</p>
        </div>
        <div className="py-16 text-center text-tenant-text-secondary">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[28px] font-bold text-tenant-text">{t('nav_dashboard')}</h1>
        <p className="mt-1 text-sm text-tenant-text-secondary">{t('dashboard_overview')} {companyName}</p>
      </div>

      {tables.length === 0 ? (
        <Card className="px-10 py-16 text-center">
          <LayoutDashboard size={48} className="mx-auto mb-4 text-tenant-primary" />
          <h2 className="m-0 mb-3 text-[22px] font-bold text-tenant-text">Benvenuto in {companyName}!</h2>
          <p className="mx-auto max-w-[500px] text-sm leading-relaxed text-tenant-text-secondary">
            La tua app è pronta per essere utilizzata. Crea tabelle e record per iniziare a gestire i tuoi dati.
          </p>
        </Card>
      ) : (
        <>
          {/* KPI reali (nessun dato finto) */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
            <KpiCard title="Tabelle" value={String(tables.length)} icon={<LayoutDashboard size={20} />} />
            <KpiCard title="Record Totali" value={String(totalRecords)} icon={<Database size={20} />} />
            <KpiCard
              title="Ultima Attività"
              value={recentActivity[0] ? formatRelativeTime(recentActivity[0].timestamp) || '—' : '—'}
              icon={<Clock size={20} />}
            />
          </div>

          {/* Azioni rapide */}
          <Card>
            <CardHeader>
              <CardTitle>Azioni Rapide</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2.5 pt-0">
              {tables.slice(0, 4).map((table) => (
                <Button key={table.name} variant="soft" onClick={() => onQuickAdd(table.name)}>
                  <Plus size={14} /> Nuovo {table.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-5">
            {/* Tables overview con breakdown record per tabella */}
            <Card>
              <CardHeader>
                <CardTitle>Le tue Tabelle</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0">
                {tables.map((table) => (
                  <div
                    key={table.name}
                    className="flex items-center justify-between rounded-xl border border-tenant-primary/15 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tenant-primary/10 text-tenant-primary">
                        {resolveIcon(table.icon || '', table.name)}
                      </div>
                      <span className="text-sm font-medium text-tenant-text">{table.labelPlural || table.label}</span>
                    </div>
                    <span className="text-[13px] text-tenant-text-secondary">{tableCounts[table.name] ?? 0} record</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Feed attività recenti */}
            <Card>
              <CardHeader>
                <CardTitle>Attività Recente</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {recentActivity.length === 0 ? (
                  <p className="text-[13px] text-tenant-text-secondary">Nessuna attività ancora registrata.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {recentActivity.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-xl bg-tenant-card-alt px-3 py-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-tenant-primary/10 text-tenant-primary">
                          {item.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-tenant-text">{item.recordLabel}</div>
                          <div className="text-xs text-tenant-text-secondary">
                            {item.tableLabel} · {formatRelativeTime(item.timestamp) || 'data sconosciuta'}
                          </div>
                        </div>
                        {item.statusValue && <StatusBadge value={item.statusValue} />}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agenda: casellario calendario mensile con i record che hanno una
              data (appuntamenti/prenotazioni/scadenze), da qualsiasi tabella
              — non solo per i gestionali medici. */}
          <Card>
            <CardHeader>
              <CardTitle>Agenda</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <AgendaCalendar items={agendaItems} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── ColorPicker Component ────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Draw hue gradient
    for (let x = 0; x < width; x++) {
      const hue = (x / width) * 360;
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      ctx.fillRect(x, 0, 1, height);
    }
  }, []);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newHue = Math.round((x / rect.width) * 360);
    const newSaturation = Math.round(100 - (y / rect.height) * 100);

    setHue(newHue);
    setSaturation(newSaturation);
    updateColor(newHue, newSaturation, lightness);
  };

  const handleCanvasMouseDown = () => {
    setIsDragging(true);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    handleCanvasClick(e);
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  const updateColor = (h: number, s: number, l: number) => {
    const hex = hslToHex(h, s, l);
    onChange(hex);
  };

  const hslToHex = (h: number, s: number, l: number): string => {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const canvasWidth = 280;
  const canvasHeight = 60;
  const cursorX = (hue / 360) * canvasWidth;
  const cursorY = ((100 - saturation) / 100) * canvasHeight;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-12 w-12 rounded-lg border-2 border-white/20" style={{ background: value }} />
        <div className="flex-1">
          <div className="mb-1 text-sm font-semibold text-tenant-text">Colore Attuale</div>
          <div className="font-mono text-xs text-tenant-text-secondary">{value.toUpperCase()}</div>
        </div>
      </div>

      <div className="relative mb-3">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          className="h-[60px] w-full cursor-crosshair rounded-lg border-2 border-tenant-border"
        />
        <div
          className="pointer-events-none absolute h-5 w-5 rounded-full border-2 border-black bg-white shadow-md"
          style={{ left: `${cursorX - 10}px`, top: `${cursorY - 10}px` }}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-tenant-text-secondary">
          Luminosità: {lightness}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={lightness}
          onChange={(e) => {
            const newLightness = Number(e.target.value);
            setLightness(newLightness);
            updateColor(hue, saturation, newLightness);
          }}
          className="w-full accent-tenant-primary"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              onChange(preset);
              const h = hexToHsl(preset).h;
              const s = hexToHsl(preset).s;
              const l = hexToHsl(preset).l;
              setHue(h);
              setSaturation(s);
              setLightness(l);
            }}
            className={cn(
              'h-8 w-8 rounded-md border-2',
              value === preset ? 'border-white' : 'border-transparent'
            )}
            style={{ background: preset, boxShadow: value === preset ? `0 0 0 2px ${preset}` : 'none' }}
          />
        ))}
      </div>
    </div>
  );
}

function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#ef4444', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#64748b', '#1e293b', '#ffffff',
];

// ─── SettingsModal Component ──────────────────────────────────────────────────

interface SettingsModalProps {
  prefs: UserPrefs;
  onPrefsChange: (prefs: UserPrefs) => void;
  onClose: () => void;
  onLogout: () => void;
  onChangePassword: (oldPw: string, newPw: string) => Promise<void>;
  colors: ThemeVars;
  slug: string;
  authMode?: 'legacy' | 'supabase';
  subscriptionStatus?: SubscriptionStatus | null;
  trialEndsAt?: string | null;
  subscriptionPrice: number;
  onResetSchema: () => void;
  resettingSchema: boolean;
  customTableCount: number;
  // Motore Sito/PWA (Creator v2): presente solo per le app che hanno un
  // config.businessConfig — le app del vecchio motore tabellare non mostrano
  // questa sezione.
  businessConfig?: BusinessConfig | null;
  onSaveBusinessConfig?: (next: BusinessConfig) => void;
  savingBusinessConfig?: boolean;
  businessConfigError?: string | null;
  businessConfigSaved?: boolean;
  // Modulo pagamenti opzionale Plug & Play: appId + token bastano, il
  // componente gestisce da sé fetch/salvataggio (vedi PaymentSettings.tsx).
  appId: string;
  authToken: string;
  paymentSettings: PaymentSettingsType;
}

function SettingsModal({
  prefs, onPrefsChange, onClose, onLogout, onChangePassword, colors, slug, authMode,
  subscriptionStatus, trialEndsAt, subscriptionPrice, onResetSchema, resettingSchema, customTableCount,
  businessConfig, onSaveBusinessConfig, savingBusinessConfig, businessConfigError, businessConfigSaved,
  appId, authToken, paymentSettings,
}: SettingsModalProps) {
  const isSupabaseAuth = authMode === 'supabase';
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [changingPw, setChangingPw] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionMsg, setSubscriptionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const updatePref = <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
    onPrefsChange({ ...prefs, [key]: value });
  };

  const handleSubscribe = async () => {
    setSubscriptionLoading(true);
    setSubscriptionMsg(null);
    try {
      const res = await fetch(`/api/a/${slug}/create-checkout-session`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setSubscriptionMsg({ text: data.error || 'Errore durante la creazione del checkout', type: 'error' });
      }
    } catch {
      setSubscriptionMsg({ text: 'Errore di connessione', type: 'error' });
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Sei sicuro di voler disdire l\'abbonamento? L\'app continuerà a funzionare fino al prossimo rinnovo.')) return;
    setSubscriptionLoading(true);
    setSubscriptionMsg(null);
    try {
      const res = await fetch(`/api/a/${slug}/cancel-subscription`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSubscriptionMsg({ text: 'Abbonamento disdetto: resterà attivo fino a fine periodo.', type: 'success' });
      } else {
        setSubscriptionMsg({ text: data.error || 'Errore durante la disdetta', type: 'error' });
      }
    } catch {
      setSubscriptionMsg({ text: 'Errore di connessione', type: 'error' });
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if ((!isSupabaseAuth && !oldPassword) || !newPassword || !confirmPassword) {
      setPasswordMsg({ text: 'Compila tutti i campi', type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: 'Le password non coincidono', type: 'error' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ text: 'La nuova password deve avere almeno 6 caratteri', type: 'error' });
      return;
    }

    setChangingPw(true);
    try {
      await onChangePassword(oldPassword, newPassword);
      setPasswordMsg({ text: 'Password cambiata con successo!', type: 'success' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMsg({ text: err instanceof Error ? err.message : 'Errore nel cambio password', type: 'error' });
    } finally {
      setChangingPw(false);
    }
  };

  const sectionCard = 'mb-5 rounded-xl border border-tenant-border bg-tenant-card-alt p-5';
  const sectionTitle = 'mb-3 text-[15px] font-bold uppercase tracking-wide text-tenant-text';

  return (
    <Dialog open onClose={onClose} maxWidthClassName="max-w-[640px]">
      <DialogHeader title="Impostazioni" onClose={onClose} />

      {/* Theme Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>Tema</div>
        <div className="grid grid-cols-2 gap-3">
          {(['dark', 'light'] as const).map((t) => {
            const isActive = prefs.theme === t;
            return (
              <button
                key={t}
                onClick={() => updatePref('theme', t)}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border-2 p-3.5 transition-all',
                  isActive ? 'border-tenant-primary bg-tenant-primary/15' : 'border-tenant-border bg-transparent'
                )}
              >
                <div className={cn('h-8 w-8 rounded-lg border', t === 'dark' ? 'bg-[#0a0e1a] border-[#334155]' : 'bg-[#f8fafc] border-[#e2e8f0]')} />
                <span className="text-sm font-semibold text-tenant-text">{t === 'dark' ? 'Scuro' : 'Chiaro'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Color Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>Colore Primario</div>
        <ColorPicker
          value={prefs.primaryColor}
          onChange={(color) => updatePref('primaryColor', color)}
        />
      </div>

      {/* Dati Attività (motore Sito/PWA Creator v2): visualizza/modifica
          config.businessConfig, sincronizzato col sito pubblico. Assente
          per le app del vecchio motore tabellare. */}
      {businessConfig && onSaveBusinessConfig && (
        <div className={sectionCard}>
          <div className={sectionTitle}>Dati Attività (Sito Pubblico)</div>
          <BusinessConfigForm
            value={businessConfig}
            colors={colors}
            saving={!!savingBusinessConfig}
            error={businessConfigError ?? null}
            saved={!!businessConfigSaved}
            onSave={onSaveBusinessConfig}
          />
        </div>
      )}

      {/* Pagamenti Online (modulo opzionale Plug & Play): ShardApps non vede né
          gestisce le transazioni, solo il Payment Link del tenant. */}
      <div className={sectionCard}>
        <PaymentSettings appId={appId} authToken={authToken} initial={paymentSettings} />
      </div>

      {/* Password Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>Cambia Password</div>
        <form onSubmit={handlePasswordChange} className="flex flex-col gap-3">
          {!isSupabaseAuth && (
            <Input
              type="password"
              placeholder="Password attuale"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          )}
          <Input
            type="password"
            placeholder="Nuova password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <Input
            type="password"
            placeholder="Conferma nuova password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          {passwordMsg && (
            <div className={cn(
              'rounded-lg px-3.5 py-2.5 text-[13px] font-medium',
              passwordMsg.type === 'success' ? 'bg-tenant-success/15 text-tenant-success' : 'bg-tenant-danger/15 text-tenant-danger'
            )}>
              {passwordMsg.text}
            </div>
          )}
          <Button type="submit" disabled={changingPw} className="self-end">
            {changingPw ? 'Salvataggio...' : 'Cambia Password'}
          </Button>
        </form>
      </div>

      {/* Subscription Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>Abbonamento</div>
        {subscriptionStatus === 'trial' && trialEndsAt && (
          <p className="mb-3 text-[13px] text-tenant-text-secondary">
            Periodo di prova attivo fino al {new Date(trialEndsAt).toLocaleDateString('it-IT')}
          </p>
        )}
        {(subscriptionStatus === 'trial' || subscriptionStatus === 'expired' || subscriptionStatus === 'past_due' || subscriptionStatus === 'canceled') ? (
          <Button type="button" onClick={handleSubscribe} disabled={subscriptionLoading} className="w-full">
            <CreditCard size={16} />
            {subscriptionLoading ? 'Attendere...' : `${subscriptionStatus === 'expired' ? 'Rinnova Abbonamento' : 'Abbonati'} - ${subscriptionPrice}€/mese`}
          </Button>
        ) : (
          <Button type="button" variant="destructive" onClick={handleCancelSubscription} disabled={subscriptionLoading} className="w-full">
            <XCircle size={16} />
            {subscriptionLoading ? 'Attendere...' : 'Disdici Abbonamento'}
          </Button>
        )}
        {subscriptionMsg && (
          <div className={cn(
            'mt-3 rounded-lg px-3.5 py-2.5 text-[13px] font-medium',
            subscriptionMsg.type === 'success' ? 'bg-tenant-success/15 text-tenant-success' : 'bg-tenant-danger/15 text-tenant-danger'
          )}>
            {subscriptionMsg.text}
          </div>
        )}
      </div>

      {/* Reset Schema Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>Tabelle Personalizzate</div>
        <p className="mb-4 text-[13px] text-tenant-text-secondary">
          {customTableCount > 0
            ? `Hai ${customTableCount} tabelle personalizzate create con l'AI o manualmente. Se qualcosa non funziona come previsto, puoi riportare l'app allo stato iniziale: verranno rimosse solo le tabelle personalizzate e i loro dati, le tabelle originali del gestionale (${'clienti, prodotti, ordini...'}) restano intatte.`
            : 'Non hai ancora creato tabelle personalizzate.'}
        </p>
        <Button
          type="button"
          variant="destructive"
          onClick={onResetSchema}
          disabled={resettingSchema || customTableCount === 0}
          className="w-full"
        >
          <XCircle size={16} />
          {resettingSchema ? 'Ripristino...' : 'Ripristina stato iniziale'}
        </Button>
      </div>

      {/* QR Code Section */}
      <div className={sectionCard}>
        <div className={sectionTitle}>QR Code Accesso</div>
        <p className="mb-4 text-[13px] text-tenant-text-secondary">
          Scansiona questo codice QR per accedere all&apos;app da qualsiasi dispositivo
        </p>
        <div className="mb-3 flex justify-center rounded-xl bg-white p-4">
          <QRCodeCanvas
            value={`${typeof window !== 'undefined' ? window.location.origin : ''}/a/${slug}`}
            size={160}
            level="M"
            includeMargin={false}
          />
        </div>
        <div className="rounded-lg border border-tenant-border p-3 text-center">
          <a
            href={`/a/${slug}`}
            className="break-all text-sm font-semibold text-tenant-primary no-underline"
          >
            {typeof window !== 'undefined' ? window.location.origin : ''}/a/{slug}
          </a>
        </div>
      </div>

      {/* Logout */}
      <Button type="button" variant="destructive" onClick={onLogout} className="w-full py-3.5 text-[15px]">
        <LogOut size={18} /> Logout
      </Button>
    </Dialog>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

interface LoginScreenProps {
  slug: string;
  appName: string;
  logoUrl: string;
  primaryColor: string;
  onLogin: (password: string) => Promise<void>;
}

function LoginScreen({ appName, logoUrl, primaryColor, onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password.trim()) {
      setError('Inserisci la password');
      return;
    }
    setLoading(true);
    try {
      await onLogin(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password errata');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#0a0e1a] p-5"
      style={{ '--tenant-primary': primaryColor } as React.CSSProperties}
    >
      <Card className="w-full max-w-[400px] border-white/10 bg-white/[0.04] p-10 text-center shadow-2xl">
        {logoUrl && (
          <img src={logoUrl} alt={appName} className="mx-auto mb-4 h-12 object-contain" />
        )}
        <h1 className="mb-2 text-2xl font-bold text-white">{appName}</h1>
        <p className="mb-7 text-sm text-slate-400">Inserisci la password per accedere</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            className="border-white/10 bg-[#0f172a] text-white placeholder:text-slate-500"
          />
          {error && (
            <div className="rounded-lg bg-tenant-danger/15 px-3.5 py-2.5 text-[13px] text-tenant-danger">
              {error}
            </div>
          )}
          <Button type="submit" disabled={loading} size="lg">
            {loading ? 'Verifica...' : 'Accedi'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ─── Main App Component ───────────────────────────────────────────────────────

// Esportato anche come named export: riusato tale e quale da
// /a/[slug]/gestionale/page.tsx, che serve la stessa Area Riservata su
// un'altra URL invece di duplicarne il motore.
export function ViewerProFinal() {
  const slug = useMemo(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/\/a\/([^/]+)/);
      return match?.[1] || '';
    }
    return '';
  }, []);

  // Questo componente è condiviso da /a/[slug]/app (legacy) e
  // /a/[slug]/dashboard (nuove app, vedi dashboard/page.tsx). Chi arriva su
  // /app con un'app auth_mode='supabase' viene rimandato a /dashboard.
  const appInfoCtx = useAppInfo();
  const { authMode, status: subscriptionStatus, trialEndsAt, clientPrice } = appInfoCtx;
  const router = useRouter();
  const pathname = usePathname() || '';
  // Piattaforma unificata: sia le app del vecchio motore tabellare (blueprint-
  // schema.ts) sia quelle del motore Sito/PWA (Creator v2, site-schema.ts)
  // usano questo stesso pannello come Area Riservata — le seconde vedono le
  // proprie config.adminPanel.entities adattate a TableDef più sotto (vedi
  // adaptAdminEntitiesToTables), niente più redirect a un pannello separato.
  useEffect(() => {
    if (authMode === 'supabase' && pathname === `/a/${slug}/app`) {
      router.replace(`/a/${slug}/dashboard`);
    } else if (authMode === 'legacy' && pathname === `/a/${slug}/dashboard`) {
      router.replace(`/a/${slug}/app`);
    }
  }, [authMode, slug, router, pathname]);

  const sessionKey = `app_session_${slug}`;
  const prefsKey = `${sessionKey}_prefs`;

  // State
  const [session, setSession] = useState<AppSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [activeView, setActiveView] = useState<'dashboard' | string>('dashboard');
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalRecord, setModalRecord] = useState<AppRecord | null | 'new'>(null);
  const [saving, setSaving] = useState(false);
  const [generatingMock, setGeneratingMock] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Motore Sito/PWA (Creator v2): rispecchia l'ultimo salvataggio riuscito di
  // businessConfig senza un refetch completo della sessione (sito pubblico e
  // Area Riservata leggono lo stesso apps.config).
  const [businessConfigOverride, setBusinessConfigOverride] = useState<BusinessConfig | null>(null);
  const [savingBusinessConfig, setSavingBusinessConfig] = useState(false);
  const [businessConfigError, setBusinessConfigError] = useState<string | null>(null);
  const [businessConfigSaved, setBusinessConfigSaved] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Record per relazioni tra tabelle
  const [clientiRecords, setClientiRecords] = useState<AppRecord[]>([]);
  const [prodottiRecords, setProdottiRecords] = useState<AppRecord[]>([]);
  const [ordiniRecords, setOrdiniRecords] = useState<AppRecord[]>([]);
  // Tabelle personalizzate create dall'utente
  const [customTables, setCustomTables] = useState<CustomTableDef[]>([]);
  // Re-login helper to refresh session after table edit
  const refreshSession = useCallback(async () => {
    if (!session) return;
    try {
      if (session.mode === 'supabase') {
        // Nessuna password da rimandare: rilegge la config pubblica via RLS
        // (apps_select_public_active), niente localStorage (sessione non persistita).
        const { data } = await supabaseBrowser
          .from('apps')
          .select('id, slug, name, config')
          .eq('id', session.appInfo.id)
          .single();
        if (data) {
          const fresh = data as unknown as { id: string; slug: string; name: string; config: AppConfig['config'] };
          setSession({ ...session, appInfo: { ...session.appInfo, ...fresh } });
        }
        return;
      }

      const res = await fetch(`/api/a/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: session.password }),
      });
      if (res.ok) {
        const data = await res.json();
        const updatedSession = {
          ...session,
          appInfo: data.appInfo || data,
        };
        localStorage.setItem(sessionKey, JSON.stringify(updatedSession));
        setSession(updatedSession);
      }
    } catch { /* ignore */ }
  }, [session, slug, sessionKey]);
  
  // Solo il setter serve qui: nessuna vista mostra ancora uno stato di
  // caricamento dedicato per le tabelle personalizzate.
  const [, setCustomTablesLoading] = useState(false);
  const [customRecords, setCustomRecords] = useState<CustomRecord[]>([]);
  const [customRecordsLoading, setCustomRecordsLoading] = useState(false);
  const [showCreateCustomTable, setShowCreateCustomTable] = useState(false);
  const [creatingCustomTable, setCreatingCustomTable] = useState(false);
  const [resettingSchema, setResettingSchema] = useState(false);
  const [customModalRecord, setCustomModalRecord] = useState<CustomRecord | null | 'new'>(null);
  const [customSaving, setCustomSaving] = useState(false);
  // Edit table modal
  const [editTable, setEditTable] = useState<TableDef | null>(null);
  const [editTableSaving, setEditTableSaving] = useState(false);

  const [prefs, setPrefs] = useState<UserPrefs>({
    layout: 'modern',
    theme: 'dark',
    primaryColor: '#6366f1',
  });

  // Derived values
  const appInfo = session?.appInfo;
  // L'appInfo ha struttura: { id, slug, name, config: { schema: { tables }, ... } }
  const config = appInfo;
  const innerConfig = config?.config;
  
  // Estrai tabelle da blueprint — cerca in config.config.schema.tables (la struttura reale)
  // e mantieni tutti i fallback per compatibilità. Ultimo fallback: motore
  // Sito/PWA (Creator v2), le cui tabelle "di lavoro" vivono in
  // adminPanel.entities invece che in schema.tables.
  // Memoizzati: senza useMemo, adaptAdminEntitiesToTables() ricrea array/oggetti
  // nuovi ad ogni render (anche a parità di contenuto). Per le app Creator v2
  // (fallback su adminPanel.entities) questo rendeva `activeTable` una reference
  // sempre diversa, che l'effetto di fetch qui sotto vedeva come "cambiata" ad
  // ogni giro, generando un loop di fetch e lo sfarfallio/tremore delle tabelle.
  const tables = useMemo(() => {
    const raw = nonEmpty(innerConfig?.schema?.tables)
      || nonEmpty(config?.schema?.tables)
      || nonEmpty(innerConfig?.blueprint?.schema?.tables)
      || nonEmpty(config?.blueprint?.schema?.tables)
      || nonEmpty(innerConfig?.blueprint?.tables)
      || nonEmpty(config?.blueprint?.tables)
      || nonEmpty(innerConfig?.tables)
      || nonEmpty(config?.tables)
      || adaptedEntitiesOrUndefined(innerConfig?.adminPanel?.entities)
      || adaptedEntitiesOrUndefined(config?.adminPanel?.entities)
      || adaptedEntitiesOrUndefined(innerConfig?.blueprint?.adminPanel?.entities)
      || adaptedEntitiesOrUndefined(config?.blueprint?.adminPanel?.entities)
      || [];
    // Ogni nuovo record deve poter avere una foto propria fin da subito,
    // per qualunque tabella — non solo per quelle a cui l'utente ha
    // aggiunto a mano un campo Immagine da "Modifica Tabella". Rimuove anche
    // un eventuale campo "id" di schema (collide con l'id reale del record,
    // mostrerebbe solo una stringa numerica interna senza senso).
    return raw.map(stripReservedIdField).map(ensureImageField);
  }, [innerConfig, config]);

  const activeTable = useMemo(
    () => tables.find((t) => t.name === activeView) || null,
    [tables, activeView],
  );
  const datiAziendaliTable = useMemo(() => getDatiAziendaliTable(tables), [tables]);

  const companyName = config?.branding?.company_name
    || innerConfig?.businessConfig?.name
    || config?.businessConfig?.name
    || innerConfig?.blueprint?.businessConfig?.name
    || config?.blueprint?.businessConfig?.name
    || config?.appName
    || 'App';

  const logoUrl = config?.branding?.logo_url
    || innerConfig?.businessConfig?.logoUrl
    || config?.businessConfig?.logoUrl
    || innerConfig?.blueprint?.businessConfig?.logoUrl
    || config?.blueprint?.businessConfig?.logoUrl
    || config?.logo
    || '';

  // Motore Sito/PWA (Creator v2): assente per le app del vecchio motore
  // tabellare, quindi la sezione "Dati Attività" in Impostazioni non compare.
  const rawBusinessConfig = innerConfig?.businessConfig
    || config?.businessConfig
    || innerConfig?.blueprint?.businessConfig
    || config?.blueprint?.businessConfig
    || null;
  const effectiveBusinessConfig = businessConfigOverride || rawBusinessConfig;

  // Modulo pagamenti opzionale Plug & Play (apps.config.paymentSettings):
  // nessun fallback su innerConfig/blueprint, è una chiave nuova e piatta,
  // non legata al motore Sito/PWA come businessConfig sopra.
  const paymentSettings = getPaymentSettings(config);

  const handleSaveBusinessConfig = async (next: BusinessConfig) => {
    if (!session) return;
    setSavingBusinessConfig(true);
    setBusinessConfigError(null);
    setBusinessConfigSaved(false);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/business-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken(session)}` },
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

  // Settore salvato nello schema (blueprint.sector per la pipeline Totalum,
  // sector diretto per la pipeline Creator) — guida sia i colori (getDesignTokens)
  // sia il layout renderizzato (getLayoutTypeForSector). Calcolato prima di
  // `colors` perché la palette ora deriva dai design token di settore invece
  // che da un dark/light fisso.
  const sectorFromConfig = innerConfig?.blueprint?.sector
    || (innerConfig?.sector as string | undefined)
    || config?.blueprint?.sector
    || (config?.sector as string | undefined)
    || '';
  const richLayoutType = getLayoutTypeForSector(sectorFromConfig);
  const designTokens = useMemo(() => getDesignTokens(sectorFromConfig), [sectorFromConfig]);

  const primaryColor = prefs.primaryColor
    || config?.branding?.primary_color
    || designTokens.colors.primary;

  const theme = prefs.theme || config?.branding?.theme || (isColorDark(designTokens.colors.bg) ? 'dark' : 'light');
  // `colors` ora riflette sempre la palette di design.md per il settore
  // dell'app (design.md coerente su sidebar/tabelle/form/modali), con
  // l'eventuale colore primario personalizzato dall'utente in Impostazioni
  // come override — non più un dark/light fisso indipendente dal settore.
  const colors = useMemo(
    () => designTokensToThemeVars(designTokens, prefs.primaryColor || config?.branding?.primary_color || undefined, theme),
    [designTokens, prefs.primaryColor, config?.branding?.primary_color, theme]
  );
  const layoutCfg = LAYOUT_CONFIG[prefs.layout];

  // ─── Load preferences from localStorage ──────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem(prefsKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<UserPrefs>;
        // Sincronizza lo stato React con localStorage (sistema esterno) al
        // mount: pattern canonico da effetto, non un "derived state" — non
        // c'è un modo per leggere localStorage durante il render iniziale
        // senza rischiare un mismatch di idratazione SSR/CSR.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrefs((prev) => ({ ...prev, ...parsed }));
      }
    } catch { /* ignore */ }
  }, [prefsKey]);

  // ─── Semina i default (colore primario, tema) dai design token di settore
  // alla primissima apertura (nessuna preferenza salvata) — dopo, la scelta
  // esplicita dell'utente in Impostazioni resta sempre rispettata.
  const defaultsSeededRef = useRef(false);
  useEffect(() => {
    if (defaultsSeededRef.current || !sectorFromConfig) return;
    defaultsSeededRef.current = true;
    try {
      const saved = localStorage.getItem(prefsKey);
      if (!saved) {
        // Stessa motivazione dell'effetto sopra: prima lettura da
        // localStorage, guardata da defaultsSeededRef così scatta una sola
        // volta — non è un valore derivabile durante il render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrefs((prev) => ({
          ...prev,
          primaryColor: designTokens.colors.primary,
          theme: isColorDark(designTokens.colors.bg) ? 'dark' : 'light',
        }));
      }
    } catch { /* ignore */ }
  }, [sectorFromConfig, designTokens, prefsKey]);

  // ─── Save preferences to localStorage ────────────────────────────────────
  // Aspetta che il settore sia noto (stesso guard della semina qui sopra):
  // altrimenti questo effetto salverebbe i default hardcoded dello state
  // iniziale (tema scuro, indaco) PRIMA che l'effetto di semina riesca a
  // scriverci sopra i valori corretti del settore, vincendo la race e
  // congelando ogni tenant sul tema/colore di default invece di quello giusto.

  useEffect(() => {
    if (!sectorFromConfig) return;
    try {
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
    } catch { /* ignore */ }
  }, [prefs, prefsKey, sectorFromConfig]);

  // ─── Registra service worker + manifest PWA dinamico ─────────────────────

  usePwaSetup(slug, designTokens.colors.primary, logoUrl || '/icons/icon-192x192.png', companyName);

  // ─── Detect mobile viewport ──────────────────────────────────────────────

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── Check session on mount ──────────────────────────────────────────────

  useEffect(() => {
    // App auth_mode='supabase': niente localStorage, la sessione viene dalla
    // vera sessione Supabase Auth (già garantita da layout.tsx prima di
    // montare questa pagina) + dal contesto app condiviso.
    if (authMode === 'supabase') {
      (async () => {
        const { data: { session: supaSession } } = await supabaseBrowser.auth.getSession();
        if (!supaSession) {
          router.replace(`/a/${slug}/login`);
          return;
        }
        setSession({
          slug,
          password: '',
          mode: 'supabase',
          accessToken: supaSession.access_token,
          appInfo: {
            id: appInfoCtx.appId,
            slug,
            name: appInfoCtx.appName,
            config: (appInfoCtx.config || {}) as AppConfig['config'],
          },
        });
        setShowLogin(false);
        setLoading(false);
      })();
      return;
    }

    const checkSession = () => {
      try {
        const raw = localStorage.getItem(sessionKey);
        if (raw) {
          const parsed: AppSession = JSON.parse(raw);
          // Verifica che la sessione abbia appInfo (struttura nuova)
          if (!parsed.appInfo) {
            // Sessione vecchia, pulisci e mostra login
            localStorage.removeItem(sessionKey);
            setShowLogin(true);
            return;
          }
          if (parsed.appInfo?.blocked) {
            window.location.href = `/a/${slug}/blocked`;
            return;
          }
          setSession(parsed);
          setShowLogin(false);
        } else {
          setShowLogin(true);
        }
      } catch {
        setShowLogin(true);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [sessionKey, slug, authMode, appInfoCtx, router]);

  // ─── Load records when table changes ─────────────────────────────────────

  // Fetch + normalizzazione senza toccare `records`/`recordsLoading`: usata
  // sia da loadRecords (tabella attiva) sia dall'effetto sotto che precarica
  // clienti/prodotti/ordini per popolare i menu a tendina dei campi di
  // relazione (DynamicRecordModal → getTargetRecords).
  const fetchTableRecords = useCallback(async (tableName: string, password: string, appId: string): Promise<AppRecord[]> => {
    const res = await fetch(`/api/client/apps/${appId}/records?table=${tableName}`, {
      headers: { Authorization: `Bearer ${password}` },
    });
    if (!res.ok) throw new Error('Failed to load records');
    const data = await res.json();
    const rawRecords: RawActivityRecord[] = Array.isArray(data) ? data : data.records || data.data || [];
    // Il backend salva i campi dentro la colonna JSONB "data" (es. { id, data: { ragione_sociale, ... } }).
    // Appiattiamo qui la struttura in modo che DynamicDataTable/DynamicRecordModal
    // possano leggere i campi direttamente da record[fieldName] come si aspettano.
    // L'id reale del record deve sempre vincere su un eventuale campo
    // omonimo dentro ai dati (es. una tabella con un campo chiamato "id"):
    // lo spread va PRIMA, altrimenti sovrascrive l'id vero con quello dei
    // dati e le richieste PUT/DELETE successive partono con un id vuoto,
    // finendo su /records/ (slash finale) invece di /records/{id} — quella
    // rotta supporta solo GET/POST, da cui un fuorviante "Errore server: 405".
    return rawRecords.map((r) => ({
      ...(r.data || r),
      id: r.id,
    }));
  }, []);

  const loadRecords = useCallback(async (tableName: string, password: string, appId: string) => {
    // Le app demo dello Showcase (dashboard/showcase) non hanno righe reali
    // nel backend (vedi getDemoApp in lib/demoApps.ts): saltiamo la chiamata
    // invece di generare un errore atteso ad ogni cambio tabella.
    if (appId.startsWith('demo-')) {
      setRecords([]);
      setRecordsLoading(false);
      return;
    }
    setRecordsLoading(true);
    try {
      const normalized = await fetchTableRecords(tableName, password, appId);
      setRecords(normalized);
    } catch (err) {
      console.error('Error loading records:', err);
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [fetchTableRecords]);


  useEffect(() => {
    // Sincronizza i record mostrati con la tabella/sessione attiva
    // (sistema esterno = backend): il pattern "fetch quando cambia una
    // dipendenza" è quello documentato da React per gli effetti — qui non
    // c'è libreria di data-fetching (SWR/React Query) su cui appoggiarsi.
    if (activeTable && session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } else {
      setRecords([]);
    }
    setSearchQuery('');
  }, [activeTable, session, loadRecords]);

  // ─── Carica i record delle tabelle di relazione (clienti/prodotti/ordini) ─
  // DynamicRecordModal usa queste liste per popolare i menu a tendina dei
  // campi di relazione (getTargetRecords, "cliente collegato" ecc.): senza
  // questo effetto i tre setter non venivano mai chiamati e quei menu
  // restavano sempre vuoti, indipendentemente dai dati presenti nell'app.
  useEffect(() => {
    // Stessa motivazione degli effetti di fetch sopra: sincronizza queste
    // liste con sessione/tabelle disponibili.
    if (!session || session.appInfo.id.startsWith('demo-')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClientiRecords([]);
      setProdottiRecords([]);
      setOrdiniRecords([]);
      return;
    }
    const targets: [string, (records: AppRecord[]) => void][] = [
      ['clienti', setClientiRecords],
      ['prodotti', setProdottiRecords],
      ['ordini', setOrdiniRecords],
    ];
    for (const [name, setter] of targets) {
      if (!tables.some((t) => t.name === name)) {
        setter([]);
        continue;
      }
      fetchTableRecords(name, getAuthToken(session), session.appInfo.id)
        .then(setter)
        .catch(() => setter([]));
    }
  }, [session, tables, fetchTableRecords]);

  // ─── Load custom tables from backend ────────────────────────────────────

  const loadCustomTables = useCallback(async () => {
    if (!session) return;
    // Stesso discorso di loadRecords: le app demo non hanno backend reale.
    if (session.appInfo.id.startsWith('demo-')) {
      setCustomTables([]);
      return;
    }
    setCustomTablesLoading(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-tables`, {
        headers: { Authorization: `Bearer ${getAuthToken(session)}` },
      });
      if (!res.ok) throw new Error('Failed to load custom tables');
      const data = await res.json();
      setCustomTables(data.tables || []);
    } catch (err) {
      console.error('Error loading custom tables:', err);
      setCustomTables([]);
    } finally {
      setCustomTablesLoading(false);
    }
  }, [session]);

  // Load custom tables on session change
  useEffect(() => {
    // Stessa motivazione dell'effetto di loadRecords sopra: fetch dal
    // backend quando cambia la sessione.
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCustomTables();
    } else {
      setCustomTables([]);
    }
  }, [session, loadCustomTables]);

  // ─── Load custom records when activeView is a custom table ──────────────

  const activeCustomTable = useMemo(() => {
    return customTables.find((t) => `custom_${t.name}` === activeView) || null;
  }, [customTables, activeView]);

  const loadCustomRecords = useCallback(async (tableName: string) => {
    if (!session) return;
    setCustomRecordsLoading(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-records/${tableName}`, {
        headers: { Authorization: `Bearer ${getAuthToken(session)}` },
      });
      if (!res.ok) throw new Error('Failed to load custom records');
      const data = await res.json();
      setCustomRecords(data.records || []);
    } catch (err) {
      console.error('Error loading custom records:', err);
      setCustomRecords([]);
    } finally {
      setCustomRecordsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    // Stessa motivazione dell'effetto di loadRecords sopra: fetch dal
    // backend quando cambia la tabella personalizzata attiva.
    if (activeCustomTable && session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCustomRecords(activeCustomTable.name);
    } else {
      setCustomRecords([]);
    }
    setSearchQuery('');
  }, [activeCustomTable, session, loadCustomRecords]);

  // ─── Custom table CRUD handlers ─────────────────────────────────────────

  const handleCreateCustomTable = useCallback(async (tableData: { name: string; label: string; labelPlural: string; columns: ColumnDef[] }) => {
    if (!session) return;
    setCreatingCustomTable(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-tables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify(tableData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Errore creazione tabella');
      }
      setShowCreateCustomTable(false);
      await loadCustomTables();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore');
    } finally {
      setCreatingCustomTable(false);
    }
  }, [session, loadCustomTables]);

  // Ripristina l'app allo stato iniziale: elimina tutte le tabelle
  // personalizzate/create con l'AI (e i loro record), senza mai toccare le
  // tabelle originali del gestionale (clienti/prodotti/ordini/ecc.), che
  // vivono sotto nomi diversi da "_custom_*" e non sono gestite qui.
  const handleResetCustomTables = useCallback(async () => {
    if (!session) return;
    if (customTables.length === 0) {
      alert('Non ci sono tabelle personalizzate da rimuovere: l\'app è già allo stato iniziale.');
      return;
    }
    if (!confirm(`Questo eliminerà tutte le ${customTables.length} tabelle personalizzate create (e i loro dati). Le tabelle originali del gestionale non verranno toccate. Continuare?`)) {
      return;
    }

    setResettingSchema(true);
    try {
      for (const table of customTables) {
        const tableId = table._record_id || table.id;
        const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-tables`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAuthToken(session)}`,
          },
          body: JSON.stringify({ tableId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Errore eliminazione tabella "${table.label || table.name}"`);
        }
      }
      if (activeCustomTable) {
        setActiveView('dashboard');
      }
      await loadCustomTables();
      alert('App ripristinata allo stato iniziale.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore durante il ripristino');
    } finally {
      setResettingSchema(false);
    }
  }, [session, customTables, activeCustomTable, loadCustomTables]);

  const handleCreateCustomRecord = useCallback(async (formData: Record<string, unknown>) => {
    if (!session || !activeCustomTable) return;
    setCustomSaving(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-records/${activeCustomTable.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify({ data: formData }),
      });
      if (!res.ok) throw new Error('Errore nella creazione');
      setCustomModalRecord(null);
      await loadCustomRecords(activeCustomTable.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore');
    } finally {
      setCustomSaving(false);
    }
  }, [session, activeCustomTable, loadCustomRecords]);

  const handleUpdateCustomRecord = useCallback(async (formData: Record<string, unknown>) => {
    if (!session || !activeCustomTable || !customModalRecord || customModalRecord === 'new') return;
    setCustomSaving(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-records/${activeCustomTable.name}/${customModalRecord.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify({ data: formData }),
      });
      if (!res.ok) throw new Error('Errore nella modifica');
      setCustomModalRecord(null);
      await loadCustomRecords(activeCustomTable.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore');
    } finally {
      setCustomSaving(false);
    }
  }, [session, activeCustomTable, customModalRecord, loadCustomRecords]);

  const handleDeleteCustomRecord = useCallback(async (recordId: string) => {
    if (!session || !activeCustomTable) return;
    if (!confirm('Sei sicuro di voler eliminare questo record?')) return;
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/custom-records/${activeCustomTable.name}/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken(session)}` },
      });
      if (!res.ok) throw new Error('Errore nella eliminazione');
      await loadCustomRecords(activeCustomTable.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore');
    }
  }, [session, activeCustomTable, loadCustomRecords]);

  const handleCustomModalSave = useCallback((data: Record<string, unknown>) => {
    if (customModalRecord === 'new') {
      handleCreateCustomRecord(data);
    } else {
      handleUpdateCustomRecord(data);
    }
  }, [customModalRecord, handleCreateCustomRecord, handleUpdateCustomRecord]);

  // ─── Login handler ──────────────────────────────────────────────────────

  const handleLogin = useCallback(async (password: string) => {
    // Fetch app config from backend to validate password
    const res = await fetch(`/api/a/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Password errata');
    }

    const data = await res.json();

    if (data.blocked) {
      window.location.href = `/a/${slug}/blocked`;
      return;
    }

    const appSession: AppSession = {
      slug,
      password,
      appInfo: data.appInfo || data,
    };

    localStorage.setItem(sessionKey, JSON.stringify(appSession));
    setSession(appSession);
    setShowLogin(false);
  }, [slug, sessionKey]);

  // ─── CRUD handlers ──────────────────────────────────────────────────────

  const handleCreateRecord = useCallback(async (formData: Record<string, unknown>) => {
    if (!session || !activeTable) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify({ table: activeTable.name, data: formData }),
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || `Errore server: ${res.status}`);
      setModalRecord(null);
      await loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } catch (err) {
      console.error('[CreateRecord] Error:', err);
      alert(err instanceof Error ? err.message : 'Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }, [session, activeTable, loadRecords]);

  // Popola una tabella vuota con 5 record plausibili (nomi, indirizzi,
  // prezzi... generati per euristica sul nome/tipo campo, vedi
  // mockDataGenerator.ts) invece di lasciarla con caselle vuote — stesso
  // endpoint di creazione già usato da handleCreateRecord, chiamato 5 volte
  // in sequenza. Le foto restano vuote: ricadono già sul placeholder
  // fotografico automatico per categoria.
  const handleGenerateMockRecords = useCallback(async () => {
    if (!session || !activeTable) return;
    setGeneratingMock(true);
    try {
      for (let i = 0; i < 5; i++) {
        const mockData = generateMockRecord(activeTable, i);
        const res = await fetch(`/api/client/apps/${session.appInfo.id}/records`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getAuthToken(session)}`,
          },
          body: JSON.stringify({ table: activeTable.name, data: mockData }),
        });
        const responseData = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(responseData.error || `Errore server: ${res.status}`);
      }
      await loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } catch (err) {
      console.error('[GenerateMockRecords] Error:', err);
      alert(err instanceof Error ? err.message : 'Errore durante la generazione dei dati di esempio');
    } finally {
      setGeneratingMock(false);
    }
  }, [session, activeTable, loadRecords]);

  const handleUpdateRecord = useCallback(async (formData: Record<string, unknown>) => {
    if (!session || !activeTable || !modalRecord || modalRecord === 'new') return;
    if (!modalRecord.id) {
      // Senza id la richiesta finirebbe su /records/ (slash finale) invece
      // di /records/{id}: quella rotta supporta solo GET/POST, quindi un
      // fuorviante 405 invece di un errore chiaro sul vero problema.
      alert('Impossibile salvare: record senza id valido. Ricarica la pagina e riprova.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/records/${modalRecord.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify({ data: formData }),
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || `Errore server: ${res.status}`);
      setModalRecord(null);
      await loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } catch (err) {
      console.error('[UpdateRecord] Error:', err);
      alert(err instanceof Error ? err.message : 'Errore durante la modifica');
    } finally {
      setSaving(false);
    }
  }, [session, activeTable, modalRecord, loadRecords]);

  const handleDeleteRecord = useCallback(async (recordId: string) => {
    if (!session || !activeTable) return;
    if (!recordId) {
      alert('Impossibile eliminare: record senza id valido. Ricarica la pagina e riprova.');
      return;
    }
    if (!confirm('Sei sicuro di voler eliminare questo record?')) return;
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/records/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken(session)}` },
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || `Errore server: ${res.status}`);
      await loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } catch (err) {
      console.error('[DeleteRecord] Error:', err);
      alert(err instanceof Error ? err.message : 'Errore durante l\'eliminazione');
    }
  }, [session, activeTable, loadRecords]);

  const handleChangePassword = useCallback(async (oldPw: string, newPw: string) => {
    // App auth_mode='supabase': la password vive in Supabase Auth, non nella
    // colonna legacy apps.client_password — l'utente ha già una sessione
    // valida, quindi updateUser non richiede la vecchia password.
    if (session?.mode === 'supabase') {
      const { error } = await supabaseBrowser.auth.updateUser({ password: newPw });
      if (error) throw new Error(error.message || 'Errore nel cambio password');
      return;
    }

    const res = await fetch(`/api/a/${slug}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Errore nel cambio password');
    }
    // Update session with new password
    if (session) {
      const updated = { ...session, password: newPw };
      localStorage.setItem(sessionKey, JSON.stringify(updated));
      setSession(updated);
    }
  }, [slug, session, sessionKey]);

  // ─── Edit table handler ─────────────────────────────────────────────────

  const handleEditTableSave = useCallback(async (data: {
    name?: string; label?: string; labelPlural?: string;
    // Forma volutamente più permissiva di FieldDef (type: string invece
    // dell'unione stretta): è la stessa usata da EditTableModal, che accetta
    // qualunque stringa dal <select> del tipo campo prima della validazione
    // lato backend.
    fields: { name: string; label: string; type: string; required?: boolean; options?: string[]; fixed?: boolean }[];
  }) => {
    if (!session || !editTable) return;
    setEditTableSaving(true);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/tables/${editTable.name}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Errore salvataggio tabella');
      }
      // If table name changed, update activeView
      if (data.name && data.name !== editTable.name && activeView === editTable.name) {
        setActiveView(data.name);
      }
      setEditTable(null);
      // Refresh session to get updated config
      await refreshSession();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore');
    } finally {
      setEditTableSaving(false);
    }
  }, [session, editTable, activeView, refreshSession]);

  const handleLogout = useCallback(async () => {
    if (session?.mode === 'supabase') {
      await supabaseBrowser.auth.signOut();
      setSession(null);
      router.push(`/a/${slug}/login`);
      return;
    }
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(prefsKey);
    setSession(null);
    setShowLogin(true);
    setActiveView('dashboard');
    setRecords([]);
  }, [sessionKey, prefsKey, session, router, slug]);

  // ─── Record modal save dispatcher ───────────────────────────────────────

  const handleModalSave = useCallback((data: Record<string, unknown>) => {
    if (modalRecord === 'new') {
      handleCreateRecord(data);
    } else {
      handleUpdateRecord(data);
    }
  }, [modalRecord, handleCreateRecord, handleUpdateRecord]);

  // ─── Apply Design System Tokens ─────────────────────────────────────────

  useEffect(() => {
    if (!session) return;
    const root = document.getElementById('app-root-container');
    if (!root) return;

    const tokens = getDesignTokens(sectorFromConfig);
    applyDesignTokens(root, tokens);
    
    // Also set font-family on body for the design system fonts
    document.body.style.fontFamily = cssVar('font-body');
  }, [session, sectorFromConfig]);

  // ─── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e1a',
      }}>
        <div style={{ color: '#94a3b8', fontSize: '16px' }}>Caricamento...</div>
      </div>
    );
  }

  // ─── Login screen ───────────────────────────────────────────────────────

  if (showLogin || !session) {
    return (
      <LoginScreen
        slug={slug}
        appName={companyName}
        logoUrl={logoUrl}
        primaryColor={primaryColor}
        onLogin={handleLogin}
      />
    );
  }

  // ─── Layout ricco per settore (ristorante/ecommerce/recipe/docs) ─────────
  // Per i settori con un layoutType dedicato, delega il rendering a
  // DynamicLayoutRenderer invece della dashboard generica sottostante.
  // Fallback sicuro: sector assente/sconosciuto → 'saas' → dashboard generica
  // invariata, quindi le app già esistenti continuano a funzionare com'erano.
  if (richLayoutType !== 'saas' && session) {
    const isCustomTableActive = !!activeCustomTable;
    return (
      <>
        <DynamicLayoutRenderer
          layoutType={richLayoutType}
          primaryColor={primaryColor}
          colors={colors}
          designTokens={designTokens}
          companyName={companyName}
          logoUrl={logoUrl}
          slug={slug}
          tables={tables}
          activeView={activeView}
          setActiveView={setActiveView}
          onLogout={handleLogout}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          session={session}
          customTables={customTables}
          activeCustomTable={activeCustomTable}
          records={isCustomTableActive ? customRecords : records}
          recordsLoading={isCustomTableActive ? customRecordsLoading : recordsLoading}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onEdit={isCustomTableActive ? (r) => setCustomModalRecord(r) : (r) => setModalRecord(r)}
          onDelete={isCustomTableActive ? handleDeleteCustomRecord : handleDeleteRecord}
          onAddNew={isCustomTableActive ? () => setCustomModalRecord('new') : () => setModalRecord('new')}
          loadRecords={(t) => loadRecords(t, getAuthToken(session), session.appInfo.id)}
          onEditTable={(table) => setEditTable(table)}
        />

        {/* Stessi modali della dashboard generica, invariati */}
        {modalRecord !== null && activeTable && (
          <DynamicRecordModal
            table={activeTable}
            record={modalRecord === 'new' ? null : modalRecord}
            onSave={handleModalSave}
            onClose={() => setModalRecord(null)}
            saving={saving}
            colors={colors}
            clientiRecords={clientiRecords}
            prodottiRecords={prodottiRecords}
            ordiniRecords={ordiniRecords}
          />
        )}

        {showSettings && (
          <SettingsModal
            prefs={prefs}
            onPrefsChange={setPrefs}
            onClose={() => setShowSettings(false)}
            onLogout={handleLogout}
            onChangePassword={handleChangePassword}
            colors={colors}
            slug={slug}
            authMode={authMode}
            subscriptionStatus={subscriptionStatus}
            trialEndsAt={trialEndsAt}
            subscriptionPrice={clientPrice}
            onResetSchema={handleResetCustomTables}
            resettingSchema={resettingSchema}
            customTableCount={customTables.length}
            businessConfig={effectiveBusinessConfig}
            onSaveBusinessConfig={handleSaveBusinessConfig}
            savingBusinessConfig={savingBusinessConfig}
            businessConfigError={businessConfigError}
            businessConfigSaved={businessConfigSaved}
            appId={session.appInfo.id}
            authToken={getAuthToken(session)}
            paymentSettings={paymentSettings}
          />
        )}

        {showCreateCustomTable && (
          <CreateCustomTableModal
            onSave={handleCreateCustomTable}
            onClose={() => setShowCreateCustomTable(false)}
            saving={creatingCustomTable}
            colors={colors}
          />
        )}

        {customModalRecord !== null && activeCustomTable && (
          <CustomRecordModal
            columns={activeCustomTable.columns}
            record={customModalRecord === 'new' ? null : customModalRecord}
            onSave={handleCustomModalSave}
            onClose={() => setCustomModalRecord(null)}
            saving={customSaving}
            colors={colors}
            tableLabel={activeCustomTable.label}
          />
        )}

        {editTable !== null && (
          <EditTableModal
            table={editTable}
            onSave={handleEditTableSave}
            onClose={() => setEditTable(null)}
            saving={editTableSaving}
            colors={colors}
          />
        )}

        <GestionaleChatAssistant
          appId={session?.appInfo.id}
          authToken={session ? getAuthToken(session) : undefined}
          activeTable={activeTable?.name}
          colors={colors}
        />
      </>
    );
  }

  // ─── Main layout ────────────────────────────────────────────────────────

    return (
    <>
      <div
        id="app-root-container"
        className="flex h-full bg-tenant-bg"
        style={{ ...tenantThemeVars(colors), fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
      <ViewerSidebar
        tables={tables}
        customTables={customTables}
        activeView={activeView}
        onNavigate={setActiveView}
        datiAziendaliTable={datiAziendaliTable}
        onEditTable={setEditTable}
        onCreateTable={() => setShowCreateCustomTable(true)}
        onOpenSettings={() => setShowSettings(true)}
        onLogout={handleLogout}
        logoUrl={logoUrl}
        companyName={companyName}
        slug={slug}
        isMobile={isMobile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar
          title={activeView === 'dashboard' ? 'Dashboard' : activeTable?.labelPlural || activeCustomTable?.labelPlural || (activeView.startsWith('import_') || activeView.startsWith('export_') ? getViewLabel(activeView) : companyName)}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          showMenuToggle={isMobile}
        />

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: prefs.layout === 'corporate' ? '32px' : prefs.layout === 'modern' ? '24px' : '16px' }}>
            {activeView === 'dashboard' ? (
              <Dashboard
                companyName={companyName}
                tables={tables}
                appId={session?.appInfo?.id}
                authToken={session ? getAuthToken(session) : undefined}
                onQuickAdd={(tableName) => { setActiveView(tableName); setModalRecord('new'); }}
              />
            ) : activeTable ? (
              <DynamicDataTable
                table={activeTable}
                records={records}
                loading={recordsLoading}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onEdit={(r) => setModalRecord(r)}
                onDelete={handleDeleteRecord}
                onAddNew={() => setModalRecord('new')}
                onGenerateMock={handleGenerateMockRecords}
                generatingMock={generatingMock}
                colors={colors}
                radius={layoutCfg.radius}
                shadow={layoutCfg.shadow}
              />
            ) : activeCustomTable ? (
              <CustomTableRenderer
                tableDef={activeCustomTable}
                records={customRecords}
                loading={customRecordsLoading}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onEdit={(r) => setCustomModalRecord(r)}
                onDelete={handleDeleteCustomRecord}
                onAddNew={() => setCustomModalRecord('new')}
                colors={colors}
                radius={layoutCfg.radius}
                shadow={layoutCfg.shadow}
              />
            ) : activeView.startsWith('import_') || activeView.startsWith('export_') ? (
              <ImportExportPanel
                view={activeView}
                colors={colors}
                radius={layoutCfg.radius}
                shadow={layoutCfg.shadow}
                appId={session?.appInfo?.id}
                password={session ? getAuthToken(session) : undefined}
              />
            ) : (
              <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
                Seleziona una voce dal menu
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Record Modal con colonne dinamiche */}
      {modalRecord !== null && activeTable && (
        <DynamicRecordModal
          table={activeTable}
          record={modalRecord === 'new' ? null : modalRecord}
          onSave={handleModalSave}
          onClose={() => setModalRecord(null)}
          saving={saving}
          colors={colors}
          clientiRecords={clientiRecords}
          prodottiRecords={prodottiRecords}
          ordiniRecords={ordiniRecords}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          prefs={prefs}
          onPrefsChange={setPrefs}
          onClose={() => setShowSettings(false)}
          onLogout={handleLogout}
          onChangePassword={handleChangePassword}
          colors={colors}
          slug={slug}
          authMode={authMode}
          subscriptionStatus={subscriptionStatus}
          trialEndsAt={trialEndsAt}
          subscriptionPrice={clientPrice}
          onResetSchema={handleResetCustomTables}
          resettingSchema={resettingSchema}
          customTableCount={customTables.length}
          businessConfig={effectiveBusinessConfig}
          onSaveBusinessConfig={handleSaveBusinessConfig}
          savingBusinessConfig={savingBusinessConfig}
          businessConfigError={businessConfigError}
          businessConfigSaved={businessConfigSaved}
          appId={session.appInfo.id}
          authToken={getAuthToken(session)}
          paymentSettings={paymentSettings}
        />
      )}

      {/* Create Custom Table Modal */}
      {showCreateCustomTable && (
        <CreateCustomTableModal
          onSave={handleCreateCustomTable}
          onClose={() => setShowCreateCustomTable(false)}
          saving={creatingCustomTable}
          colors={colors}
        />
      )}

      {/* Custom Record Modal */}
      {customModalRecord !== null && activeCustomTable && (
        <CustomRecordModal
          columns={activeCustomTable.columns}
          record={customModalRecord === 'new' ? null : customModalRecord}
          onSave={handleCustomModalSave}
          onClose={() => setCustomModalRecord(null)}
          saving={customSaving}
          colors={colors}
          tableLabel={activeCustomTable.label}
        />
      )}

      {/* Edit Table Modal */}
      {editTable !== null && (
        <EditTableModal
          table={editTable}
          onSave={handleEditTableSave}
          onClose={() => setEditTable(null)}
          saving={editTableSaving}
          colors={colors}
        />
      )}
    </div>
    <InstallAppBanner
      appName={companyName}
      slug={slug}
      primaryColor={colors.primary}
      textColor={colors.text}
      surfaceColor={colors.cardBg}
      borderColor={colors.border}
    />
    <GestionaleChatAssistant
      appId={session?.appInfo.id}
      authToken={session ? getAuthToken(session) : undefined}
      activeTable={activeTable?.name}
      colors={colors}
    />
    </>
  );
}

// ─── ImportExportPanel Component ─────────────────────────────────────────────

interface ImportExportPanelProps {
  view: string;
  colors: ThemeVars;
  radius: string;
  shadow: string;
  appId?: string;
  password?: string;
}

function getViewLabel(view: string): string {
  const labels: Record<string, string> = {
    import_csv: 'Importa CSV',
    export_csv: 'Esporta CSV',
    import_pdf: 'Importa PDF',
    export_pdf: 'Esporta PDF',
    import_excel: 'Importa Excel',
    export_excel: 'Esporta Excel',
    import_json: 'Importa JSON',
    export_json: 'Esporta JSON',
  };
  return labels[view] || view;
}

function ImportExportPanel({ view, colors, radius, shadow, appId, password }: ImportExportPanelProps) {
  const isImport = view.startsWith('import_');
  const format = view.replace(/^(import|export)_/, '').toUpperCase();
  const IconComponent = isImport ? Upload : Download;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setMessage(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile || !appId || !password) {
      setMessage({ text: 'Seleziona un file da importare', type: 'error' });
      return;
    }
    setProcessing(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('format', format.toLowerCase());
      const res = await fetch(`/api/client/apps/${appId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore importazione');
      setMessage({ text: `${data.imported || 0} record importati con successo`, type: 'success' });
      setSelectedFile(null);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Errore importazione', type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!appId || !password) {
      setMessage({ text: 'Nessuna app collegata', type: 'error' });
      return;
    }
    setProcessing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/client/apps/${appId}/export?format=${format.toLowerCase()}`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Errore ${res.statusText}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${new Date().toISOString().split('T')[0]}.${format.toLowerCase()}`;
      a.click();
      window.URL.revokeObjectURL(url);
      setMessage({ text: 'File esportato con successo', type: 'success' });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Errore esportazione', type: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: colors.cardBg,
    border: `1px solid ${colors.border}`,
    borderRadius: '16px',
    padding: '48px',
    textAlign: 'center',
    maxWidth: '480px',
    margin: '0 auto',
  };

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${colors.border}`,
    borderRadius: '12px',
    padding: '40px 24px',
    marginBottom: '24px',
    background: colors.cardBgAlt,
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: colors.textSecondary,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <h2 style={{ color: colors.text, fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>
          {getViewLabel(view)}
        </h2>
        <p style={{ color: colors.textSecondary, fontSize: '14px', margin: 0 }}>
          {isImport
            ? `Seleziona un file ${format} da importare nei tuoi dati`
            : `Esporta i tuoi dati in formato ${format}`}
        </p>
      </div>

      <div className={`${radius} ${shadow}`} style={cardStyle}>
        {isImport ? (
          <>
            <div
              style={dropZoneStyle}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.primary; e.currentTarget.style.background = colors.primary + '10'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.background = colors.cardBgAlt; }}
            >
              <IconComponent size={48} style={{ color: colors.primary, marginBottom: '16px' }} />
              <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text, marginBottom: '8px' }}>
                {selectedFile ? selectedFile.name : 'Clicca per selezionare un file'}
              </div>
              <div style={{ fontSize: '13px' }}>
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                  : `Formati supportati: ${format}`}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={`.${format.toLowerCase()}`}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
            <button
              onClick={handleImport}
              disabled={!selectedFile || processing}
              style={{
                padding: '14px 28px', borderRadius: '10px', border: 'none',
                background: processing ? colors.textSecondary : colors.primary,
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: processing || !selectedFile ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '8px',
                margin: '0 auto',
              }}
            >
              <Upload size={18} />
              {processing ? 'Importazione in corso...' : 'Importa File'}
            </button>
          </>
        ) : (
          <>
            <div style={{ padding: '40px 24px', marginBottom: '24px' }}>
              <IconComponent size={64} style={{ color: colors.primary, marginBottom: '16px' }} />
              <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text, marginBottom: '8px' }}>
                Esporta in formato {format}
              </div>
              <div style={{ fontSize: '13px', color: colors.textSecondary }}>
                Scarica tutti i tuoi dati in un file {format}
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={processing}
              style={{
                padding: '14px 28px', borderRadius: '10px', border: 'none',
                background: processing ? colors.textSecondary : colors.primary,
                color: '#fff', fontSize: '15px', fontWeight: 600,
                cursor: processing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '8px',
                margin: '0 auto',
              }}
            >
              <Download size={18} />
              {processing ? 'Esportazione in corso...' : 'Scarica File'}
            </button>
          </>
        )}

        {message && (
          <div style={{
            marginTop: '20px', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
            background: message.type === 'success' ? colors.success + '20' : colors.danger + '20',
            color: message.type === 'success' ? colors.success : colors.danger,
          }}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Entry point della route /a/[slug]/app ─────────────────────────────────
export default function AppPage() {
  return <ViewerProFinal />;
}
