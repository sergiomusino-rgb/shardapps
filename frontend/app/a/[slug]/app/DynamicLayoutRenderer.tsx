'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Package, ShoppingCart, Database,
  Settings, LogOut, Search, Plus, Pencil, Trash2, X,
  Download, Upload, MessageSquare, Mail, MessageCircle,
  Settings2, Heart, Receipt, ExternalLink
} from 'lucide-react';
import { TableDef, TableAction, fieldName, sortTablesForSidebar, getDatiAziendaliTable, findDisplayPriceField, isRestaurantMenuGridTable } from './table-definitions';
import { DesignComponent } from './DesignParser';
import { getDesignTokens, type DesignTokens } from '@/lib/designTokens';
import { resolveIcon } from './iconResolver';
import { getPlaceholderCategoryForTable, getPlaceholderImageUrl } from '@/lib/recordPlaceholderImages';
import { renderCellValue } from './cellRenderers';
import { Sheet } from '@/components/ui/sheet';
import AppTopBar from './AppTopBar';
import { tenantThemeVars } from './tenant-theme';
import { NavItem, SectionLabel, CollapsibleSection, SidebarLogo, SidebarBrandFooter, type SidebarCustomTable } from './sidebar-primitives';

// ─── Props Interface ───────────────────────────────────────────────────────

interface DynamicLayoutRendererProps {
  layoutType: 'docs' | 'ecommerce' | 'saas' | 'recipe' | 'restaurant' | 'custom';
  primaryColor: string;
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  companyName: string;
  logoUrl: string;
  /** White label piano Business: sostituisce logo+testo ShardApps nel footer sidebar. */
  footerLogoUrl?: string;
  footerLabel?: string;
  /** Slug del tenant, per il link "Fatture e Ricevute" (route standalone). */
  slug: string;
  tables: TableDef[];
  activeView: string;
  setActiveView: (view: string) => void;
  onLogout: () => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  /** Fase 4: "Gestione Team" — assente = nessuna voce in più in sidebar
   * (page.tsx la passa solo per admin di un'app auth_mode='rbac'). */
  onOpenUserManagement?: () => void;
  session?: any;
  customTables?: any[];
  activeCustomTable?: any;
  records?: any[];
  recordsLoading?: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  /** Esegue un'azione di entità (table.actions, Fase 3/4) su un record. */
  onExecuteAction?: (recordId: string, actionId: string) => void;
  loadRecords?: (tableName: string) => void;
  designComponents?: DesignComponent[];
  onEditTable?: (table: TableDef) => void;
}

// ─── Fase 4: azioni di entità visibili per un record ────────────────────────
// Stessa identica logica di getVisibleActions in DynamicDataTable.tsx
// (duplicata qui invece che importata: DynamicLayoutRenderer non importa mai
// da DynamicDataTable, sono due renderer alternativi dello stesso pannello,
// non uno wrapper dell'altro) — filtra table.actions per ruolo (requiredRole)
// e, per le change_state, per la transizione ammessa dallo stato corrente.
function getVisibleTableActions(table: TableDef, record: Record<string, unknown>, role?: string): TableAction[] {
  if (!table.actions?.length || role === 'viewer') return [];
  const stateField = table.fields.find((f) => f.type === 'state');
  const currentState = stateField ? String(record[stateField.name] ?? '') : undefined;
  return table.actions.filter((action) => {
    if (action.requiredRole === 'admin' && role && role !== 'admin') return false;
    if (action.type !== 'change_state') return true;
    if (!stateField || !action.targetState) return false;
    const allowed = stateField.allowedTransitions;
    if (!allowed || !currentState || !allowed[currentState]) return true;
    return allowed[currentState].includes(action.targetState);
  });
}

