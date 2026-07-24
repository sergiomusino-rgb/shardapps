'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { SYSTEM_TABLES, getTableByName, createEmptyRecord } from './table-definitions';
import DynamicDataTable from './DynamicDataTable';
import DynamicRecordModal from './DynamicRecordModal';
import CreateCustomTableModal from './CreateCustomTableModal';
import AITableModal from './AITableModal';
import EditTableModal from './EditTableModal';
import CustomTableRenderer from './CustomTableRenderer';
import CustomRecordModal from './CustomRecordModal';
import {
  LayoutDashboard, Settings, LogOut, Search, Plus, Pencil, Trash2,
  X, ChevronDown, TrendingUp,
  AlertTriangle, Calendar, CheckCircle, Clock, XCircle, Menu,
  Download, Upload, Download as InstallIcon, MessageSquare, Mail, MessageCircle,
  Settings2, FileText, FileSpreadsheet, File as FileIcon, Database, CreditCard,
  Sparkles,
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
  import FullscreenToggle from '@/components/FullscreenToggle';
  import { usePwaSetup } from '@/hooks/usePwaSetup';
  import { sortTablesForSidebar, getDatiAziendaliTable } from './table-definitions';
  import ComandiOperativeConsole from '@/components/comandi/ComandiOperativeConsole';

// ─── Interfaces ───────────────────────────────────────────────────────────────

// Re-export types from table-definitions for local use
import type { FieldDef as TableFieldDef, TableDef as TableDefType } from './table-definitions';
type FieldDef = TableFieldDef;
type TableDef = TableDefType;

// Helper per ottenere il nome del campo (supporta sia name che id)
function fieldName(f: FieldDef): string {
  return f.name || f.id || '';
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
    };
    tables?: TableDef[];
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
  blueprint?: { schema?: { tables: TableDef[] }; tables?: TableDef[]; sector?: string };
  tables?: TableDef[];
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
  companyName: string;
  logoUrl: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

const LAYOUT_CONFIG = {
  corporate:  { sidebarWidth: 'w-72', padding: 'p-8', radius: 'rounded-2xl', shadow: 'shadow-2xl' },
  modern:     { sidebarWidth: 'w-64', padding: 'p-6', radius: 'rounded-xl',  shadow: 'shadow-xl' },
  compact:    { sidebarWidth: 'w-56', padding: 'p-4', radius: 'rounded-lg',  shadow: 'shadow-lg' },
};

const SIDEBAR_WIDTHS = {
  corporate: '288px',
  modern: '256px',
  compact: '224px',
};

// ─── Theme Helpers ────────────────────────────────────────────────────────────

function getThemeVars(theme: 'dark' | 'light', primaryColor: string) {
  const isDark = theme === 'dark';
  return {
    bg: isDark ? '#0a0e1a' : '#f8fafc',
    text: isDark ? '#ffffff' : '#0f172a',
    textSecondary: isDark ? '#94a3b8' : '#64748b',
    cardBg: isDark ? '#1e293b' : '#ffffff',
    cardBgAlt: isDark ? '#162032' : '#f1f5f9',
    border: isDark ? '#334155' : '#e2e8f0',
    sidebarBg: isDark ? '#0f172a' : '#1e293b',
    sidebarText: '#e2e8f0',
    sidebarHover: isDark ? '#1e293b' : '#334155',
    inputBg: isDark ? '#0f172a' : '#f1f5f9',
    inputBorder: isDark ? '#334155' : '#cbd5e1',
    primary: primaryColor,
    primaryHover: primaryColor + 'dd',
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
  };
}

// Adatta i design token di settore (design.md, da lib/designTokens.ts) alla
// stessa forma di getThemeVars, così tutti i componenti che già ricevono
// `colors` come prop (DynamicDataTable, DynamicRecordModal, CustomTableRenderer,
// CreateCustomTableModal, AITableModal, EditTableModal, CustomRecordModal,
// SettingsModal, ecc.) ottengono la palette del settore senza alcuna modifica
// al loro codice interno — cambia solo come `colors` viene calcolato qui sotto.
function designTokensToThemeVars(tokens: DesignTokens, primaryColorOverride?: string) {
  const c = tokens.colors;
  const primary = primaryColorOverride || c.primary;
  return {
    bg: c.bg,
    text: c.text,
    textSecondary: c['text-secondary'],
    cardBg: c['card-bg'],
    cardBgAlt: c['card-bg-alt'],
    border: c.border,
    sidebarBg: c['sidebar-bg'],
    sidebarText: c['sidebar-text'],
    sidebarHover: c['sidebar-hover'],
    inputBg: c['input-bg'],
    inputBorder: c.border,
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
  trend?: string;
  trendUp?: boolean;
  colors: ReturnType<typeof getThemeVars>;
  radius: string;
}

function KpiCard({ title, value, icon, trend, trendUp, colors, radius }: KpiCardProps) {
  return (
    <div
      className={`relative overflow-hidden ${radius} ${LAYOUT_CONFIG.corporate.shadow} transition-all duration-300 hover:-translate-y-1`}
      style={{
        background: `linear-gradient(160deg, ${colors.cardBg}, ${colors.primary}0d)`,
        border: `1px solid ${colors.primary}33`,
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Bagliore decorativo in alto a destra */}
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full"
        style={{ background: colors.primary, opacity: 0.12, filter: 'blur(20px)' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
        <span style={{ color: colors.textSecondary, fontSize: '14px', fontWeight: 500 }}>{title}</span>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', borderRadius: '10px',
            background: `${colors.primary}1F`, color: colors.primary,
          }}
        >
          {icon}
        </div>
      </div>
      <span style={{ color: colors.text, fontSize: '28px', fontWeight: 700, position: 'relative' }}>{value}</span>

      {trend ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', position: 'relative' }}>
          <TrendingUp
            size={14}
            style={{ color: trendUp ? colors.success : colors.danger, transform: trendUp ? 'none' : 'rotate(180deg)' }}
          />
          <span style={{ color: trendUp ? colors.success : colors.danger }}>{trend}</span>
          <span style={{ color: colors.textSecondary }}>vs mese scorso</span>
        </div>
      ) : (
        <svg width="100%" height="28" viewBox="0 0 120 28" preserveAspectRatio="none" style={{ position: 'relative' }}>
          <polyline
            points="0,20 15,17 30,21 45,12 60,16 75,8 90,13 105,6 120,10"
            fill="none"
            stroke={colors.primary}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.35"
          />
        </svg>
      )}
    </div>
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
  colors: ReturnType<typeof getThemeVars>;
  radius: string;
  shadow: string;
  companyName: string;
  tables: TableDef[];
  appId?: string;
  authToken?: string;
  onQuickAdd: (tableName: string) => void;
}

function Dashboard({ colors, radius, shadow, companyName, tables, appId, authToken, onQuickAdd }: DashboardProps) {
  const { t } = useLanguage();
  const [totalRecords, setTotalRecords] = useState(0);
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);
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

        for (const table of tables) {
          try {
            const res = await fetch(`/api/client/apps/${appId}/records?table=${table.name}`, {
              headers: { Authorization: `Bearer ${password}` },
            });
            if (res.ok) {
              const data = await res.json();
              const recs: any[] = Array.isArray(data) ? data : data.records || data.data || [];
              counts[table.name] = recs.length;
              total += recs.length;

              const textField = table.fields.find((f) => ['text', 'email', 'tel'].includes(f.type) && fieldName(f) !== 'id');
              const statusField = table.fields.find((f) => f.type === 'select');

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
              }
            }
          } catch { /* skip table */ }
        }

        activity.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        setRecentActivity(activity.slice(0, 6));
        setTableCounts(counts);
        setTotalRecords(total);
      } catch { /* ignore */ }
      setLoading(false);
    }
    loadDashboardData();
  }, [tables, appId, authToken]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '28px', fontWeight: 700, margin: 0 }}>
            {t('nav_dashboard')}
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: '14px', marginTop: '4px' }}>
            {t('dashboard_overview')} {companyName}
          </p>
        </div>
        <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
          Caricamento...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '28px', fontWeight: 700, margin: 0 }}>
          {t('nav_dashboard')}
        </h1>
        <p style={{ color: colors.textSecondary, fontSize: '14px', marginTop: '4px' }}>
          {t('dashboard_overview')} {companyName}
        </p>
      </div>

      {tables.length === 0 ? (
        <div
          style={{
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '60px 40px',
            textAlign: 'center',
          }}
        >
          <LayoutDashboard size={48} style={{ color: colors.primary, marginBottom: '16px' }} />
          <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '22px', fontWeight: 700, margin: '0 0 12px 0' }}>
            Benvenuto in {companyName}!
          </h2>
          <p style={{ color: colors.textSecondary, fontSize: '14px', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>
            La tua app è pronta per essere utilizzata. Crea tabelle e record per iniziare a gestire i tuoi dati.
          </p>
        </div>
      ) : (
        <>
          {/* Dynamic KPI Cards based on real data */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            <KpiCard
              title="Tabelle"
              value={String(tables.length)}
              icon={<LayoutDashboard size={22} />}
              colors={colors}
              radius={radius}
            />
            <KpiCard
              title="Record Totali"
              value={String(totalRecords)}
              icon={<Database size={22} />}
              colors={colors}
              radius={radius}
            />
            <KpiCard
              title="Ultima Attività"
              value={recentActivity[0] ? formatRelativeTime(recentActivity[0].timestamp) || '—' : '—'}
              icon={<Clock size={22} />}
              colors={colors}
              radius={radius}
            />
          </div>

          {/* Azioni rapide */}
          <div
            style={{
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              padding: '20px 24px',
            }}
          >
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '16px', fontWeight: 600, margin: '0 0 14px 0' }}>
              Azioni Rapide
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {tables.slice(0, 4).map((table) => (
                <button
                  key={table.name}
                  onClick={() => onQuickAdd(table.name)}
                  className="transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 16px', borderRadius: '10px', border: `1px solid ${colors.primary}33`,
                    background: `${colors.primary}12`, color: colors.primary,
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Plus size={14} />
                  Nuovo {table.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', alignItems: 'start' }}>
            {/* Tables overview con breakdown record per tabella */}
            <div
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                padding: '24px',
              }}
            >
              <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0' }}>
                Le tue Tabelle
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tables.map((table) => (
                  <div
                    key={table.name}
                    className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderRadius: '10px',
                      background: colors.cardBg, border: `1px solid ${colors.primary}22`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '32px', height: '32px', borderRadius: '8px',
                          background: `${colors.primary}1A`, color: colors.primary,
                        }}
                      >
                        {resolveIcon(table.icon || '', table.name)}
                      </div>
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '14px', fontWeight: 500 }}>
                        {table.labelPlural || table.label}
                      </span>
                    </div>
                    <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                      {tableCounts[table.name] ?? 0} record
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Feed attività recenti */}
            <div
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                padding: '24px',
              }}
            >
              <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: colors.text, fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0' }}>
                Attività Recente
              </h3>
              {recentActivity.length === 0 ? (
                <p style={{ color: colors.textSecondary, fontSize: '13px' }}>Nessuna attività ancora registrata.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {recentActivity.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '10px',
                        background: colors.cardBgAlt,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                          background: `${colors.primary}1A`, color: colors.primary,
                        }}
                      >
                        {item.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: colors.text, fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.recordLabel}
                        </div>
                        <div style={{ color: colors.textSecondary, fontSize: '12px' }}>
                          {item.tableLabel} · {formatRelativeTime(item.timestamp) || 'data sconosciuta'}
                        </div>
                      </div>
                      {item.statusValue && <StatusBadge value={item.statusValue} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── DataTable Component ──────────────────────────────────────────────────────

interface DataTableProps {
  table: TableDef;
  records: AppRecord[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onEdit: (record: AppRecord) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  colors: ReturnType<typeof getThemeVars>;
  radius: string;
  shadow: string;
}

function DataTable({
  table, records, loading, searchQuery, onSearchChange,
  onEdit, onDelete, onAddNew, colors, radius, shadow,
  appId, password,
}: DataTableProps & { appId?: string; password?: string }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (!appId || !password) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/client/apps/${appId}/export?table=${table.name}`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) throw new Error('Errore esportazione');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${table.name}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore esportazione');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !appId || !password) return;

    setImporting(true);
    setImportMsg('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table', table.name);

      const res = await fetch(`/api/client/apps/${appId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Errore importazione');
      }

      setImportMsg(`${data.imported} record importati`);
      e.target.value = '';
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Errore importazione');
    } finally {
      setImporting(false);
    }
  };

  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) =>
      table.fields.some((f) => {
        const fn = fieldName(f);
        const val = r.data?.[fn];
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [records, searchQuery, table.fields]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ color: colors.text, fontSize: '24px', fontWeight: 700, margin: 0 }}>
          {table.labelPlural}
        </h2>
        <button
          onClick={onAddNew}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 18px', borderRadius: '10px', border: 'none',
            background: colors.primary, color: '#fff', fontSize: '14px',
            fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <Plus size={16} /> Nuovo
        </button>
      </div>

      {/* Search Bar */}
      <div
        className={`${radius}`}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: colors.cardBg, border: `1px solid ${colors.border}`,
          padding: '10px 16px',
        }}
      >
        <Search size={18} style={{ color: colors.textSecondary }} />
        <input
          type="text"
          placeholder={`Cerca in ${table.labelPlural}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            color: colors.text, fontSize: '14px',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: '2px' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Table */}
      <div
        className={`${radius} ${shadow}`}
        style={{
          background: colors.cardBg, border: `1px solid ${colors.border}`,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ background: colors.cardBgAlt }}>
                {table.fields.map((field) => (
                  <th
                    key={fieldName(field)}
                    style={{
                      textAlign: 'left', padding: '12px 16px',
                      borderBottom: `2px solid ${colors.border}`,
                      color: colors.textSecondary, fontSize: '12px',
                      fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', whiteSpace: 'nowrap',
                    }}
                  >
                    {field.label}
                  </th>
                ))}
                <th
                  style={{
                    textAlign: 'center', padding: '12px 16px',
                    borderBottom: `2px solid ${colors.border}`,
                    color: colors.textSecondary, fontSize: '12px',
                    fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.05em', width: '100px',
                  }}
                >
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={table.fields.length + 1}
                    style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}
                  >
                    Caricamento records...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={table.fields.length + 1}
                    style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}
                  >
                    {searchQuery ? 'Nessun risultato per la ricerca' : 'Nessun record presente'}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => (
                  <tr
                    key={record.id || idx}
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.cardBgAlt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {table.fields.map((field) => (
                      <td
                        key={fieldName(field)}
                        style={{
                          padding: '12px 16px', color: colors.text,
                          fontSize: '14px', whiteSpace: 'nowrap',
                          maxWidth: '200px', overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {field.type === 'checkbox'
                          ? ((record.data?.[fieldName(field)]) ? 'Si' : 'No')
                          : field.type === 'select'
                            ? String(record.data?.[fieldName(field)] ?? '')
                            : String(record.data?.[fieldName(field)] ?? '')}
                      </td>
                    ))}
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button
                          onClick={() => onEdit(record)}
                          title="Modifica"
                          style={{
                            background: colors.primary + '20', border: 'none',
                            borderRadius: '8px', padding: '6px', cursor: 'pointer',
                            color: colors.primary, display: 'flex', alignItems: 'center',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = colors.primary + '40'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = colors.primary + '20'; }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => onDelete(record.id)}
                          title="Elimina"
                          style={{
                            background: colors.danger + '20', border: 'none',
                            borderRadius: '8px', padding: '6px', cursor: 'pointer',
                            color: colors.danger, display: 'flex', alignItems: 'center',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = colors.danger + '40'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = colors.danger + '20'; }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer counter */}
        <div
          style={{
            padding: '12px 16px', borderTop: `1px solid ${colors.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
            {filteredRecords.length} di {records.length} record
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── RecordModal Component ────────────────────────────────────────────────────

interface RecordModalProps {
  table: TableDef;
  record: AppRecord | null; // null = new record
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
  colors: ReturnType<typeof getThemeVars>;
}

function RecordModal({ table, record, onSave, onClose, saving, colors }: RecordModalProps) {
  const isEdit = record !== null;
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (record) {
      const data: Record<string, unknown> = {};
      table.fields.forEach((f) => { const fn = fieldName(f); data[fn] = record.data?.[fn] ?? ''; });
      return data;
    }
    const data: Record<string, unknown> = {};
    table.fields.forEach((f) => {
      data[fieldName(f)] = f.type === 'checkbox' ? false : '';
    });
    return data;
  });

  const handleChange = (fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '8px',
    border: `1px solid ${colors.inputBorder}`, background: colors.inputBg,
    color: colors.text, fontSize: '14px', outline: 'none',
    transition: 'border-color 0.2s', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: '6px', fontSize: '13px',
    fontWeight: 600, color: colors.textSecondary,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl"
        style={{
          background: colors.cardBg, border: `1px solid ${colors.border}`,
          width: '100%', maxWidth: '560px', maxHeight: '85vh',
          overflow: 'auto', padding: '32px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ color: colors.text, fontSize: '20px', fontWeight: 700, margin: 0 }}>
            {isEdit ? `Modifica ${table.label}` : `Nuovo ${table.label}`}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: colors.textSecondary, padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {table.fields.map((field) => {
            const fn = fieldName(field);
            return (
            <div key={fn}>
              <label style={labelStyle}>
                {field.label}
                {field.required && <span style={{ color: colors.danger, marginLeft: '4px' }}>*</span>}
              </label>

              {field.type === 'textarea' ? (
                <textarea
                  value={String(formData[fn] ?? '')}
                  onChange={(e) => handleChange(fn, e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
                />
              ) : field.type === 'select' ? (
                <div style={{ position: 'relative' }}>
                  <select
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                    style={{ ...inputStyle, appearance: 'none', paddingRight: '36px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
                  >
                    <option value="">Seleziona...</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    style={{
                      position: 'absolute', right: '12px', top: '50%',
                      transform: 'translateY(-50%)', color: colors.textSecondary,
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              ) : field.type === 'checkbox' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(formData[fn])}
                    onChange={(e) => handleChange(fn, e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: colors.primary }}
                  />
                  <span style={{ color: colors.text, fontSize: '14px' }}>
                    {formData[fn] ? 'Attivo' : 'Non attivo'}
                  </span>
                </label>
              ) : field.type === 'number' ? (
                <input
                  type="number"
                  value={String(formData[fn] ?? '')}
                  onChange={(e) => handleChange(fn, e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
                />
              ) : field.type === 'date' ? (
                <input
                  type="date"
                  value={String(formData[fn] ?? '')}
                  onChange={(e) => handleChange(fn, e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
                />
              ) : (
                <input
                  type="text"
                  value={String(formData[fn] ?? '')}
                  onChange={(e) => handleChange(fn, e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = colors.inputBorder; }}
                />
              )}
            </div>
            );
          })}

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: '10px',
                border: `1px solid ${colors.border}`, background: 'transparent',
                color: colors.textSecondary, fontSize: '14px', fontWeight: 600,
                cursor: 'pointer', transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.cardBgAlt; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '10px 24px', borderRadius: '10px', border: 'none',
                background: saving ? colors.textSecondary : colors.primary,
                color: '#fff', fontSize: '14px', fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ColorPicker Component ────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorPicker({ value, onChange, colors = getThemeVars('dark', '#6366f1') }: ColorPickerProps & { colors?: ReturnType<typeof getThemeVars> }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '8px',
            background: value,
            border: '2px solid rgba(255,255,255,0.2)',
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ color: colors.text, fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
            Colore Attuale
          </div>
          <div style={{ color: colors.textSecondary, fontSize: '12px', fontFamily: 'monospace' }}>
            {value.toUpperCase()}
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          style={{
            width: '100%',
            height: '60px',
            borderRadius: '8px',
            cursor: 'crosshair',
            border: `2px solid ${colors.border}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${cursorX - 10}px`,
            top: `${cursorY - 10}px`,
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: 'white',
            border: '2px solid black',
            pointerEvents: 'none',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          }}
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: colors.textSecondary }}>
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
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
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
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: preset,
              border: value === preset ? '2px solid white' : '2px solid transparent',
              cursor: 'pointer',
              boxShadow: value === preset ? `0 0 0 2px ${preset}` : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function hexToHsl(hex: string) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;

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
  colors: ReturnType<typeof getThemeVars>;
  slug: string;
  authMode?: 'legacy' | 'supabase';
  subscriptionStatus?: SubscriptionStatus | null;
  trialEndsAt?: string | null;
  subscriptionPrice: number;
  onResetSchema: () => void;
  resettingSchema: boolean;
  customTableCount: number;
}

function SettingsModal({ prefs, onPrefsChange, onClose, onLogout, onChangePassword, colors, slug, authMode, subscriptionStatus, trialEndsAt, subscriptionPrice, onResetSchema, resettingSchema, customTableCount }: SettingsModalProps) {
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

  const sectionTitle: React.CSSProperties = {
    color: colors.text, fontSize: '15px', fontWeight: 700,
    marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  const sectionBox: React.CSSProperties = {
    background: colors.cardBgAlt, borderRadius: '12px',
    padding: '20px', marginBottom: '20px',
    border: `1px solid ${colors.border}`,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '8px',
    border: `1px solid ${colors.inputBorder}`, background: colors.inputBg,
    color: colors.text, fontSize: '14px', outline: 'none',
    boxSizing: 'border-box',
  };

  const layouts: Array<{ key: UserPrefs['layout']; label: string; desc: string }> = [
    { key: 'corporate', label: 'Corporate', desc: 'Ampio e spazioso' },
    { key: 'modern', label: 'Modern', desc: 'Bilanciato' },
    { key: 'compact', label: 'Compact', desc: 'Compatto e denso' },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl"
        style={{
          background: colors.cardBg, border: `1px solid ${colors.border}`,
          width: '100%', maxWidth: '640px', maxHeight: '85vh',
          overflow: 'auto', padding: '32px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
          <h2 style={{ color: colors.text, fontSize: '22px', fontWeight: 700, margin: 0 }}>Impostazioni</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Layout Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Layout</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {layouts.map(({ key, label, desc }) => {
              const isActive = prefs.layout === key;
              const cfg = LAYOUT_CONFIG[key];
              return (
                <button
                  key={key}
                  onClick={() => updatePref('layout', key)}
                  style={{
                    padding: '16px 12px', borderRadius: '12px', cursor: 'pointer',
                    border: `2px solid ${isActive ? colors.primary : colors.border}`,
                    background: isActive ? colors.primary + '15' : 'transparent',
                    transition: 'all 0.2s', textAlign: 'center',
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    style={{
                      width: '100%', height: '48px', borderRadius: '8px',
                      background: colors.cardBg, border: `1px solid ${colors.border}`,
                      marginBottom: '10px', display: 'flex', overflow: 'hidden',
                    }}
                  >
                    <div style={{
                      width: key === 'corporate' ? '35%' : key === 'modern' ? '28%' : '22%',
                      background: isActive ? colors.primary : colors.textSecondary + '40',
                      borderRadius: '4px', margin: '4px',
                    }} />
                    <div style={{ flex: 1, padding: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ height: '6px', borderRadius: '3px', background: colors.border }} />
                      <div style={{ height: '4px', borderRadius: '2px', background: colors.border, width: '70%' }} />
                      <div style={{ height: '4px', borderRadius: '2px', background: colors.border, width: '50%' }} />
                    </div>
                  </div>
                  <div style={{ color: colors.text, fontSize: '13px', fontWeight: 600 }}>{label}</div>
                  <div style={{ color: colors.textSecondary, fontSize: '11px', marginTop: '2px' }}>{desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Tema</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {(['dark', 'light'] as const).map((t) => {
              const isActive = prefs.theme === t;
              return (
                <button
                  key={t}
                  onClick={() => updatePref('theme', t)}
                  style={{
                    padding: '14px', borderRadius: '12px', cursor: 'pointer',
                    border: `2px solid ${isActive ? colors.primary : colors.border}`,
                    background: isActive ? colors.primary + '15' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: t === 'dark' ? '#0a0e1a' : '#f8fafc',
                    border: `1px solid ${t === 'dark' ? '#334155' : '#e2e8f0'}`,
                  }} />
                  <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>
                    {t === 'dark' ? 'Scuro' : 'Chiaro'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Colore Primario</div>
          <ColorPicker 
            value={prefs.primaryColor} 
            onChange={(color) => updatePref('primaryColor', color)} 
            colors={colors}
          />
        </div>

        {/* Brand Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Brand</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: colors.textSecondary }}>
                Nome Azienda
              </label>
              <input
                type="text"
                value={prefs.companyName}
                onChange={(e) => updatePref('companyName', e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: colors.textSecondary }}>
                Logo Azienda
              </label>
              {prefs.logoUrl && (
                <div style={{ marginBottom: '8px' }}>
                  <img
                    src={prefs.logoUrl}
                    alt="Logo preview"
                    style={{ height: '48px', maxWidth: '160px', objectFit: 'contain', borderRadius: '8px', border: `1px solid ${colors.border}` }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label
                  style={{
                    padding: '8px 16px', borderRadius: '8px', border: `1px solid ${colors.border}`,
                    background: colors.cardBg, color: colors.text, fontSize: '13px', fontWeight: 500,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  📁 Sfoglia...
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          updatePref('logoUrl', ev.target?.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
                {prefs.logoUrl && (
                  <button
                    type="button"
                    onClick={() => updatePref('logoUrl', '')}
                    style={{
                      padding: '8px 12px', borderRadius: '8px', border: 'none',
                      background: colors.danger + '15', color: colors.danger,
                      fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Rimuovi
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Password Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Cambia Password</div>
          <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {!isSupabaseAuth && (
              <input
                type="password"
                placeholder="Password attuale"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
                style={inputStyle}
              />
            )}
            <input
              type="password"
              placeholder="Nuova password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Conferma nuova password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
            {passwordMsg && (
              <div style={{
                padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                background: passwordMsg.type === 'success' ? colors.success + '20' : colors.danger + '20',
                color: passwordMsg.type === 'success' ? colors.success : colors.danger,
              }}>
                {passwordMsg.text}
              </div>
            )}
            <button
              type="submit"
              disabled={changingPw}
              style={{
                padding: '10px 20px', borderRadius: '10px', border: 'none',
                background: changingPw ? colors.textSecondary : colors.primary,
                color: '#fff', fontSize: '14px', fontWeight: 600,
                cursor: changingPw ? 'not-allowed' : 'pointer', alignSelf: 'flex-end',
              }}
            >
              {changingPw ? 'Salvataggio...' : 'Cambia Password'}
            </button>
          </form>
        </div>

        {/* Subscription Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Abbonamento</div>
          {subscriptionStatus === 'trial' && trialEndsAt && (
            <p style={{ color: colors.textSecondary, fontSize: '13px', marginBottom: '12px' }}>
              Periodo di prova attivo fino al {new Date(trialEndsAt).toLocaleDateString('it-IT')}
            </p>
          )}
          {(subscriptionStatus === 'trial' || subscriptionStatus === 'expired' || subscriptionStatus === 'past_due' || subscriptionStatus === 'canceled') ? (
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={subscriptionLoading}
              style={{
                width: '100%', padding: '12px 20px', borderRadius: '10px', border: 'none',
                background: colors.primary, color: '#fff', fontSize: '14px', fontWeight: 700,
                cursor: subscriptionLoading ? 'not-allowed' : 'pointer', opacity: subscriptionLoading ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              <CreditCard size={16} />
              {subscriptionLoading ? 'Attendere...' : `${subscriptionStatus === 'expired' ? 'Rinnova Abbonamento' : 'Abbonati'} - ${subscriptionPrice}€/mese`}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancelSubscription}
              disabled={subscriptionLoading}
              style={{
                width: '100%', padding: '12px 20px', borderRadius: '10px',
                border: `1px solid ${colors.danger}55`, background: 'transparent', color: colors.danger,
                fontSize: '14px', fontWeight: 700, cursor: subscriptionLoading ? 'not-allowed' : 'pointer',
                opacity: subscriptionLoading ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              <XCircle size={16} />
              {subscriptionLoading ? 'Attendere...' : 'Disdici Abbonamento'}
            </button>
          )}
          {subscriptionMsg && (
            <div style={{
              marginTop: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
              background: subscriptionMsg.type === 'success' ? colors.success + '20' : colors.danger + '20',
              color: subscriptionMsg.type === 'success' ? colors.success : colors.danger,
            }}>
              {subscriptionMsg.text}
            </div>
          )}
        </div>

        {/* Reset Schema Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>Tabelle Personalizzate</div>
          <p style={{ color: colors.textSecondary, fontSize: '13px', marginBottom: '16px' }}>
            {customTableCount > 0
              ? `Hai ${customTableCount} tabelle personalizzate create con l'AI o manualmente. Se qualcosa non funziona come previsto, puoi riportare l'app allo stato iniziale: verranno rimosse solo le tabelle personalizzate e i loro dati, le tabelle originali del gestionale (${'clienti, prodotti, ordini...'}) restano intatte.`
              : 'Non hai ancora creato tabelle personalizzate.'}
          </p>
          <button
            type="button"
            onClick={onResetSchema}
            disabled={resettingSchema || customTableCount === 0}
            style={{
              width: '100%', padding: '12px 20px', borderRadius: '10px',
              border: `1px solid ${colors.danger}55`, background: 'transparent', color: colors.danger,
              fontSize: '14px', fontWeight: 700,
              cursor: resettingSchema || customTableCount === 0 ? 'not-allowed' : 'pointer',
              opacity: resettingSchema || customTableCount === 0 ? 0.6 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <XCircle size={16} />
            {resettingSchema ? 'Ripristino...' : 'Ripristina stato iniziale'}
          </button>
        </div>

        {/* QR Code Section */}
        <div style={sectionBox}>
          <div style={sectionTitle}>QR Code Accesso</div>
          <p style={{ color: colors.textSecondary, fontSize: '13px', marginBottom: '16px' }}>
            Scansiona questo codice QR per accedere all'app da qualsiasi dispositivo
          </p>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            padding: '16px', 
            background: '#ffffff', 
            borderRadius: '12px',
            marginBottom: '12px'
          }}>
            <QRCodeCanvas 
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/a/${slug}`}
              size={160}
              level="M"
              includeMargin={false}
            />
          </div>
          <div style={{ 
            textAlign: 'center',
            padding: '12px',
            background: colors.cardBg,
            borderRadius: '8px',
            border: `1px solid ${colors.border}`
          }}>
            <a 
              href={`/a/${slug}`}
              style={{ 
                color: colors.primary, 
                fontSize: '14px', 
                fontWeight: 600,
                textDecoration: 'none',
                wordBreak: 'break-all'
              }}
            >
              {typeof window !== 'undefined' ? window.location.origin : ''}/a/{slug}
            </a>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          style={{
            width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
            background: colors.danger + '15', color: colors.danger,
            fontSize: '15px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.danger + '30'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.danger + '15'; }}
        >
          <LogOut size={18} /> Logout
        </button>
      </div>
    </div>
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

function LoginScreen({ slug, appName, logoUrl, primaryColor, onLogin }: LoginScreenProps) {
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
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0e1a', padding: '20px',
      }}
    >
      <div
        className="rounded-2xl"
        style={{
          background: '#1e293b', border: '1px solid #334155', padding: '40px',
          width: '100%', maxWidth: '400px', textAlign: 'center',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        {logoUrl && (
          <img src={logoUrl} alt={appName} style={{ height: '48px', marginBottom: '16px', objectFit: 'contain' }} />
        )}
        <h1 style={{ color: '#ffffff', fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>{appName}</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '28px' }}>Inserisci la password per accedere</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{
              width: '100%', padding: '12px 16px', borderRadius: '10px',
              border: '1px solid #334155', background: '#0f172a',
              color: '#ffffff', fontSize: '15px', outline: 'none',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
              background: '#ef444420', color: '#ef4444',
            }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px', borderRadius: '10px', border: 'none',
              background: loading ? '#64748b' : primaryColor,
              color: '#fff', fontSize: '15px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Verifica...' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main App Component ───────────────────────────────────────────────────────

function ViewerProFinal() {
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
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Record per relazioni tra tabelle
  const [clientiRecords, setClientiRecords] = useState<AppRecord[]>([]);
  const [prodottiRecords, setProdottiRecords] = useState<AppRecord[]>([]);
  const [ordiniRecords, setOrdiniRecords] = useState<AppRecord[]>([]);
  // Tabelle personalizzate create dall'utente
  const [customTables, setCustomTables] = useState<any[]>([]);
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
  
  const [customTablesLoading, setCustomTablesLoading] = useState(false);
  const [customRecords, setCustomRecords] = useState<any[]>([]);
  const [customRecordsLoading, setCustomRecordsLoading] = useState(false);
  const [showCreateCustomTable, setShowCreateCustomTable] = useState(false);
  const [creatingCustomTable, setCreatingCustomTable] = useState(false);
  const [showAITableModal, setShowAITableModal] = useState(false);
  const [aiTableGenerating, setAiTableGenerating] = useState(false);
  const [aiTableError, setAiTableError] = useState<string | null>(null);
  const [resettingSchema, setResettingSchema] = useState(false);
  const [customModalRecord, setCustomModalRecord] = useState<any | null | 'new'>(null);
  const [customSaving, setCustomSaving] = useState(false);
  // Edit table modal
  const [editTable, setEditTable] = useState<TableDef | null>(null);
  const [editTableSaving, setEditTableSaving] = useState(false);
  const [importazioniOpen, setImportazioniOpen] = useState(false);
  const [comunicazioniOpen, setComunicazioniOpen] = useState(false);

  const [prefs, setPrefs] = useState<UserPrefs>({
    layout: 'modern',
    theme: 'dark',
    primaryColor: '#6366f1',
    companyName: '',
    logoUrl: '',
  });

  // Derived values
  const appInfo = session?.appInfo;
  // L'appInfo ha struttura: { id, slug, name, config: { schema: { tables }, ... } }
  const config = appInfo;
  const innerConfig = config?.config;
  
  // Estrai tabelle da blueprint — cerca in config.config.schema.tables (la struttura reale)
  // e mantieni tutti i fallback per compatibilità
  const tables = innerConfig?.schema?.tables 
    || config?.schema?.tables 
    || innerConfig?.blueprint?.schema?.tables 
    || config?.blueprint?.schema?.tables 
    || innerConfig?.blueprint?.tables 
    || config?.blueprint?.tables 
    || innerConfig?.tables 
    || config?.tables 
    || [];
  
  console.log('[Viewer] Config:', config);
  console.log('[Viewer] Config keys:', config ? Object.keys(config) : 'null');
  console.log('[Viewer] innerConfig (config.config):', innerConfig);
  console.log('[Viewer] innerConfig keys:', innerConfig ? Object.keys(innerConfig) : 'null');
  console.log('[Viewer] innerConfig.schema:', innerConfig?.schema);
  console.log('[Viewer] Blueprint:', config?.blueprint);
  console.log('[Viewer] Tables found:', tables.length, tables);
  
  const activeTable = tables.find((t) => t.name === activeView) || null;
  const datiAziendaliTable = getDatiAziendaliTable(tables);

  const companyName = prefs.companyName
    || config?.branding?.company_name
    || config?.appName
    || 'App';

  const logoUrl = prefs.logoUrl
    || config?.branding?.logo_url
    || config?.logo
    || '';

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
    () => designTokensToThemeVars(designTokens, prefs.primaryColor || config?.branding?.primary_color || undefined),
    [designTokens, prefs.primaryColor, config?.branding?.primary_color]
  );
  const layoutCfg = LAYOUT_CONFIG[prefs.layout];

  // ─── Load preferences from localStorage ──────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem(prefsKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<UserPrefs>;
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
        setPrefs((prev) => ({
          ...prev,
          primaryColor: designTokens.colors.primary,
          theme: isColorDark(designTokens.colors.bg) ? 'dark' : 'light',
        }));
      }
    } catch { /* ignore */ }
  }, [sectorFromConfig, designTokens, prefsKey]);

  // ─── Save preferences to localStorage ────────────────────────────────────

  useEffect(() => {
    try {
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
    } catch { /* ignore */ }
  }, [prefs, prefsKey]);

  // ─── Registra service worker + manifest PWA dinamico ─────────────────────

  usePwaSetup(slug, designTokens.colors.primary);

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

  const loadRecords = useCallback(async (tableName: string, password: string, appId: string) => {
    setRecordsLoading(true);
    try {
      const res = await fetch(`/api/client/apps/${appId}/records?table=${tableName}`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) throw new Error('Failed to load records');
      const data = await res.json();
      const rawRecords: any[] = Array.isArray(data) ? data : data.records || data.data || [];
      // Il backend salva i campi dentro la colonna JSONB "data" (es. { id, data: { ragione_sociale, ... } }).
      // Appiattiamo qui la struttura in modo che DynamicDataTable/DynamicRecordModal
      // possano leggere i campi direttamente da record[fieldName] come si aspettano.
      const normalized = rawRecords.map((r) => ({
        id: r.id,
        ...(r.data || r),
      }));
      setRecords(normalized);
    } catch (err) {
      console.error('Error loading records:', err);
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, []);


  useEffect(() => {
    if (activeTable && session) {
      loadRecords(activeTable.name, getAuthToken(session), session.appInfo.id);
    } else {
      setRecords([]);
    }
    setSearchQuery('');
  }, [activeTable, session, loadRecords]);

  // ─── Load custom tables from backend ────────────────────────────────────

  const loadCustomTables = useCallback(async () => {
    if (!session) return;
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
    if (session) {
      loadCustomTables();
    } else {
      setCustomTables([]);
    }
  }, [session, loadCustomTables]);

  // ─── Load custom records when activeView is a custom table ──────────────

  const activeCustomTable = useMemo(() => {
    return customTables.find((t: any) => `custom_${t.name}` === activeView) || null;
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
    if (activeCustomTable && session) {
      loadCustomRecords(activeCustomTable.name);
    } else {
      setCustomRecords([]);
    }
    setSearchQuery('');
  }, [activeCustomTable, session, loadCustomRecords]);

  // ─── Custom table CRUD handlers ─────────────────────────────────────────

  const handleCreateCustomTable = useCallback(async (tableData: any) => {
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

  // Traduce una richiesta in linguaggio naturale in una tabella personalizzata
  // tramite /api/client/apps/{id}/schema (Groq + riuso della stessa API di
  // creazione usata da handleCreateCustomTable qui sopra).
  const handleGenerateAITable = useCallback(async (instruction: string) => {
    if (!session) return;
    setAiTableGenerating(true);
    setAiTableError(null);
    try {
      const res = await fetch(`/api/client/apps/${session.appInfo.id}/schema`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken(session)}`,
        },
        body: JSON.stringify({ instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Errore generazione tabella');
      }
      setShowAITableModal(false);
      await loadCustomTables();
    } catch (err) {
      setAiTableError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setAiTableGenerating(false);
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

  const handleUpdateRecord = useCallback(async (formData: Record<string, unknown>) => {
    if (!session || !activeTable || !modalRecord || modalRecord === 'new') return;
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

  const handleEditTableSave = useCallback(async (data: { name?: string; label?: string; labelPlural?: string; fields: any[] }) => {
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
      </>
    );
  }

  // ─── Main layout ────────────────────────────────────────────────────────

    return (
    <>
      <div id="app-root-container" style={{ display: 'flex', minHeight: '100vh', background: '#FAFAFA', transition: 'background 0.3s', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 15, transition: 'opacity 0.3s',
          }}
        />
      )}

      {/* Sidebar */}
      {(!isMobile || sidebarOpen) && (
        <aside
          className="w-[280px]"
          style={{
            background: '#FFFFFF',
            borderRight: '1px solid #F4F4F5',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            color: '#18181B',
            display: 'flex',
            flexDirection: 'column',
            transition: 'width 0.3s, transform 0.3s',
            position: 'relative',
            zIndex: 20,
            flexShrink: 0,
            // Mobile: off-canvas by default
            ...(isMobile ? {
              position: 'fixed',
              left: '0',
              top: 0,
              bottom: 0,
              width: '280px',
              boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
            } : {}),
          }}
        >
        {/* Logo */}
        <div style={{
          padding: '24px 20px', borderBottom: `1px solid rgba(255,255,255,0.2)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} style={{ height: '80px', width: '80px', borderRadius: '12px', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '80px', height: '80px', borderRadius: '12px',
              background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: '32px',
            }}>
              {companyName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Nav Items */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Dashboard */}
          <SidebarItem
            icon={<LayoutDashboard size={18} />}
            label="Dashboard"
            active={activeView === 'dashboard'}
            onClick={() => setActiveView('dashboard')}
            colors={colors}
            primaryColor={primaryColor}
          />

          {/* Tables fisse: di lavoro in cima, tabelle di sistema (Fatture, Dati Azienda) in fondo */}
          {sortTablesForSidebar(tables).map((table) => (
            <div key={table.name} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SidebarItem
                  icon={resolveIcon(table.icon, table.name)}
                  label={table.labelPlural}
                  active={activeView === table.name}
                  onClick={() => setActiveView(table.name)}
                  colors={colors}
                  primaryColor={primaryColor}
                />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditTable(table);
                }}
                title="Modifica tabella"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: 'none', borderRadius: '6px',
                  padding: '4px', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.7)',
                  display: 'flex', alignItems: 'center',
                  marginRight: '8px', flexShrink: 0,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
              >
                <Settings2 size={14} />
              </button>
            </div>
          ))}

          {/* Tabelle personalizzate */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid rgba(0,0,0,0.08)` }}>
            <div style={{ padding: '0 14px 8px', fontSize: '11px', fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Personalizzate
            </div>
            {customTables.map((ct: any) => (
              <SidebarItem
                key={`custom_${ct.name}`}
                icon={<LayoutDashboard size={18} />}
                label={ct.labelPlural || ct.label + 'i'}
                active={activeView === `custom_${ct.name}`}
                onClick={() => setActiveView(`custom_${ct.name}`)}
                colors={colors}
                primaryColor={primaryColor}
              />
            ))}
            <button
              onClick={() => setShowCreateCustomTable(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: 'rgba(0,0,0,0.04)', color: '#18181B',
                fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                width: '100%', justifyContent: 'center', marginTop: '4px',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
            >
              <Plus size={14} /> Nuova Tabella
            </button>
            <button
              onClick={() => { setAiTableError(null); setShowAITableModal(true); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: `${primaryColor}15`, color: primaryColor,
                fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                width: '100%', justifyContent: 'center', marginTop: '6px',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${primaryColor}25`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${primaryColor}15`; }}
            >
              <Sparkles size={14} /> Crea con AI
            </button>
          </div>

          {/* Comunicazioni - Collapsible */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid rgba(0,0,0,0.08)` }}>
            <button
              onClick={() => setComunicazioniOpen(!comunicazioniOpen)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: 'transparent', color: '#18181B',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                width: '100%', textTransform: 'uppercase',
                letterSpacing: '0.05em', transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <MessageSquare size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>Comunicazioni</span>
              <ChevronDown
                size={14}
                style={{
                  transform: comunicazioniOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              />
            </button>
            {comunicazioniOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                <SidebarItem
                  icon={<MessageSquare size={18} />}
                  label="Provider SDI"
                  active={false}
                  onClick={() => window.open('https://www.sdi.agenziaentrate.gov.it', '_blank')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<Mail size={18} />}
                  label="Email"
                  active={false}
                  onClick={() => window.open('https://mail.google.com', '_blank')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<MessageCircle size={18} />}
                  label="WhatsApp"
                  active={false}
                  onClick={() => window.open('https://wa.me/393331234567', '_blank')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
              </div>
            )}
          </div>

          {/* Importazioni - Collapsible */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid rgba(0,0,0,0.08)` }}>
            <button
              onClick={() => setImportazioniOpen(!importazioniOpen)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: 'transparent', color: '#18181B',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                width: '100%', textTransform: 'uppercase',
                letterSpacing: '0.05em', transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Upload size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>Importazioni</span>
              <ChevronDown 
                size={14} 
                style={{ 
                  transform: importazioniOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }} 
              />
            </button>
            {importazioniOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                <SidebarItem
                  icon={<Upload size={18} />}
                  label="Importa CSV"
                  active={activeView === 'import_csv'}
                  onClick={() => setActiveView('import_csv')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<Download size={18} />}
                  label="Esporta CSV"
                  active={activeView === 'export_csv'}
                  onClick={() => setActiveView('export_csv')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileText size={18} />}
                  label="Importa PDF"
                  active={activeView === 'import_pdf'}
                  onClick={() => setActiveView('import_pdf')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileText size={18} />}
                  label="Esporta PDF"
                  active={activeView === 'export_pdf'}
                  onClick={() => setActiveView('export_pdf')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileSpreadsheet size={18} />}
                  label="Importa Excel"
                  active={activeView === 'import_excel'}
                  onClick={() => setActiveView('import_excel')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileSpreadsheet size={18} />}
                  label="Esporta Excel"
                  active={activeView === 'export_excel'}
                  onClick={() => setActiveView('export_excel')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileIcon size={18} />}
                  label="Importa JSON"
                  active={activeView === 'import_json'}
                  onClick={() => setActiveView('import_json')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
                <SidebarItem
                  icon={<FileIcon size={18} />}
                  label="Esporta JSON"
                  active={activeView === 'export_json'}
                  onClick={() => setActiveView('export_json')}
                  colors={colors}
                  primaryColor={primaryColor}
                />
              </div>
            )}
          </div>
        </nav>

        {/* Bottom actions */}
        <div style={{ padding: '12px 10px', borderTop: `1px solid rgba(255,255,255,0.2)`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <SidebarItem
            icon={<Settings size={18} />}
            label="Impostazioni"
            active={false}
            onClick={() => setShowSettings(true)}
            colors={colors}
            primaryColor={primaryColor}
          />
          {datiAziendaliTable && (
            <SidebarItem
              icon={resolveIcon(datiAziendaliTable.icon, datiAziendaliTable.name)}
              label={datiAziendaliTable.labelPlural}
              active={activeView === datiAziendaliTable.name}
              onClick={() => setActiveView(datiAziendaliTable.name)}
              colors={colors}
              primaryColor={primaryColor}
            />
          )}
          <SidebarItem
            icon={<LogOut size={18} />}
            label="Logout"
            active={false}
            onClick={handleLogout}
            colors={colors}
            primaryColor={colors.danger}
          />
        </div>

        {/* Brand Footer */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid rgba(255,255,255,0.2)`, textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px', fontWeight: 600, margin: 0 }}>
            ZeusX <span style={{ color: 'rgba(255,255,255,0.6)' }}>by</span> <span style={{ color: '#ffffff', fontWeight: 700 }}>MUSINO</span>
          </p>
        </div>
      </aside>
      )}

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar (mobile toggle) */}
        <header style={{
          padding: '16px 24px', borderBottom: `2px solid ${colors.primary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: colors.cardBg,
          position: 'relative',
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: colors.textSecondary, padding: '4px',
              display: 'block',
              position: 'absolute',
              left: '24px',
            }}
          >
            <Menu size={22} />
          </button>
          <div style={{ color: colors.text, fontSize: '16px', fontWeight: 700 }}>
            {activeView === 'dashboard' ? companyName : activeTable?.labelPlural || activeCustomTable?.labelPlural || (activeView.startsWith('import_') || activeView.startsWith('export_') ? getViewLabel(activeView) : companyName)}
          </div>
          <div style={{ position: 'absolute', right: '24px' }}>
            <FullscreenToggle color={colors.textSecondary} />
          </div>
        </header>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: prefs.layout === 'corporate' ? '32px' : prefs.layout === 'modern' ? '24px' : '16px' }}>
            {activeView === 'dashboard' ? (
              <Dashboard
                colors={colors}
                radius={layoutCfg.radius}
                shadow={layoutCfg.shadow}
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

      {/* AI Table Modal */}
      {showAITableModal && (
        <AITableModal
          onGenerate={handleGenerateAITable}
          onClose={() => setShowAITableModal(false)}
          generating={aiTableGenerating}
          error={aiTableError}
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
    </>
  );
}

// ─── ImportExportPanel Component ─────────────────────────────────────────────

interface ImportExportPanelProps {
  view: string;
  colors: ReturnType<typeof getThemeVars>;
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

// ─── SidebarItem Component ────────────────────────────────────────────────────

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  colors: ReturnType<typeof getThemeVars>;
  primaryColor: string;
}

function SidebarItem({ icon, label, active, onClick, colors, primaryColor }: SidebarItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px', borderRadius: '8px', border: 'none',
        background: active
          ? '#EFF6FF'
          : hovered
            ? '#F4F4F5'
            : 'transparent',
        color: active ? '#2563EB' : '#18181B',
        fontSize: '14px', fontWeight: active ? 600 : 500,
        cursor: 'pointer', width: '100%', textAlign: 'left',
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: '2px', height: '20px', borderRadius: '0 2px 2px 0',
          background: '#2563EB',
        }} />
      )}
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

// ─── Entry point della route /a/[slug]/app ─────────────────────────────────
// Comandi AI (app_type='comandi_ai', vedi provisionComandiAppAction) ha uno
// schema fisso e una console operativa dedicata: salta interamente il motore
// a tabelle dinamiche generato dall'AI (ViewerProFinal), che resta invariato
// per tutte le altre app.
export default function AppPage() {
  const appInfo = useAppInfo();

  if (appInfo.appType === 'comandi_ai') {
    return (
      <ComandiOperativeConsole
        className="min-h-screen bg-gray-950 py-8 px-4"
        unauthenticatedRedirect={`/a/${appInfo.slug}/login`}
        instanceSlug={appInfo.slug}
      />
    );
  }

  return <ViewerProFinal />;
}
