'use client';

import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { TableDef, TableAction, fieldName, pickIdentityFields } from './table-definitions';
import { getPlaceholderImageUrl, type PlaceholderCategory } from '@/lib/recordPlaceholderImages';
import { isTerminalStateValue } from '@/lib/semantic-fields';

interface AppRecord {
  id: string;
  dati_personalizzati?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ThemeVars {
  text: string;
  textSecondary: string;
  cardBg: string;
  border: string;
  primary: string;
  danger: string;
}

interface RecordCardGridProps {
  table: TableDef;
  records: AppRecord[];
  /** null per tabelle personalizzate con campo Immagine ma nome non
   * riconosciuto (getPlaceholderCategoryForTable): niente foto stock
   * contestuale, si ripiega su un placeholder neutro (vedi
   * getPlaceholderImageUrl) quando il record non ha una foto propria. */
  category: PlaceholderCategory | null;
  colors: ThemeVars;
  onEdit: (record: AppRecord) => void;
  onDelete: (recordId: string) => void;
  /** Ruolo dell'utente loggato (Fase 3/4). Assente = nessun concetto di
   * ruolo (app legacy): accesso pieno, comportamento invariato. 'viewer' =
   * nasconde Modifica/Elimina. */
  role?: string;
  /** Esegue un'azione di entità (table.actions) su un record. */
  onExecuteAction?: (recordId: string, actionId: string) => void;
  /** Record disponibili per risolvere le colonne di relazione (field.targetTable)
   * nell'id salvato -> etichetta leggibile del record correlato, chiave = nome
   * tabella target. Assente/vuota = le colonne di relazione mostrano l'id
   * grezzo — stessa prop già usata da DynamicDataTable.tsx (CreatorAI V3,
   * fix TEST E: pickIdentityFields può scegliere un campo relation come
   * titolo/sottotitolo quando non c'è un campo testo, e va risolto anche qui). */
  relationRecords?: Record<string, Array<{ id: string; [key: string]: unknown }>>;
}

// Stessa identica logica di getVisibleActions in DynamicDataTable.tsx —
// duplicata (non importata) perché RecordCardGrid è un renderer alternativo
// indipendente, non un wrapper di DynamicDataTable.
// CreatorAI V4 (P1-5): stessa rete di sicurezza semantica sugli stati
// terminali — vedi il commento in DynamicDataTable.tsx::getVisibleActions.
function getVisibleActions(table: TableDef, record: Record<string, unknown>, role?: string): TableAction[] {
  if (!table.actions?.length || role === 'viewer') return [];
  const stateField = table.fields.find((f) => f.type === 'state');
  const currentState = stateField ? String(record[fieldName(stateField)] ?? '') : undefined;
  return table.actions.filter((action) => {
    if (action.requiredRole === 'admin' && role && role !== 'admin') return false;
    if (action.type !== 'change_state') return true;
    if (!stateField || !action.targetState) return false;
    const allowed = stateField.allowedTransitions;
    if (allowed && currentState && allowed[currentState]) {
      return allowed[currentState].includes(action.targetState);
    }
    if (currentState && isTerminalStateValue(currentState)) return false;
    return true;
  });
}

function formatValue(val: unknown, type: string): string {
  if (val == null || val === '') return '';
  if (type === 'currency' || type === 'number') {
    const n = Number(val);
    if (!isNaN(n) && type === 'currency') return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    return String(val);
  }
  if (type === 'date') {
    try { return new Date(val as string).toLocaleDateString('it-IT'); } catch { return String(val); }
  }
  return String(val);
}

// Stessa identica logica di resolveRelationLabel in DynamicDataTable.tsx —
// duplicata (non importata) per lo stesso motivo di getVisibleActions sopra:
// RecordCardGrid è un renderer alternativo indipendente.
function resolveRelationLabel(
  field: { targetTable?: string; targetLabel?: string },
  value: unknown,
  relationRecords: Record<string, Array<{ id: string; [key: string]: unknown }>>
): string | undefined {
  if (!field.targetTable) return undefined;
  if (value == null || value === '') return '';
  const related = (relationRecords[field.targetTable] || []).find((r) => String(r.id) === String(value));
  if (!related) return '—';
  return String((field.targetLabel ? related[field.targetLabel] : undefined) ?? related.id ?? '');
}

// Griglia di card fotografiche per tabelle "vetrina" (veicoli, immobili,
// prodotti, piatti): sostituisce le righe di tabella piatte con card ricche
// di immagine — foto reale del record se presente, altrimenti un placeholder
// Unsplash contestuale — badge, titolo e prezzo in evidenza, in linea con lo
// stile "vetrina invitante" richiesto invece delle "semplici caselle".
export default function RecordCardGrid({ table, records, category, colors, onEdit, onDelete, role, onExecuteAction, relationRecords = {} }: RecordCardGridProps) {
  const { imageField, titleField, badgeField, priceField, subtitleFields } = pickIdentityFields(table.fields);

  if (records.length === 0) {
    return (
      <div style={{
        padding: '60px 24px', textAlign: 'center', color: colors.textSecondary,
        background: colors.cardBg, border: `1px solid ${colors.border}`, borderRadius: '16px',
      }}>
        Nessun record presente
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '20px' }}>
      {records.map((record) => {
        const realImage = imageField ? (record[fieldName(imageField)] as string | undefined) : undefined;
        const imageUrl = realImage || getPlaceholderImageUrl(category, String(record.id));
        // CreatorAI V3 (fix TEST E — issue GitHub #39, punto 3): titleField
        // può essere un campo relation (pickIdentityFields ora lo sceglie
        // come fallback quando manca un campo testo) — deve risolvere l'id
        // salvato nell'etichetta leggibile del record collegato, mai
        // stringificare l'id grezzo.
        const titleRelationLabel = titleField ? resolveRelationLabel(titleField, record[fieldName(titleField)], relationRecords) : undefined;
        const title = titleRelationLabel !== undefined
          ? (titleRelationLabel || table.label)
          : (titleField ? String(record[fieldName(titleField)] ?? table.label) : table.label);
        const badgeValue = badgeField ? String(record[fieldName(badgeField)] ?? '') : '';
        // Una volta identificato come "il" campo prezzo (findDisplayPriceField),
        // formattalo sempre come valuta a prescindere dal type dichiarato
        // (spesso 'number', non 'currency', negli schemi generati dall'AI).
        const rawPrice = priceField ? record[fieldName(priceField)] : undefined;
        const priceNum = rawPrice != null && rawPrice !== '' ? Number(rawPrice) : NaN;
        const priceValue = !isNaN(priceNum) ? `${priceNum.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '';

        return (
          <div
            key={record.id}
            className="group"
            style={{
              background: colors.cardBg, border: `1px solid ${colors.border}`,
              borderRadius: '16px', overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)',
              transition: 'transform 0.2s, box-shadow 0.2s',
              display: 'flex', flexDirection: 'column',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(16,24,40,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.06)'; }}
          >
            <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: colors.border }}>
              <img
                src={imageUrl}
                alt={title}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {badgeValue && (
                <span style={{
                  position: 'absolute', top: '10px', left: '10px',
                  padding: '4px 10px', borderRadius: '999px',
                  background: 'rgba(15,23,42,0.75)', color: '#fff',
                  fontSize: '11px', fontWeight: 700, backdropFilter: 'blur(4px)',
                }}>
                  {badgeValue}
                </span>
              )}
              {/* Fase 4: Modifica/Elimina nascosti per il ruolo 'viewer' (sola
                  lettura) — evita che l'utente li scopra bloccati al submit. */}
              {role !== 'viewer' && (
                <div style={{
                  position: 'absolute', top: '8px', right: '8px',
                  display: 'flex', gap: '6px', opacity: 0,
                  transition: 'opacity 0.15s',
                }}
                  className="group-hover:opacity-100"
                >
                  <button
                    onClick={() => onEdit(record)}
                    title="Modifica"
                    style={{
                      background: 'rgba(15,23,42,0.75)', border: 'none', borderRadius: '8px',
                      padding: '6px', cursor: 'pointer', color: '#fff', display: 'flex',
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => onDelete(record.id)}
                    title="Elimina"
                    style={{
                      background: 'rgba(15,23,42,0.75)', border: 'none', borderRadius: '8px',
                      padding: '6px', cursor: 'pointer', color: '#f87171', display: 'flex',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </h3>
              {subtitleFields.length > 0 && (
                <p style={{ margin: 0, fontSize: '12px', color: colors.textSecondary }}>
                  {subtitleFields
                    .map((f) => {
                      const rel = resolveRelationLabel(f, record[fieldName(f)], relationRecords);
                      return rel !== undefined ? rel : formatValue(record[fieldName(f)], f.type);
                    })
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {priceValue && (
                <div style={{ marginTop: 'auto', paddingTop: '6px', fontSize: '17px', fontWeight: 800, color: colors.primary }}>
                  {priceValue}
                </div>
              )}
              {/* Fase 3/4: azioni di entità (cambio stato ecc.), filtrate per ruolo/transizione. */}
              {getVisibleActions(table, record, role).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '6px' }}>
                  {getVisibleActions(table, record, role).map((action) => (
                    <button
                      key={action.id}
                      onClick={() => onExecuteAction?.(String(record.id), action.id)}
                      title={action.label}
                      style={{
                        background: colors.cardBg, border: `1px solid ${colors.border}`,
                        borderRadius: '8px', padding: '5px 10px', cursor: 'pointer',
                        color: colors.text, fontSize: '11px', fontWeight: 600,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
