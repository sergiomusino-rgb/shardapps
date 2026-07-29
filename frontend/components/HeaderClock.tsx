'use client';

import { useEffect, useState } from 'react';

interface HeaderClockProps {
  locale?: string;
  textColor?: string;
  mutedColor?: string;
  className?: string;
}

/**
 * Orologio + data compatti per header (dashboard ZeusX e app generate).
 * Nessuna dipendenza da Tailwind: i colori sono passati come prop così può
 * essere riusato sia nel layout a classi Tailwind sia nel renderer delle app
 * generate, che usa styling inline basato sui colori di tema per-app.
 */
export default function HeaderClock({ locale, textColor = '#e2e8f0', mutedColor = '#94a3b8', className }: HeaderClockProps) {
  // Il primo render lato server non conosce l'ora del client: si aspetta il
  // mount per evitare un mismatch di hydration tra ora del server e ora reale.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const resolvedLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'it-IT');
  const time = now.toLocaleTimeString(resolvedLocale, { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString(resolvedLocale, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', whiteSpace: 'nowrap' }}>
      <span style={{ color: textColor, fontSize: '16px', fontWeight: 700 }}>{time}</span>
      <span style={{ color: mutedColor, fontSize: '14px', textTransform: 'capitalize' }}>{date}</span>
    </div>
  );
}
