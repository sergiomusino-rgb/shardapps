'use client';

import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { TableDef, fieldName, findDisplayPriceField } from './table-definitions';
import { getPlaceholderImageUrl, type PlaceholderCategory } from '@/lib/recordPlaceholderImages';

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
  category: PlaceholderCategory;
  colors: ThemeVars;
  onEdit: (record: AppRecord) => void;
  onDelete: (recordId: string) => void;
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

// Griglia di card fotografiche per tabelle "vetrina" (veicoli, immobili,
// prodotti, piatti): sostituisce le righe di tabella piatte con card ricche
// di immagine — foto reale del record se presente, altrimenti un placeholder
// Unsplash contestuale — badge, titolo e prezzo in evidenza, in linea con lo
// stile "vetrina invitante" richiesto invece delle "semplici caselle".
export default function RecordCardGrid({ table, records, category, colors, onEdit, onDelete }: RecordCardGridProps) {
  const imageField = table.fields.find((f) => f.type === 'image');
  const priceField = findDisplayPriceField(table.fields);
  const badgeField = table.fields.find((f) => f.type === 'select');
  const titleField = table.fields.find((f) => f.type === 'text' && f !== badgeField) || table.fields[0];
  const subtitleFields = table.fields
    .filter((f) => f !== titleField && f !== badgeField && f !== priceField && f !== imageField)
    .slice(0, 2);

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
        const title = titleField ? String(record[fieldName(titleField)] ?? table.label) : table.label;
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
            </div>

            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </h3>
              {subtitleFields.length > 0 && (
                <p style={{ margin: 0, fontSize: '12px', color: colors.textSecondary }}>
                  {subtitleFields
                    .map((f) => formatValue(record[fieldName(f)], f.type))
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {priceValue && (
                <div style={{ marginTop: 'auto', paddingTop: '6px', fontSize: '17px', fontWeight: 800, color: colors.primary }}>
                  {priceValue}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
