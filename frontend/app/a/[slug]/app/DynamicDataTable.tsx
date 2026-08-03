'use client';

import React, { useMemo, useState } from 'react';
import {
  Search, Plus, Pencil, Trash2, X, ChevronDown, LayoutGrid, List
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableDef, fieldName, extractDynamicKeys, getDisplayFields, getRecordValue } from './table-definitions';
import { getPlaceholderCategoryForTable } from '@/lib/recordPlaceholderImages';
import RecordCardGrid from './RecordCardGrid';
import { renderCellValue } from './cellRenderers';

interface AppRecord {
  id: string;
  dati_personalizzati?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DynamicDataTableProps {
  table: TableDef;
  records: AppRecord[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onEdit: (record: AppRecord) => void;
  onDelete: (recordId: string) => void;
  onAddNew: () => void;
  colors: ThemeColors;
  radius: string;
  shadow: string;
}

/** Sottoinsieme di `colors` usato solo da RecordCardGrid (non ancora migrato ai token tenant). */
interface ThemeColors {
  text: string;
  textSecondary: string;
  cardBg: string;
  border: string;
  primary: string;
  danger: string;
}

export default function DynamicDataTable({
  table, records, loading, searchQuery, onSearchChange,
  onEdit, onDelete, onAddNew, colors,
}: DynamicDataTableProps) {
  const [showDynamicCols, setShowDynamicCols] = useState(false);

  // Tabelle "vetrina" (veicoli, immobili, prodotti, piatti) partono in vista
  // a griglia fotografica invece della tabella piatta — coerente con la
  // richiesta di rendere le liste più invitanti, con immagini di esempio.
  // Stessa vista offerta anche a qualunque altra tabella (custom o no) a cui
  // l'utente abbia aggiunto un campo di tipo 'image': in quel caso non c'è
  // una categoria nota per le foto stock di riserva (category resta null,
  // RecordCardGrid ripiega su un placeholder neutro quando manca la foto
  // reale del record), ma la griglia resta comunque la vista più sensata per
  // un elenco con immagini proprie.
  const placeholderCategory = useMemo(() => getPlaceholderCategoryForTable(table.name), [table.name]);
  const hasImageField = useMemo(() => table.fields.some((f) => f.type === 'image'), [table.fields]);
  const canShowGrid = Boolean(placeholderCategory) || hasImageField;
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(canShowGrid ? 'grid' : 'table');
  // DynamicDataTable non viene rimontato al cambio tabella (nessuna `key`
  // sul chiamante): senza questo effetto la vista resterebbe quella della
  // tabella precedentemente selezionata.
  React.useEffect(() => {
    setViewMode(canShowGrid ? 'grid' : 'table');
  }, [table.name, canShowGrid]);

  // Estrae tutte le chiavi dinamiche dai record correnti
  const dynamicKeys = useMemo(() => extractDynamicKeys(records), [records]);

  // Costruisce la lista delle colonne da visualizzare: fissi + dinamic
  const displayFields = useMemo(
    () => getDisplayFields(table, showDynamicCols ? dynamicKeys : []),
    [table, dynamicKeys, showDynamicCols]
  );

  // Filtra per ricerca su TUTTI i campi (sia fissi che dati_personalizzati)
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter((r) => {
      // Cerca nei campi fissi
      for (const f of table.fields) {
        const fn = fieldName(f);
        const val = r[fn];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      // Cerca in dati_personalizzati
      const dp = r.dati_personalizzati as Record<string, unknown> | undefined;
      if (dp) {
        for (const v of Object.values(dp)) {
          if (v != null && String(v).toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [records, searchQuery, table.fields]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-2xl font-bold text-tenant-text">{table.labelPlural}</h2>
          {table.color && <div className="h-3 w-3 rounded-full" style={{ background: table.color }} />}
        </div>
        <div className="flex gap-2">
          {canShowGrid && (
            <div className="flex overflow-hidden rounded-xl border border-tenant-border">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                title="Vista griglia"
                className={cn(
                  'flex items-center px-3 py-2.5 transition-colors',
                  viewMode === 'grid' ? 'bg-tenant-primary/12 text-tenant-primary' : 'bg-tenant-card text-tenant-text-secondary'
                )}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                title="Vista tabella"
                className={cn(
                  'flex items-center border-l border-tenant-border px-3 py-2.5 transition-colors',
                  viewMode === 'table' ? 'bg-tenant-primary/12 text-tenant-primary' : 'bg-tenant-card text-tenant-text-secondary'
                )}
              >
                <List size={16} />
              </button>
            </div>
          )}
          <Button onClick={onAddNew}>
            <Plus size={16} /> Nuovo
          </Button>
        </div>
      </div>

      {/* Search Bar + toggle colonne dinamiche */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
          <Input
            type="text"
            placeholder={`Cerca in ${table.labelPlural}...`}
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
        {dynamicKeys.length > 0 && (
          <Button
            variant={showDynamicCols ? 'soft' : 'outline'}
            onClick={() => setShowDynamicCols(!showDynamicCols)}
            className="whitespace-nowrap"
          >
            <ChevronDown size={15} className={cn('transition-transform', showDynamicCols && 'rotate-180')} />
            Col. Dinamiche ({dynamicKeys.length})
          </Button>
        )}
      </div>

      {/* Griglia fotografica: tabelle vetrina (veicoli/immobili/prodotti/piatti)
          o qualunque tabella con un campo di tipo 'image' (category può essere
          null in quel caso, vedi canShowGrid sopra). */}
      {viewMode === 'grid' && canShowGrid ? (
        <RecordCardGrid
          table={table}
          records={filteredRecords}
          category={placeholderCategory}
          colors={colors}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-tenant-card-alt">
                  {/* Colonne fisse */}
                  {table.fields.map((field) => (
                    <th
                      key={fieldName(field)}
                      className="whitespace-nowrap border-b-2 border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary"
                    >
                      {field.label}
                      {field.required && <span className="ml-0.5 text-tenant-danger">*</span>}
                    </th>
                  ))}
                  {/* Colonne dinamiche (se attive) */}
                  {showDynamicCols && dynamicKeys.map((key) => (
                    <th
                      key={`dp_${key}`}
                      className="whitespace-nowrap border-b-2 border-tenant-border bg-tenant-primary/5 px-4 py-3 text-left text-xs font-semibold italic uppercase tracking-wide text-tenant-primary"
                    >
                      {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')} ⚡
                    </th>
                  ))}
                  {/* Azioni */}
                  <th className="w-[100px] whitespace-nowrap border-b-2 border-tenant-border px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={table.fields.length + (showDynamicCols ? dynamicKeys.length : 0) + 1}
                      className="p-10 text-center text-tenant-text-secondary"
                    >
                      Caricamento records...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={table.fields.length + (showDynamicCols ? dynamicKeys.length : 0) + 1}
                      className="p-10 text-center text-tenant-text-secondary"
                    >
                      {searchQuery ? 'Nessun risultato per la ricerca' : 'Nessun record presente'}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record, idx) => (
                    <tr
                      key={record.id || idx}
                      className="border-b border-tenant-border transition-colors hover:bg-tenant-card-alt"
                    >
                      {/* Valori campi fissi */}
                      {table.fields.map((field) => (
                        <td
                          key={fieldName(field)}
                          className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-sm text-tenant-text"
                        >
                          {renderCellValue(record, fieldName(field), field.type)}
                        </td>
                      ))}
                      {/* Valori colonne dinamiche */}
                      {showDynamicCols && dynamicKeys.map((key) => {
                        const dp = (record.dati_personalizzati as Record<string, unknown>) || {};
                        return (
                          <td
                            key={`dpv_${key}`}
                            className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap bg-tenant-primary/[0.02] px-4 py-3 text-sm text-tenant-text"
                          >
                            {String(dp[key] ?? '')}
                          </td>
                        );
                      })}
                      {/* Pulsanti azioni */}
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
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer counter */}
          <div className="flex items-center justify-between border-t border-tenant-border px-4 py-3">
            <span className="text-[13px] text-tenant-text-secondary">
              {filteredRecords.length} di {records.length} record
              {dynamicKeys.length > 0 && (
                <span className="ml-3 text-xs italic">· {dynamicKeys.length} colonne dinamiche</span>
              )}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

// renderCellValue ora in ./cellRenderers.tsx, condivisa con
// CustomTableRenderer e DynamicLayoutRenderer.