// ─── Theme Helpers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- mai chiamata direttamente, ma il suo ReturnType e' il tipo di `colors` in tutte le props dei componenti di layout sotto (7 punti).
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

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DynamicLayoutRenderer({
  layoutType,
  primaryColor,
  colors,
  designTokens = getDesignTokens(),
  companyName,
  logoUrl,
  footerLogoUrl,
  footerLabel,
  slug,
  tables,
  activeView,
  setActiveView,
  onLogout,
  setShowSettings,
  onOpenUserManagement,
  customTables = [],
  activeCustomTable,
  records = [],
  recordsLoading = false,
  searchQuery,
  setSearchQuery,
  onEdit,
  onDelete,
  onAddNew,
  onExecuteAction,
  loadRecords,
  designComponents = [],
  onEditTable,
  session,
}: DynamicLayoutRendererProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [importazioniOpen, setImportazioniOpen] = useState(false);
  const [comunicazioniOpen, setComunicazioniOpen] = useState(false);
  // Fase 4: ruolo dell'utente loggato (già disponibile via `session`, non
  // serviva una prop dedicata) — 'viewer' nasconde Nuovo/Modifica/Elimina
  // nei layout sotto che renderizzano CRUD diretto (Docs, SaaS/default).
  const role: string | undefined = session?.role;

  const activeTable = tables.find((t) => t.name === activeView) || null;
  const activeCustomTableData = customTables.find((t: any) => `custom_${t.name}` === activeView) || null;
  const datiAziendaliTable = getDatiAziendaliTable(tables);

  // Detect mobile
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

  const getViewLabel = (view: string): string => {
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
  };


  const handleTableClick = (tableName: string) => {
    setActiveView(tableName);
    if (loadRecords) {
      loadRecords(tableName);
    }
  };

  // Render based on layout type
  const renderContent = () => {
    switch (layoutType) {
      case 'docs':
        return (
          <DocsLayoutContent
            companyName={companyName}
            tables={tables}
            colors={colors}
            designTokens={designTokens}
            primaryColor={primaryColor}
            activeView={activeView}
            setActiveView={setActiveView}
            activeTable={activeTable}
            activeCustomTableData={activeCustomTableData}
            records={records}
            loading={recordsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddNew={onAddNew}
            onExecuteAction={onExecuteAction}
            role={role}
            designComponents={designComponents}
          />
        );
      case 'ecommerce':
        return (
          <EcommerceLayoutContent
            companyName={companyName}
            tables={tables}
            colors={colors}
            designTokens={designTokens}
            primaryColor={primaryColor}
            activeView={activeView}
            setActiveView={setActiveView}
            activeTable={activeTable}
            activeCustomTableData={activeCustomTableData}
            records={records}
            loading={recordsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddNew={onAddNew}
          />
        );
      case 'recipe':
        return (
          <RecipeLayoutContent
            companyName={companyName}
            tables={tables}
            colors={colors}
            designTokens={designTokens}
            primaryColor={primaryColor}
            activeView={activeView}
            activeTable={activeTable}
            records={records}
            loading={recordsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddNew={onAddNew}
          />
        );
      case 'restaurant':
        return (
          <RestaurantLayoutContent
            companyName={companyName}
            tables={tables}
            colors={colors}
            designTokens={designTokens}
            primaryColor={primaryColor}
            activeView={activeView}
            activeTable={activeTable}
            records={records}
            loading={recordsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddNew={onAddNew}
          />
        );
      default:
        return (
          <SaaSLayoutContent
            companyName={companyName}
            tables={tables}
            colors={colors}
            designTokens={designTokens}
            primaryColor={primaryColor}
            activeView={activeView}
            setActiveView={setActiveView}
            activeTable={activeTable}
            activeCustomTableData={activeCustomTableData}
            records={records}
            loading={recordsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddNew={onAddNew}
            onExecuteAction={onExecuteAction}
            role={role}
          />
        );
    }
  };

  const pageTitle = activeView === 'dashboard'
    ? 'Dashboard'
    : activeTable?.labelPlural || activeCustomTable?.labelPlural || (activeView.startsWith('import_') || activeView.startsWith('export_') ? getViewLabel(activeView) : companyName);

  return (
    <div
      className="flex h-full bg-tenant-bg"
      style={{ ...tenantThemeVars(colors), fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={(v) => !v && setSidebarOpen(false)}>
          <LayoutSidebar
            tables={tables}
            customTables={customTables}
            activeView={activeView}
            onNavigate={handleTableClick}
            onNavigateView={setActiveView}
            datiAziendaliTable={datiAziendaliTable}
            onEditTable={onEditTable}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUserManagement={onOpenUserManagement}
            onLogout={onLogout}
            logoUrl={logoUrl}
            companyName={companyName}
            footerLogoUrl={footerLogoUrl}
            footerLabel={footerLabel}
            slug={slug}
            comunicazioniOpen={comunicazioniOpen}
            onToggleComunicazioni={() => setComunicazioniOpen((v) => !v)}
            importazioniOpen={importazioniOpen}
            onToggleImportazioni={() => setImportazioniOpen((v) => !v)}
          />
        </Sheet>
      ) : (
        <aside className="h-full w-[280px] shrink-0 border-r border-tenant-sidebar-text/10">
          <LayoutSidebar
            tables={tables}
            customTables={customTables}
            activeView={activeView}
            onNavigate={handleTableClick}
            onNavigateView={setActiveView}
            datiAziendaliTable={datiAziendaliTable}
            onEditTable={onEditTable}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUserManagement={onOpenUserManagement}
            onLogout={onLogout}
            logoUrl={logoUrl}
            companyName={companyName}
            footerLogoUrl={footerLogoUrl}
            footerLabel={footerLabel}
            slug={slug}
            comunicazioniOpen={comunicazioniOpen}
            onToggleComunicazioni={() => setComunicazioniOpen((v) => !v)}
            importazioniOpen={importazioniOpen}
            onToggleImportazioni={() => setImportazioniOpen((v) => !v)}
          />
        </aside>
      )}

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopBar
          title={pageTitle}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          showMenuToggle={isMobile}
        />

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

// ─── Sidebar Component (layout di settore) ───────────────────────────────────
// Stesso linguaggio visivo di ViewerSidebar (layout generico), stesso set di
// funzioni: qui non ci sono creazione tabelle personalizzate/AI e l'elenco
// import/export resta volutamente ridotto (solo CSV), invariato rispetto a
// prima — nessuna funzionalità aggiunta, solo restyling.
interface LayoutSidebarProps {
  tables: TableDef[];
  customTables: SidebarCustomTable[];
  activeView: string;
  onNavigate: (tableName: string) => void;
  onNavigateView: (view: string) => void;
  datiAziendaliTable: TableDef | null | undefined;
  onEditTable?: (table: TableDef) => void;
  onOpenSettings: () => void;
  /** Fase 4: "Gestione Team" — assente = nessuna voce in più (comportamento invariato). */
  onOpenUserManagement?: () => void;
  onLogout: () => void;
  logoUrl: string;
  companyName: string;
  footerLogoUrl?: string;
  footerLabel?: string;
  slug: string;
  comunicazioniOpen: boolean;
  onToggleComunicazioni: () => void;
  importazioniOpen: boolean;
  onToggleImportazioni: () => void;
}

function LayoutSidebar({
  tables, customTables, activeView, onNavigate, onNavigateView, datiAziendaliTable,
  onEditTable, onOpenSettings, onOpenUserManagement, onLogout, logoUrl, companyName, footerLogoUrl, footerLabel, slug,
  comunicazioniOpen, onToggleComunicazioni, importazioniOpen, onToggleImportazioni,
}: LayoutSidebarProps) {
  return (
    <div className="flex h-full flex-col bg-tenant-sidebar-bg text-tenant-sidebar-text">
      <SidebarLogo logoUrl={logoUrl} companyName={companyName} />

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <NavItem
          icon={<LayoutDashboard size={18} />}
          label="Dashboard"
          active={activeView === 'dashboard'}
          onClick={() => onNavigateView('dashboard')}
        />

        {sortTablesForSidebar(tables).map((table) => (
          <NavItem
            key={table.name}
            icon={resolveIcon(table.icon || '', table.name)}
            label={table.labelPlural}
            active={activeView === table.name}
            onClick={() => onNavigate(table.name)}
            trailing={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTable?.(table);
                }}
                title="Modifica tabella"
                className="shrink-0 rounded-lg p-1.5 text-tenant-sidebar-text/40 transition-colors hover:bg-tenant-sidebar-hover hover:text-tenant-sidebar-text"
              >
                <Settings2 size={14} />
              </button>
            }
          />
        ))}

        <SectionLabel>Personalizzate</SectionLabel>
        {customTables?.map((ct) => (
          <NavItem
            key={`custom_${ct.name}`}
            icon={<LayoutDashboard size={18} />}
            label={ct.labelPlural || `${ct.label}i`}
            active={activeView === `custom_${ct.name}`}
            onClick={() => onNavigateView(`custom_${ct.name}`)}
          />
        ))}

        <CollapsibleSection
          icon={<MessageSquare size={14} />}
          label="Comunicazioni"
          open={comunicazioniOpen}
          onToggle={onToggleComunicazioni}
        >
          <NavItem icon={<MessageCircle size={18} />} label="WhatsApp" active={false} onClick={() => window.open('https://wa.me/393331234567', '_blank')} />
          <NavItem icon={<MessageSquare size={18} />} label="Provider SDI" active={false} onClick={() => window.open('https://www.sdi.agenziaentrate.gov.it', '_blank')} />
          <NavItem icon={<Mail size={18} />} label="Email" active={false} onClick={() => window.open('https://mail.google.com', '_blank')} />
        </CollapsibleSection>

        <CollapsibleSection
          icon={<Upload size={14} />}
          label="Importazioni"
          open={importazioniOpen}
          onToggle={onToggleImportazioni}
        >
          <NavItem icon={<Upload size={18} />} label="Importa CSV" active={activeView === 'import_csv'} onClick={() => onNavigateView('import_csv')} />
          <NavItem icon={<Download size={18} />} label="Esporta CSV" active={activeView === 'export_csv'} onClick={() => onNavigateView('export_csv')} />
        </CollapsibleSection>
      </nav>

      {/* Bottom actions */}
      <div className="flex flex-col gap-0.5 border-t border-tenant-sidebar-text/10 px-2.5 py-3">
        <NavItem
          icon={<Receipt size={18} />}
          label="Fatture e Ricevute"
          active={false}
          onClick={() => { window.location.href = `/a/${slug}/fatture`; }}
        />
        {onOpenUserManagement && (
          <NavItem icon={<Users size={18} />} label="Gestione Team" active={false} onClick={onOpenUserManagement} />
        )}
        <NavItem icon={<Settings size={18} />} label="Impostazioni" active={false} onClick={onOpenSettings} />
        <NavItem
          icon={<ExternalLink size={18} />}
          label="Vedi il sito pubblico"
          active={false}
          onClick={() => { window.location.href = `/a/${slug}`; }}
        />
        {datiAziendaliTable && (
          <NavItem
            icon={resolveIcon(datiAziendaliTable.icon || '', datiAziendaliTable.name)}
            label={datiAziendaliTable.labelPlural}
            active={activeView === datiAziendaliTable.name}
            onClick={() => onNavigate(datiAziendaliTable.name)}
          />
        )}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-tenant-danger transition-colors hover:bg-tenant-danger/10"
        >
          <LogOut size={18} /> Logout
        </button>
      </div>

      <SidebarBrandFooter logoUrl={footerLogoUrl} label={footerLabel} />
    </div>
  );
}

// ─── Docs Layout Content Component ───────────────────────────────────────────

interface DocsLayoutContentProps {
  companyName: string;
  tables: TableDef[];
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  primaryColor: string;
  activeView: string;
  setActiveView: (view: string) => void;
  activeTable: TableDef | null;
  activeCustomTableData: any;
  records: any[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  onExecuteAction?: (recordId: string, actionId: string) => void;
  role?: string;
  designComponents: DesignComponent[];
}

function DocsLayoutContent({
  companyName, tables, colors, designTokens = getDesignTokens(), primaryColor,
  activeView, setActiveView, activeTable,
  records, loading, searchQuery, setSearchQuery,
  onEdit, onDelete, onAddNew, onExecuteAction, role
}: DocsLayoutContentProps) {
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const appEl = document.querySelector('[data-app-id]');
        if (!appEl) return;
        const appId = appEl.getAttribute('data-app-id');
        const password = appEl.getAttribute('data-password');
        if (!appId || !password) return;

        let total = 0;
        for (const table of tables) {
          try {
            const res = await fetch(`/api/client/apps/${appId}/records?table=${table.name}`, {
              headers: { Authorization: `Bearer ${password}` },
            });
            if (res.ok) {
              const data = await res.json();
              const recs: any[] = Array.isArray(data) ? data : data.records || data.data || [];
              total += recs.length;
            }
          } catch { /* skip table */ }
        }
        setTotalRecords(total);
      } catch { /* ignore */ }
    }
    loadDashboardData();
  }, [tables]);

  if (activeView === 'dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '28px', fontWeight: 700, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: '14px', marginTop: '4px' }}>
            Overview {companyName}
          </p>
        </div>

        {tables.length === 0 ? (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #F4F4F5',
              borderRadius: '8px',
              padding: '60px 40px',
              textAlign: 'center',
            }}
          >
            <LayoutDashboard size={48} style={{ color: primaryColor, marginBottom: '16px' }} />
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '22px', fontWeight: 700, margin: '0 0 12px 0' }}>
              Benvenuto in {companyName}!
            </h2>
            <p style={{ color: colors.textSecondary, fontSize: '14px', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>
              La tua app è pronta per essere utilizzata. Crea tabelle e record per iniziare a gestire i tuoi dati.
            </p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              <KpiCard
                title="Sezioni attive"
                value={String(tables.length)}
                icon={<LayoutDashboard size={22} />}
                colors={colors}
                designTokens={designTokens}
              />
              <KpiCard
                title="Record Totali"
                value={String(totalRecords)}
                icon={<Database size={22} />}
                colors={colors}
                designTokens={designTokens}
              />
            </div>

            {/* Panoramica sezioni: nomi reali delle entità, mai la parola generica "Tabelle" */}
            <div
              style={{
                background: designTokens.colors['card-bg'] || '#FFFFFF',
                border: `1px solid ${designTokens.colors['border'] || '#F4F4F5'}`,
                borderRadius: designTokens.radii['lg'] || '12px',
                padding: '24px',
                boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
              }}
            >
              <h3 style={{ fontFamily: designTokens.fonts.headline, color: designTokens.colors['text'] || '#18181B', fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0' }}>
                Le tue sezioni
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tables.map((table) => (
                  <div
                    key={table.name}
                    onClick={() => setActiveView(table.name)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderRadius: designTokens.radii['md'] || '8px',
                      background: designTokens.colors['card-bg-alt'] || '#FAFAFA',
                      border: `1px solid ${designTokens.colors['border-light'] || '#F4F4F5'}`,
                      cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(16,24,40,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: '36px', height: '36px', borderRadius: designTokens.radii['md'] || '8px',
                        background: `${designTokens.colors['primary'] || primaryColor}1A`,
                        color: designTokens.colors['primary'] || primaryColor,
                      }}>
                        {resolveIcon(table.icon || '', table.name)}
                      </div>
                      <span style={{ fontFamily: designTokens.fonts.headline, color: designTokens.colors['text'] || '#18181B', fontSize: '14px', fontWeight: 600 }}>
                        {table.labelPlural || table.label}
                      </span>
                    </div>
                    <span style={{ color: designTokens.colors['text-secondary'] || colors.textSecondary, fontFamily: designTokens.fonts.body, fontSize: '13px' }}>
                      {table.fields?.length || 0} campi
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Table view
  if (activeTable) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ color: colors.text, fontSize: '24px', fontWeight: 700, margin: 0 }}>
              {activeTable.labelPlural}
            </h2>
            {activeTable.color && (
              <div style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: activeTable.color,
              }} />
            )}
          </div>
          {/* Fase 4: nascosto per il ruolo 'viewer' (sola lettura) — invece
              di lasciare che l'utente scopra il blocco solo al submit. */}
          {role !== 'viewer' && (
            <button
              onClick={onAddNew}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '10px', border: 'none',
                background: primaryColor, color: '#fff', fontSize: '14px',
                fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <Plus size={16} /> Nuovo
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
              background: designTokens.colors['card-bg'] || colors.cardBg,
              border: `1px solid ${designTokens.colors['border'] || colors.border}`,
              borderRadius: designTokens.radii['md'] || '10px',
              padding: '10px 16px',
            }}
          >
            <Search size={18} style={{ color: colors.textSecondary }} />
            <input
              type="text"
              placeholder={`Cerca in ${activeTable.labelPlural}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                color: colors.text, fontSize: '14px',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: '2px' }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div
          style={{
            background: designTokens.colors['card-bg'] || colors.cardBg,
            border: `1px solid ${designTokens.colors['border'] || colors.border}`,
            borderRadius: designTokens.radii['lg'] || '12px',
            boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr style={{ background: colors.cardBgAlt }}>
                  {activeTable.fields.map((field) => (
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
                      {field.required && (
                        <span style={{ color: colors.danger, marginLeft: '2px' }}>*</span>
                      )}
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
                      colSpan={(activeTable.fields?.length || 0) + 1}
                      style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}
                    >
                      Caricamento records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={(activeTable.fields?.length || 0) + 1}
                      style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}
                    >
                      {searchQuery ? 'Nessun risultato per la ricerca' : 'Nessun record presente'}
                    </td>
                  </tr>
                ) : (
                  records.map((record, idx) => (
                    <tr
                      key={record.id || idx}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = colors.cardBgAlt; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {activeTable.fields.map((field) => (
                        <td
                          key={fieldName(field)}
                          style={{
                            padding: '12px 16px', color: colors.text,
                            fontSize: '14px', whiteSpace: 'nowrap',
                            maxWidth: '200px', overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {renderCellValue(record, fieldName(field), field.type)}
                        </td>
                      ))}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
                          {/* Fase 3/4: azioni di entità (cambio stato ecc.), filtrate per ruolo/transizione. */}
                          {(activeTable ? getVisibleTableActions(activeTable, record, role) : []).map((action) => (
                            <button
                              key={action.id}
                              onClick={() => onExecuteAction?.(String(record.id), action.id)}
                              title={action.label}
                              style={{
                                background: colors.cardBgAlt, border: `1px solid ${colors.border}`,
                                borderRadius: '8px', padding: '6px 10px', cursor: 'pointer',
                                color: colors.text, fontSize: '12px', fontWeight: 600,
                              }}
                            >
                              {action.label}
                            </button>
                          ))}
                          {/* Fase 4: nascosti per il ruolo 'viewer' (sola lettura). */}
                          {role !== 'viewer' && (
                            <>
                              <button
                                onClick={() => onEdit(record)}
                                title="Modifica"
                                style={{
                                  background: primaryColor + '20', border: 'none',
                                  borderRadius: '8px', padding: '6px', cursor: 'pointer',
                                  color: primaryColor, display: 'flex', alignItems: 'center',
                                  transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = primaryColor + '40'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = primaryColor + '20'; }}
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
                            </>
                          )}
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
              {records.length} record
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Default: show placeholder
  return (
    <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
      Seleziona una voce dal menu
    </div>
  );
}

// ─── KPI Card Component ───────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
}

function KpiCard({ title, value, icon, colors, designTokens = getDesignTokens() }: KpiCardProps) {
  return (
    <div
      style={{
        background: designTokens.colors['card-bg'] || colors.cardBg,
        border: `1px solid ${designTokens.colors['border'] || colors.border}`,
        borderRadius: designTokens.radii['lg'] || '12px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(16,24,40,0.06), 0 8px 20px rgba(16,24,40,0.10)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: designTokens.colors['text-secondary'] || colors.textSecondary, fontFamily: designTokens.fonts.body, fontSize: '14px', fontWeight: 500 }}>{title}</span>
        <div style={{ color: designTokens.colors['primary'] || colors.primary, opacity: 0.85 }}>{icon}</div>
      </div>
      <span style={{ color: designTokens.colors['text'] || colors.text, fontFamily: designTokens.fonts.headline, fontSize: '28px', fontWeight: 700 }}>{value}</span>
    </div>
  );
}

// ─── E-commerce Layout Content Component ────────────────────────────────────

interface EcommerceLayoutContentProps {
  companyName: string;
  tables: TableDef[];
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  primaryColor: string;
  activeView: string;
  setActiveView: (view: string) => void;
  activeTable: TableDef | null;
  activeCustomTableData: any;
  records: any[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
}

function EcommerceLayoutContent({
  tables, colors, primaryColor,
  activeView, activeTable,
  records
}: EcommerceLayoutContentProps) {
  // E-commerce specific layout with product grid
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '28px', fontWeight: 700, margin: 0 }}>
          {activeView === 'dashboard' ? 'Dashboard' : activeTable?.labelPlural || 'Prodotti'}
        </h1>
      </div>

      {activeView === 'dashboard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          <KpiCard
            title="Prodotti"
            value={String(tables.find(t => t.name === 'prodotti') ? records.length : 0)}
            icon={<Package size={22} />}
            colors={colors}
          />
          <KpiCard
            title="Ordini"
            value={String(tables.find(t => t.name === 'ordini') ? records.length : 0)}
            icon={<ShoppingCart size={22} />}
            colors={colors}
          />
          <KpiCard
            title="Clienti"
            value={String(tables.find(t => t.name === 'clienti') ? records.length : 0)}
            icon={<Users size={22} />}
            colors={colors}
          />
        </div>
      ) : activeTable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                style={{
                  padding: '8px 12px', borderRadius: '8px',
                  border: `1px solid ${colors.border}`, background: colors.cardBg,
                  color: colors.text, fontSize: '13px',
                }}
              >
                <option>Tutte le categorie</option>
                <option>Prodotti</option>
                <option>Ordini</option>
                <option>Clienti</option>
              </select>
            </div>
          </div>

          {/* Product Grid: foto (reale se presente, altrimenti placeholder
              contestuale) invece di semplici caselle di testo */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '20px',
          }}>
            {(() => {
              const imageField = activeTable.fields.find((f) => f.type === 'image');
              const priceField = findDisplayPriceField(activeTable.fields);
              const category = getPlaceholderCategoryForTable(activeTable.name) || 'prodotti';

              return records.slice(0, 12).map((record) => {
                const realImage = imageField ? (record.data?.[fieldName(imageField)] as string | undefined) : undefined;
                const imageUrl = realImage || getPlaceholderImageUrl(category, String(record.id));
                const priceVal = priceField ? record.data?.[fieldName(priceField)] : undefined;
                const priceNum = priceVal != null && priceVal !== '' ? Number(priceVal) : NaN;

                return (
                  <div
                    key={record.id}
                    style={{
                      background: colors.cardBg,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '12px',
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '4 / 3', position: 'relative' }}>
                      <img src={imageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {activeTable.color && (
                        <span style={{
                          position: 'absolute', top: '8px', left: '8px',
                          width: '8px', height: '8px', borderRadius: '50%',
                          background: activeTable.color, boxShadow: '0 0 0 2px rgba(255,255,255,0.8)',
                        }} />
                      )}
                    </div>
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                      <h3 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, margin: 0 }}>
                        {record.data?.[fieldName(activeTable.fields[0])] || record.id}
                      </h3>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {activeTable.fields.slice(1, 4).map((field) => {
                          if (field === priceField || field === imageField) return null;
                          const val = record.data?.[fieldName(field)];
                          if (!val) return null;
                          return (
                            <span
                              key={fieldName(field)}
                              style={{
                                padding: '2px 8px', borderRadius: '4px',
                                background: primaryColor + '15', color: primaryColor,
                                fontSize: '11px', fontWeight: 600,
                              }}
                            >
                              {String(val)}
                            </span>
                          );
                        })}
                      </div>
                      {!isNaN(priceNum) && (
                        <div style={{ marginTop: 'auto', paddingTop: '4px', fontSize: '18px', fontWeight: 800, color: primaryColor }}>
                          {priceNum.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      ) : (
        <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
          Seleziona una tabella per iniziare
        </div>
      )}
    </div>
  );
}

// ─── SaaS Layout Content Component ───────────────────────────────────────────

interface SaaSLayoutContentProps {
  companyName: string;
  tables: TableDef[];
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  primaryColor: string;
  activeView: string;
  setActiveView: (view: string) => void;
  activeTable: TableDef | null;
  activeCustomTableData: any;
  records: any[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  onExecuteAction?: (recordId: string, actionId: string) => void;
  role?: string;
}

function SaaSLayoutContent({
  companyName, tables, colors, designTokens = getDesignTokens(), primaryColor,
  activeView, setActiveView, activeTable,
  records, loading, searchQuery, setSearchQuery,
  onEdit, onDelete, onAddNew, onExecuteAction, role
}: SaaSLayoutContentProps) {
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const appEl = document.querySelector('[data-app-id]');
        if (!appEl) return;
        const appId = appEl.getAttribute('data-app-id');
        const password = appEl.getAttribute('data-password');
        if (!appId || !password) return;

        let total = 0;
        for (const table of tables) {
          try {
            const res = await fetch(`/api/client/apps/${appId}/records?table=${table.name}`, {
              headers: { Authorization: `Bearer ${password}` },
            });
            if (res.ok) {
              const data = await res.json();
              const recs: any[] = Array.isArray(data) ? data : data.records || data.data || [];
              total += recs.length;
            }
          } catch { /* skip table */ }
        }
        setTotalRecords(total);
      } catch { /* ignore */ }
    }
    loadDashboardData();
  }, [tables]);

  if (activeView === 'dashboard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '28px', fontWeight: 700, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: '14px', marginTop: '4px' }}>
            Overview {companyName}
          </p>
        </div>

        {tables.length === 0 ? (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #F4F4F5',
              borderRadius: '8px',
              padding: '60px 40px',
              textAlign: 'center',
            }}
          >
            <LayoutDashboard size={48} style={{ color: primaryColor, marginBottom: '16px' }} />
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '22px', fontWeight: 700, margin: '0 0 12px 0' }}>
              Benvenuto in {companyName}!
            </h2>
            <p style={{ color: colors.textSecondary, fontSize: '14px', lineHeight: 1.6, maxWidth: '500px', margin: '0 auto' }}>
              La tua app è pronta per essere utilizzata. Crea tabelle e record per iniziare a gestire i tuoi dati.
            </p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              <KpiCard
                title="Sezioni attive"
                value={String(tables.length)}
                icon={<LayoutDashboard size={22} />}
                colors={colors}
                designTokens={designTokens}
              />
              <KpiCard
                title="Record Totali"
                value={String(totalRecords)}
                icon={<Database size={22} />}
                colors={colors}
                designTokens={designTokens}
              />
            </div>

            {/* Panoramica sezioni: nomi reali delle entità, mai la parola generica "Tabelle" */}
            <div
              style={{
                background: designTokens.colors['card-bg'] || '#FFFFFF',
                border: `1px solid ${designTokens.colors['border'] || '#F4F4F5'}`,
                borderRadius: designTokens.radii['lg'] || '12px',
                padding: '24px',
                boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
              }}
            >
              <h3 style={{ fontFamily: designTokens.fonts.headline, color: designTokens.colors['text'] || '#18181B', fontSize: '16px', fontWeight: 600, margin: '0 0 16px 0' }}>
                Le tue sezioni
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tables.map((table) => (
                  <div
                    key={table.name}
                    onClick={() => setActiveView(table.name)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderRadius: designTokens.radii['md'] || '8px',
                      background: designTokens.colors['card-bg-alt'] || '#FAFAFA',
                      border: `1px solid ${designTokens.colors['border-light'] || '#F4F4F5'}`,
                      cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(16,24,40,0.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: '36px', height: '36px', borderRadius: designTokens.radii['md'] || '8px',
                        background: `${designTokens.colors['primary'] || primaryColor}1A`,
                        color: designTokens.colors['primary'] || primaryColor,
                      }}>
                        {resolveIcon(table.icon || '', table.name)}
                      </div>
                      <span style={{ fontFamily: designTokens.fonts.headline, color: designTokens.colors['text'] || '#18181B', fontSize: '14px', fontWeight: 600 }}>
                        {table.labelPlural || table.label}
                      </span>
                    </div>
                    <span style={{ color: designTokens.colors['text-secondary'] || colors.textSecondary, fontFamily: designTokens.fonts.body, fontSize: '13px' }}>
                      {table.fields?.length || 0} campi
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Table view - standard CRUD table
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ color: colors.text, fontSize: '24px', fontWeight: 700, margin: 0 }}>
          {activeTable?.labelPlural || 'Tabella'}
        </h2>
        {/* Fase 4: nascosto per il ruolo 'viewer' (sola lettura). */}
        {role !== 'viewer' && (
          <button
            onClick={onAddNew}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '10px 18px', borderRadius: '10px', border: 'none',
              background: primaryColor, color: '#fff', fontSize: '14px',
              fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            <Plus size={16} /> Nuovo
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
            background: colors.cardBg, border: `1px solid ${colors.border}`,
            padding: '10px 16px',
          }}
        >
          <Search size={18} style={{ color: colors.textSecondary }} />
          <input
            type="text"
            placeholder={`Cerca in ${activeTable?.labelPlural || 'dati'}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: colors.text, fontSize: '14px',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: '2px' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          background: colors.cardBg, border: `1px solid ${colors.border}`,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ background: colors.cardBgAlt }}>
                {activeTable?.fields.map((field) => (
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
                    {field.required && (
                      <span style={{ color: colors.danger, marginLeft: '2px' }}>*</span>
                    )}
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
                  <td colSpan={(activeTable?.fields?.length || 0) + 1} style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                    Caricamento records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={(activeTable?.fields?.length || 0) + 1} style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                    {searchQuery ? 'Nessun risultato per la ricerca' : 'Nessun record presente'}
                  </td>
                </tr>
              ) : (
                records.map((record, idx) => (
                  <tr
                    key={record.id || idx}
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = colors.cardBgAlt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {activeTable?.fields.map((field) => (
                      <td
                        key={fieldName(field)}
                        style={{
                          padding: '12px 16px', color: colors.text,
                          fontSize: '14px', whiteSpace: 'nowrap',
                          maxWidth: '200px', overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {renderCellValue(record, fieldName(field), field.type)}
                      </td>
                    ))}
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' }}>
                        {/* Fase 3/4: azioni di entità (cambio stato ecc.), filtrate per ruolo/transizione. */}
                        {(activeTable ? getVisibleTableActions(activeTable, record, role) : []).map((action) => (
                          <button
                            key={action.id}
                            onClick={() => onExecuteAction?.(String(record.id), action.id)}
                            title={action.label}
                            style={{
                              background: colors.cardBgAlt, border: `1px solid ${colors.border}`,
                              borderRadius: '8px', padding: '6px 10px', cursor: 'pointer',
                              color: colors.text, fontSize: '12px', fontWeight: 600,
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                        {/* Fase 4: nascosti per il ruolo 'viewer' (sola lettura). */}
                        {role !== 'viewer' && (
                          <>
                            <button
                              onClick={() => onEdit(record)}
                              title="Modifica"
                              style={{
                                background: primaryColor + '20', border: 'none',
                                borderRadius: '8px', padding: '6px', cursor: 'pointer',
                                color: primaryColor, display: 'flex', alignItems: 'center',
                                transition: 'background 0.2s',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = primaryColor + '40'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = primaryColor + '20'; }}
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
                          </>
                        )}
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
            {records.length} record
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Recipe Layout Content Component ─────────────────────────────────────────

interface RecipeLayoutContentProps {
  companyName: string;
  tables: TableDef[];
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  primaryColor: string;
  activeView: string;
  activeTable: TableDef | null;
  records: any[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
}

function RecipeLayoutContent({
  tables, colors, primaryColor,
  activeView, activeTable,
  records
}: RecipeLayoutContentProps) {
  // Recipe-specific layout with step-by-step view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '28px', fontWeight: 700, margin: 0 }}>
          {activeView === 'dashboard' ? 'Dashboard' : activeTable?.labelPlural || 'Ricette'}
        </h1>
      </div>

      {activeView === 'dashboard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          <KpiCard
            title="Ricette"
            value={String(records.length)}
            icon={<Heart size={22} />}
            colors={colors}
          />
          <KpiCard
            title="Ingredienti"
            value={String(tables.find(t => t.name === 'ingredienti') ? records.length : 0)}
            icon={<List size={22} />}
            colors={colors}
          />
        </div>
      ) : activeTable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Step-by-step view for recipes */}
          <div style={{
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '24px',
          }}>
            <h3 style={{ color: colors.text, fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
              Procedimento
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {records.slice(0, 5).map((record, idx) => (
                <div
                  key={record.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                    padding: '16px', borderRadius: '8px',
                    background: colors.cardBgAlt,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: primaryColor, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 600, fontSize: '12px',
                  }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ color: colors.text, fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0' }}>
                      {record.data?.[fieldName(activeTable.fields[0])] || `Passo ${idx + 1}`}
                    </h4>
                    <p style={{ color: colors.textSecondary, fontSize: '13px', margin: 0 }}>
                      {record.data?.descrizione || record.data?.note || 'Descrizione non disponibile'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
          Seleziona una ricetta per vedere i dettagli
        </div>
      )}
    </div>
  );
}

// ─── Restaurant Layout Content Component ────────────────────────────────────

interface RestaurantLayoutContentProps {
  companyName: string;
  tables: TableDef[];
  colors: ReturnType<typeof getThemeVars>;
  designTokens?: DesignTokens;
  primaryColor: string;
  activeView: string;
  activeTable: TableDef | null;
  records: any[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onEdit: (record: any) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
}

function RestaurantLayoutContent({
  tables, colors, primaryColor,
  activeView, activeTable,
  records, loading, onAddNew
}: RestaurantLayoutContentProps) {
  // Restaurant-specific layout with menu cards
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#18181B', fontSize: '28px', fontWeight: 700, margin: 0 }}>
          {activeView === 'dashboard' ? 'Dashboard' : activeTable?.labelPlural || 'Menu'}
        </h1>
      </div>

      {activeView === 'dashboard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
          <KpiCard
            title="Piatti"
            value={String(records.length)}
            icon={<Utensils size={22} />}
            colors={colors}
          />
          <KpiCard
            title="Ordini"
            value={String(tables.find(t => t.name === 'ordini') ? records.length : 0)}
            icon={<ShoppingCart size={22} />}
            colors={colors}
          />
        </div>
      ) : activeTable && isRestaurantMenuGridTable(activeTable.name) ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
        }}>
          {records.map((record) => (
            <div
              key={record.id}
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.border}`,
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, margin: 0 }}>
                    {record.data?.[fieldName(activeTable.fields[0])] || 'Piatto'}
                  </h3>
                  {activeTable.color && (
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px',
                      background: activeTable.color + '15', color: activeTable.color,
                      fontSize: '11px', fontWeight: 600,
                    }}>
                      {record.data?.categoria || 'Piatto'}
                    </span>
                  )}
                </div>
                <p style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '8px' }}>
                  {record.data?.descrizione || record.data?.note || 'Descrizione non disponibile'}
                </p>
                {record.data?.prezzo && (
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '24px', fontWeight: 700, color: primaryColor }}>
                      € {Number(record.data.prezzo).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : activeTable ? (
        // Fix blocker TEST D: la griglia menu sopra è pensata SOLO per
        // "piatti" (isRestaurantMenuGridTable) — qualunque altra tabella del
        // blueprint (clienti, ordini, righe_ordine...) prima ricadeva
        // silenziosamente in questo stesso ramo "piatto-grid", mostrando una
        // griglia vuota senza alcuna azione disponibile quando records era
        // vuoto (il caso comune per una tabella appena creata). Fallback
        // generico minimo: nome tabella, pulsante "Nuovo" (onAddNew già
        // disponibile come prop, non prima utilizzato in questo layout), e
        // un elenco semplice dei record esistenti — nessuna nuova
        // architettura, stesso principio già usato da SaaSLayoutContent per
        // qualunque tabella non specificamente prevista dal layout.
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onAddNew}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '10px', border: 'none',
                background: primaryColor, color: '#fff', fontSize: '14px',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus size={16} /> Nuovo
            </button>
          </div>
          <div style={{
            background: colors.cardBg, border: `1px solid ${colors.border}`,
            borderRadius: '12px', overflow: 'hidden',
          }}>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                Caricamento records...
              </div>
            ) : records.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: colors.textSecondary }}>
                Nessun record presente
              </div>
            ) : (
              records.map((record, idx) => (
                <div
                  key={record.id || idx}
                  style={{
                    padding: '14px 16px',
                    borderBottom: idx < records.length - 1 ? `1px solid ${colors.border}` : 'none',
                    color: colors.text, fontSize: '14px',
                  }}
                >
                  {activeTable.fields.slice(0, 4).map((f) => String(record[fieldName(f)] ?? '')).filter(Boolean).join(' · ') || `#${String(record.id).slice(0, 8)}`}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={{ color: colors.textSecondary, textAlign: 'center', padding: '60px' }}>
          Seleziona una categoria dal menu
        </div>
      )}
    </div>
  );
}

// ─── Helper Functions ───────────────────────────────────────────────────────

// ─── Status Badge (per campi "select" tipo stato ordine/prenotazione) ───────
// STATUS_STYLES/getStatusBadgeStyle/StatusBadge/renderCellValue ora in
// ./cellRenderers.tsx, condivisi con DynamicDataTable e CustomTableRenderer.

// Import Utensils for restaurant layout
import { Utensils, List } from 'lucide-react';