'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CalendarAgendaItem {
  date: string;
  recordLabel: string;
  tableLabel?: string;
}

interface AgendaCalendarProps {
  items: CalendarAgendaItem[];
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTH_LABELS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Casellario calendario mensile: griglia di giorni con i record delle
 * tabelle che hanno una data (appuntamenti, prenotazioni, scadenze...),
 * riusando gli stessi dati già scaricati dalla Dashboard — nessuna nuova
 * chiamata di rete, nessun dato inventato. */
export default function AgendaCalendar({ items }: AgendaCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarAgendaItem[]>();
    for (const item of items) {
      const d = new Date(item.date);
      if (isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    const startWeekday = (cursor.getDay() + 6) % 7; // lunedì come primo giorno
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
    const result: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < totalCells; i++) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), i - startWeekday + 1);
      result.push({ date, inMonth: date.getMonth() === cursor.getMonth() });
    }
    return result;
  }, [cursor]);

  const today = new Date();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold capitalize text-tenant-text">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="rounded-lg p-1.5 text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
            aria-label="Mese precedente"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
          >
            Oggi
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="rounded-lg p-1.5 text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
            aria-label="Mese successivo"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-tenant-text-secondary">
            {d}
          </div>
        ))}
        {cells.map(({ date, inMonth }, i) => {
          const dayItems = itemsByDay.get(dayKey(date)) || [];
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              className={cn(
                'flex min-h-[72px] flex-col gap-1 rounded-lg border p-1.5',
                inMonth ? 'border-tenant-border bg-tenant-card' : 'border-transparent bg-transparent opacity-40',
                isToday && 'border-tenant-primary ring-1 ring-tenant-primary'
              )}
            >
              <span className={cn('text-[11px] font-semibold', isToday ? 'text-tenant-primary' : 'text-tenant-text-secondary')}>
                {date.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayItems.slice(0, 2).map((item, j) => (
                  <span
                    key={j}
                    title={item.recordLabel}
                    className="truncate rounded bg-tenant-primary/10 px-1 py-0.5 text-[10px] font-medium text-tenant-primary"
                  >
                    {item.recordLabel}
                  </span>
                ))}
                {dayItems.length > 2 && (
                  <span className="text-[10px] text-tenant-text-secondary">+{dayItems.length - 2} altri</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
