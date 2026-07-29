'use client';

import React, { useMemo } from 'react';
import { Search, Plus, Pencil, Trash2, X } from 'lucide-react';
import { renderCellValue } from './cellRenderers';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface ColumnDef {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

interface CustomTableDef {
  id: string;
  name: string;
  label: string;
  labelPlural: string;
  icon?: string;
  color?: string;
  columns: ColumnDef[];
  _record_id: string;
}

interface CustomRecord {
  id: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CustomTableRendererProps {
  tableDef: CustomTableDef;
  records: CustomRecord[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onEdit: (record: CustomRecord) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  colors?: unknown;
  radius?: string;
  shadow?: string;
}

export default function CustomTableRenderer({
  tableDef, records, loading, searchQuery, onSearchChange,
  onEdit, onDelete, onAddNew,
}: CustomTableRendererProps) {
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) => {
      const data = r.data || r;
      for (const col of tableDef.columns) {
        const val = data[col.name];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [records, searchQuery, tableDef.columns]);

  const label = tableDef.labelPlural || `${tableDef.label}i`;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-2xl font-bold text-tenant-text">{label}</h2>
          {tableDef.color && <div className="h-3 w-3 rounded-full" style={{ background: tableDef.color }} />}
          <Badge variant="primary">Personalizzata</Badge>
        </div>
        <Button onClick={onAddNew}>
          <Plus size={16} /> Nuovo
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
        <Input
          type="text"
          placeholder={`Cerca in ${label}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 pr-9"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary hover:text-tenant-text"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Tabella */}
      <Card className="overflow-hidden">
        <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-tenant-card-alt">
                {tableDef.columns.map((col) => (
                  <th
                    key={col.name}
                    className="whitespace-nowrap border-b-2 border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary"
                  >
                    {col.label}
                    {col.required && <span className="ml-0.5 text-tenant-danger">*</span>}
                  </th>
                ))}
                <th className="w-[100px] whitespace-nowrap border-b-2 border-tenant-border px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableDef.columns.length + 1} className="p-10 text-center text-tenant-text-secondary">
                    Caricamento records...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={tableDef.columns.length + 1} className="p-10 text-center text-tenant-text-secondary">
                    {searchQuery ? 'Nessun risultato per la ricerca' : 'Nessun record presente'}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const data = (record.data || record) as Record<string, unknown>;
                  return (
                    <tr key={record.id || idx} className="border-b border-tenant-border transition-colors hover:bg-tenant-card-alt">
                      {tableDef.columns.map((col) => (
                        <td
                          key={col.name}
                          className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-sm text-tenant-text"
                        >
                          {renderCellValue(data, col.name, col.type)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-2">
                          <Button variant="soft" size="icon" onClick={() => onEdit(record)} title="Modifica">
                            <Pencil size={15} />
                          </Button>
                          <Button variant="destructive" size="icon" onClick={() => onDelete(record.id)} title="Elimina">
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-tenant-border px-4 py-3">
          <span className="text-[13px] text-tenant-text-secondary">{filteredRecords.length} di {records.length} record</span>
        </div>
      </Card>
    </div>
  );
}

// renderCellValue ora in ./cellRenderers.tsx, condivisa con DynamicDataTable
// e DynamicLayoutRenderer (badge di stato, valuta, date, immagini).
