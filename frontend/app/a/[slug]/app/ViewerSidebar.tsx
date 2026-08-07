'use client';

import { useState } from 'react';
import {
  LayoutDashboard, Settings, LogOut, Plus, Settings2,
  MessageSquare, Mail, MessageCircle, Upload, Download, FileText,
  FileSpreadsheet, File as FileIcon, Receipt, ExternalLink,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { sortTablesForSidebar, type TableDef } from './table-definitions';
import { resolveIcon } from './iconResolver';
import { NavItem, SectionLabel, CollapsibleSection, SidebarLogo, SidebarBrandFooter, type SidebarCustomTable } from './sidebar-primitives';

interface ViewerSidebarProps {
  tables: TableDef[];
  customTables: SidebarCustomTable[];
  activeView: string;
  onNavigate: (view: string) => void;
  datiAziendaliTable: TableDef | null | undefined;
  onEditTable: (table: TableDef) => void;
  onCreateTable: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  logoUrl: string;
  companyName: string;
  /** White label piano Business: sostituisce logo+testo ShardApps nel footer sidebar. */
  footerLogoUrl?: string;
  footerLabel?: string;
  /** Slug del tenant, per il link a /a/{slug}/fatture (route standalone, fuori dalla shell). */
  slug: string;
  isMobile: boolean;
  open: boolean;
  onClose: () => void;
}

function SidebarContent({
  tables, customTables, activeView, onNavigate, datiAziendaliTable,
  onEditTable, onCreateTable, onOpenSettings, onLogout,
  logoUrl, companyName, footerLogoUrl, footerLabel, slug,
}: Omit<ViewerSidebarProps, 'isMobile' | 'open' | 'onClose'>) {
  const [comunicazioniOpen, setComunicazioniOpen] = useState(false);
  const [importazioniOpen, setImportazioniOpen] = useState(false);

  return (
    <div className="flex h-full flex-col bg-tenant-sidebar-bg text-tenant-sidebar-text">
      <SidebarLogo logoUrl={logoUrl} companyName={companyName} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <NavItem
          icon={<LayoutDashboard size={18} />}
          label="Dashboard"
          active={activeView === 'dashboard'}
          onClick={() => onNavigate('dashboard')}
        />

        {sortTablesForSidebar(tables).map((table) => (
          <NavItem
            key={table.name}
            icon={resolveIcon(table.icon, table.name)}
            label={table.labelPlural}
            active={activeView === table.name}
            onClick={() => onNavigate(table.name)}
            trailing={
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTable(table);
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
        {customTables.map((ct) => (
          <NavItem
            key={`custom_${ct.name}`}
            icon={<LayoutDashboard size={18} />}
            label={ct.labelPlural || `${ct.label}i`}
            active={activeView === `custom_${ct.name}`}
            onClick={() => onNavigate(`custom_${ct.name}`)}
          />
        ))}
        <button
          type="button"
          onClick={onCreateTable}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-tenant-sidebar-hover px-3.5 py-2 text-sm font-medium text-tenant-sidebar-text transition-colors hover:brightness-95"
        >
          <Plus size={14} /> Nuova Tabella
        </button>

        <CollapsibleSection
          icon={<MessageSquare size={14} />}
          label="Comunicazioni"
          open={comunicazioniOpen}
          onToggle={() => setComunicazioniOpen((v) => !v)}
        >
          <NavItem icon={<MessageCircle size={18} />} label="WhatsApp" active={false} onClick={() => window.open('https://wa.me/393331234567', '_blank')} />
          <NavItem icon={<MessageSquare size={18} />} label="Provider SDI" active={false} onClick={() => window.open('https://www.sdi.agenziaentrate.gov.it', '_blank')} />
          <NavItem icon={<Mail size={18} />} label="Email" active={false} onClick={() => window.open('https://mail.google.com', '_blank')} />
        </CollapsibleSection>

        <CollapsibleSection
          icon={<Upload size={14} />}
          label="Importazioni"
          open={importazioniOpen}
          onToggle={() => setImportazioniOpen((v) => !v)}
        >
          <NavItem icon={<Upload size={18} />} label="Importa CSV" active={activeView === 'import_csv'} onClick={() => onNavigate('import_csv')} />
          <NavItem icon={<Download size={18} />} label="Esporta CSV" active={activeView === 'export_csv'} onClick={() => onNavigate('export_csv')} />
          <NavItem icon={<FileText size={18} />} label="Importa PDF" active={activeView === 'import_pdf'} onClick={() => onNavigate('import_pdf')} />
          <NavItem icon={<FileText size={18} />} label="Esporta PDF" active={activeView === 'export_pdf'} onClick={() => onNavigate('export_pdf')} />
          <NavItem icon={<FileSpreadsheet size={18} />} label="Importa Excel" active={activeView === 'import_excel'} onClick={() => onNavigate('import_excel')} />
          <NavItem icon={<FileSpreadsheet size={18} />} label="Esporta Excel" active={activeView === 'export_excel'} onClick={() => onNavigate('export_excel')} />
          <NavItem icon={<FileIcon size={18} />} label="Importa JSON" active={activeView === 'import_json'} onClick={() => onNavigate('import_json')} />
          <NavItem icon={<FileIcon size={18} />} label="Esporta JSON" active={activeView === 'export_json'} onClick={() => onNavigate('export_json')} />
        </CollapsibleSection>
      </nav>

      {/* Footer actions */}
      <div className="flex flex-col gap-0.5 border-t border-tenant-sidebar-text/10 px-2.5 py-3">
        <NavItem
          icon={<Receipt size={18} />}
          label="Fatture e Ricevute"
          active={false}
          onClick={() => { window.location.href = `/a/${slug}/fatture`; }}
        />
        <NavItem icon={<Settings size={18} />} label="Impostazioni" active={false} onClick={onOpenSettings} />
        <NavItem
          icon={<ExternalLink size={18} />}
          label="Vedi il sito pubblico"
          active={false}
          onClick={() => { window.location.href = `/a/${slug}`; }}
        />
        {datiAziendaliTable && (
          <NavItem
            icon={resolveIcon(datiAziendaliTable.icon, datiAziendaliTable.name)}
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

/** Sidebar fissa (desktop) / off-canvas (mobile) dell'app generata. */
export default function ViewerSidebar({ isMobile, open, onClose, ...content }: ViewerSidebarProps) {
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SidebarContent
          {...content}
          onNavigate={(view) => { content.onNavigate(view); onClose(); }}
          onOpenSettings={() => { content.onOpenSettings(); onClose(); }}
        />
      </Sheet>
    );
  }

  return (
    <aside className="h-full w-[280px] shrink-0 border-r border-tenant-sidebar-text/10">
      <SidebarContent {...content} />
    </aside>
  );
}
