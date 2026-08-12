'use client';

import React, { useMemo, useState } from 'react';
import {
  Search, Plus, Pencil, Trash2, X, ChevronDown, LayoutGrid, List, Sparkles, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableDef, TableAction, fieldName, extractDynamicKeys, pickIdentityFields } from './table-definitions';
import { getPlaceholderCategoryForTable, getPlaceholderImageUrl } from '@/lib/recordPlaceholderImages';
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
  /** Genera 5 record di esempio per popolare una tabella vuota. Assente = pulsante nascosto. */
  onGenerateMock?: () => void;
  generatingMock?: boolean;
  colors: ThemeColors;
  radius: string;
  shadow: string;
  /** Record disponibili per risolvere le colonne di relazione (field.targetTable)
   * nell'id salvato -> etichetta leggibile del record correlato, chiave = nome
   * tabella target. Assente/vuota = le colonne di relazione mostrano l'id grezzo. */
  relationRecords?: Record<string, Array<{ id: string; [key: string]: unknown }>>;
  /** Ruolo dell'utente loggato (Fase 3, app auth_mode='rbac'/'supabase').
   * Assente = nessun concetto di ruolo per questa app (legacy): accesso
   * pieno, comportamento invariato. 'viewer' = sola lettura (nessun
   * Nuovo/Modifica/Elimina/azione). */
  role?: 'admin' | 'operator' | 'viewer';
  /** Esegue un'azione dell'entità (table.actions) su un record — l'enforcement
   * reale di ruolo/transizione è lato server, qui solo l'invocazione. */
  onExecuteAction?: (recordId: string, actionId: string) => void;
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
  onEdit, onDelete, onAddNew, onGenerateMock, generatingMock, colors,
  relationRecords = {}, role, onExecuteAction,
}: DynamicDataTableProps) {
  const [showDynamicCols, setShowDynamicCols] = useState(false);
  const isViewer = role === 'viewer';

  // Azioni (table.actions, Fase 3) visibili per QUESTO record: filtrate per
  // ruolo (requiredRole) e, per le change_state, per la transizione ammessa
  // dallo stato corrente del record — mai mostrare un pulsante che il server
  // rifiuterebbe comunque con un 409. Un'azione senza vincoli noti (nessuna
  // allowedTransitions configurata, o stato corrente non riconosciuto) resta
  // visibile: stessa convenzione "permissiva se non specificato" del server.
  const getVisibleActions = (record: AppRecord): TableAction[] => {
    if (!table.actions?.length || isViewer) return [];
    const stateField = table.fields.find((f) => f.type === 'state');
    const currentState = stateField ? String(record[fieldName(stateField)] ?? '') : undefined;
    return table.actions.filter((action) => {
      if (action.requiredRole === 'admin' && role && role !== 'admin') return false;
      if (action.type !== 'change_state') return true;
      if (!stateField || !action.targetState) return false;
      const allowed = stateField.allowedTransitions;
      if (!allowed || !currentState || !allowed[currentState]) return true;
      return allowed[currentState].includes(action.targetState);
    });
  };

  // Per un campo di relazione (targetTable impostato), risolve l'id salvato
  // nel record nell'etichetta leggibile del record correlato (targetLabel),
  // invece di lasciare che la colonna mostri l'id grezzo (es. un UUID).
  // undefined = non è un campo di relazione, renderCellValue userà il
  // trattamento normale per il suo `type`.
  const resolveRelationLabel = (field: { targetTable?: string; targetLabel?: string }, value: unknown): string | undefined => {
    if (!field.targetTable) return undefined; // non è un campo di relazione
    if (value == null || value === '') return '';
    const related = (relationRecords[field.targetTable] || []).find((r) => String(r.id) === String(value));
    if (!related) return '—'; // id salvato ma nessun record corrispondente (rimosso?)
    return String((field.targetLabel ? related[field.targetLabel] : undefined) ?? related.id ?? '');
  };

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
  // Ogni tabella ha ormai sempre un campo Immagine (ensureImageField in
  // table-definitions.ts, aggiunto automaticamente anche a tabelle come
  // Ordini/Appuntamenti che non sono "vetrina"): hasImageField da solo non
  // basta più a decidere la vista di default, altrimenti anche quelle
  // partirebbero a griglia fotografica. Solo le categorie vetrina note
  // (veicoli, immobili, prodotti, piatti, ...) partono a griglia; le altre
  // partono a tabella piatta ma con la colonna miniatura (vedi identityActive
  // sotto) e possono comunque passare a griglia dal toggle.
  const defaultsToGrid = Boolean(placeholderCategory);

  // Anche nella vista a tabella piatta, se la tabella ha una foto (propria o
  // di categoria nota) mostra una colonna "identità" con miniatura + titolo +
  // sottotitolo al posto delle colonne separate immagine/titolo — stessi
  // campi scelti dalla vista a card (pickIdentityFields), per coerenza tra
  // le due viste.
  const { imageField, titleField, subtitleFields } = useMemo(
    () => pickIdentityFields(table.fields),
    [table.fields]
  );
  const identitySubtitleField = subtitleFields[0];
  const identityActive = canShowGrid && Boolean(titleField);
  const flatColumns = useMemo(
    () => (identityActive
      ? table.fields.filter((f) => f !== imageField && f !== titleField && f !== identitySubtitleField)
      : table.fields),
    [table.fields, identityActive, imageField, titleField, identitySubtitleField]
  );
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(defaultsToGrid ? 'grid' : 'table');
  // DynamicDataTable non viene rimontato al cambio tabella (nessuna `key`
  // sul chiamante): senza questo effetto la vista resterebbe quella della
  // tabella precedentemente selezionata.
  React.useEffect(() => {
    setViewMode(defaultsToGrid ? 'grid' : 'table');
  }, [table.name, defaultsToGrid]);

  // Estrae tutte le chiavi dinamiche dai record correnti
  const dynamicKeys = useMemo(() => extractDynamicKeys(records), [records]);

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
          {!isViewer && onGenerateMock && records.length === 0 && (
            <Button variant="outline" onClick={onGenerateMock} disabled={generatingMock}>
              {generatingMock ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generatingMock ? 'Generazione...' : 'Genera 5 di esempio'}
            </Button>
          )}
          {!isViewer && (
            <Button onClick={onAddNew}>
              <Plus size={16} /> Nuovo
            </Button>
          )}
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
          role={role}
          onExecuteAction={onExecuteAction}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-tenant-card-alt">
                  {/* Colonna identità: miniatura + titolo (+ sottotitolo) */}
                  {identityActive && (
                    <th className="whitespace-nowrap border-b-2 border-tenant-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">
                      {titleField!.label}
                    </th>
                  )}
                  {/* Colonne fisse */}
                  {flatColumns.map((field) => (
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
                      colSpan={flatColumns.length + (identityActive ? 1 : 0) + (showDynamicCols ? dynamicKeys.length : 0) + 1}
                      className="p-10 text-center text-tenant-text-secondary"
                    >
                      Caricamento records...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td
                      colSpan={flatColumns.length + (identityActive ? 1 : 0) + (showDynamicCols ? dynamicKeys.length : 0) + 1}
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
                      {/* Colonna identità: miniatura + titolo (+ sottotitolo) */}
                      {identityActive && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={(imageField && (record[fieldName(imageField)] as string)) || getPlaceholderImageUrl(placeholderCategory, String(record.id))}
                              alt=""
                              loading="lazy"
                              className="h-11 w-11 shrink-0 rounded-lg object-cover"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-tenant-text">
                                {String(record[fieldName(titleField!)] ?? '')}
                              </div>
                              {identitySubtitleField && (
                                <div className="truncate text-xs text-tenant-text-secondary">
                                  {renderCellValue(
                                    record,
                                    fieldName(identitySubtitleField),
                                    identitySubtitleField.type,
                                    resolveRelationLabel(identitySubtitleField, record[fieldName(identitySubtitleField)])
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      )}
                      {/* Valori campi fissi */}
                      {flatColumns.map((field) => (
                        <td
                          key={fieldName(field)}
                          className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap px-4 py-3 text-sm text-tenant-text"
                        >
                          {renderCellValue(record, fieldName(field), field.type, resolveRelationLabel(field, record[fieldName(field)]))}
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
                      {/* Pulsanti azioni: azioni di entità (Fase 3, cambio stato ecc.)
                          + modifica/elimina, quest'ultime nascoste per il ruolo 'viewer'
                          (sola lettura — l'enforcement reale resta comunque lato server). */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          {getVisibleActions(record).map((action) => (
                            <Button
                              key={action.id}
                              variant="outline"
                              size="sm"
                              onClick={() => onExecuteAction?.(String(record.id), action.id)}
                              title={action.label}
                            >
                              {action.label}
                            </Button>
                          ))}
                          {!isViewer && (
                            <>
                              <Button variant="soft" size="icon" onClick={() => onEdit(record)} title="Modifica">
                                <Pencil size={15} />
                              </Button>
                              <Button variant="destructive" size="icon" onClick={() => onDelete(record.id)} title="Elimina">
                                <Trash2 size={15} />
                              </Button>
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
