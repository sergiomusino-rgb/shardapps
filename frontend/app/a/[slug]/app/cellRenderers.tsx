import React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';

// ─── Badge di stato colorati ────────────────────────────────────────────────
// Keyword-matching semantico sul valore (es. "Pagato"→verde, "In Attesa"→ambra,
// "Annullato"→rosso) invece di un pallino a tinta unica: condiviso da tutti i
// renderer di tabella (blueprint, tabelle personalizzate/AI, layout di settore)
// così un campo "stato" sembra sempre un vero gestionale, non testo grezzo.
// Le varianti restano fisse (semantica di stato) indipendenti dal brand color
// del tenant, come in qualsiasi app builder professionale.
const STATUS_STYLES: { keywords: string[]; variant: NonNullable<BadgeProps['variant']> }[] = [
  { keywords: ['consegnat', 'complet', 'pagat', 'confermat', 'pronto', 'attivo', 'disponibile', 'evaso', 'delivered', 'completed', 'paid', 'confirmed', 'ready', 'done', 'active'], variant: 'success' },
  { keywords: ['preparazione', 'corso', 'attesa', 'lavorazione', 'sospes', 'pending', 'processing', 'progress', 'in attesa'], variant: 'warning' },
  { keywords: ['annullat', 'rifiutat', 'scadut', 'bloccat', 'cancellat', 'cancelled', 'canceled', 'rejected', 'expired', 'blocked'], variant: 'danger' },
];

export function getStatusBadgeVariant(value: string): NonNullable<BadgeProps['variant']> {
  const v = value.toLowerCase();
  for (const s of STATUS_STYLES) {
    if (s.keywords.some((k) => v.includes(k))) return s.variant;
  }
  return 'primary'; // neutro/informativo di default, sul colore del tenant
}

export function StatusBadge({ value }: { value: string }) {
  return <Badge variant={getStatusBadgeVariant(value)}>{value}</Badge>;
}

// ─── Rendering celle per tipo di campo ──────────────────────────────────────
// Unico punto di verità per checkbox/currency/date/select/multiselect/image,
// usato da DynamicDataTable, CustomTableRenderer e DynamicLayoutRenderer così
// da avere lo stesso trattamento visivo ovunque (tabelle blueprint, tabelle
// create con l'AI Schema Updater, layout ricchi di settore).
export function renderCellValue(record: Record<string, unknown>, fieldName: string, type: string): React.ReactNode {
  const val = record[fieldName];
  if (val == null || val === '') return '';

  if (type === 'checkbox') {
    return val ? 'Sì' : 'No';
  }
  if (type === 'currency') {
    const n = Number(val);
    return isNaN(n) ? String(val) : `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  }
  if (type === 'number') {
    const n = Number(val);
    const looksLikePrice = /prezzo|totale|importo|costo/i.test(fieldName);
    if (!isNaN(n) && looksLikePrice) {
      return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    }
    return String(val);
  }
  if (type === 'date') {
    try {
      return new Date(val as string).toLocaleDateString('it-IT');
    } catch {
      return String(val);
    }
  }
  if (type === 'select' || type === 'multiselect') {
    const values = (Array.isArray(val) ? val : [val]).filter(Boolean);
    return (
      <span className="flex flex-wrap gap-1">
        {values.map((v, i) => <StatusBadge key={i} value={String(v)} />)}
      </span>
    );
  }
  if (type === 'image' && typeof val === 'string' && val) {
    return <img src={val} alt="" className="block h-8 w-8 rounded-md object-cover" />;
  }
  return String(val);
}
