'use client';

// ─── Impostazioni Attività ──────────────────────────────────────────────────
// Form di modifica di config.businessConfig (site-schema.ts, motore Sito/PWA
// Creator v2): stessi dati letti dal sito pubblico (Hero, Chi Siamo, Contatti),
// incorporato come sezione dentro SettingsModal (page.tsx) invece di una
// modale a sé — visibile solo per le app che hanno un businessConfig (le app
// del vecchio motore tabellare non ce l'hanno).

import { useState, type ChangeEvent } from 'react';
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { BusinessConfig } from '@/src/lib/site-schema';

interface BusinessConfigColors {
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  inputBg: string;
  inputBorder: string;
  primary: string;
  danger: string;
  success: string;
}

export default function BusinessConfigForm({
  value,
  colors,
  saving,
  error,
  saved,
  onSave,
}: {
  value: BusinessConfig;
  colors: BusinessConfigColors;
  saving: boolean;
  error: string | null;
  saved: boolean;
  onSave: (next: BusinessConfig) => void;
}) {
  // Niente useEffect di risincronizzazione: questa sezione vive dentro
  // SettingsModal, montata solo mentre showSettings è true, quindi riparte da
  // zero con l'ultimo `value` ogni volta che si riapre — non serve altro per
  // riflettere un save riuscito.
  const [form, setForm] = useState<BusinessConfig>(value);

  const update = <K extends keyof BusinessConfig>(key: K, val: BusinessConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const updateHour = (index: number, field: 'day' | 'hours', val: string) => {
    setForm((prev) => {
      const openingHours = prev.openingHours.map((h, i) => (i === index ? { ...h, [field]: val } : h));
      return { ...prev, openingHours };
    });
  };

  const addHour = () => setForm((prev) => ({ ...prev, openingHours: [...prev.openingHours, { day: '', hours: '' }] }));
  const removeHour = (index: number) =>
    setForm((prev) => ({ ...prev, openingHours: prev.openingHours.filter((_, i) => i !== index) }));

  const handleImageFile = (key: 'logoUrl' | 'heroImageUrl') => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => update(key, ((ev.target?.result as string) || '') as BusinessConfig[typeof key]);
    reader.readAsDataURL(file);
  };

  const inputStyle = { background: colors.inputBg, borderColor: colors.inputBorder, color: colors.text };
  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:opacity-90';
  const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide';
  const subCard = 'rounded-lg border p-4';

  return (
    <div className="flex flex-col gap-4">
      {/* Identità */}
      <div className={subCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.textSecondary }}>Identità</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Nome Azienda</label>
            <input className={inputClass} style={inputStyle} value={form.name} onChange={(e) => update('name', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Subtitle / Payoff</label>
            <input className={inputClass} style={inputStyle} value={form.tagline} onChange={(e) => update('tagline', e.target.value)} placeholder="Frase breve d'effetto" />
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Descrizione / Note</label>
            <textarea className={inputClass} style={inputStyle} rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Presentazione dell'attività mostrata nella pagina Chi Siamo" />
          </div>
        </div>
      </div>

      {/* Contatti */}
      <div className={subCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.textSecondary }}>Contatti</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Indirizzo</label>
            <input className={inputClass} style={inputStyle} value={form.address} onChange={(e) => update('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={{ color: colors.textSecondary }}>Telefono</label>
              <input className={inputClass} style={inputStyle} value={form.phone} onChange={(e) => update('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelClass} style={{ color: colors.textSecondary }}>Numero WhatsApp</label>
              <input className={inputClass} style={inputStyle} value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClass} style={{ color: colors.textSecondary }}>Email</label>
            <input className={inputClass} style={inputStyle} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Immagini */}
      <div className={subCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.textSecondary }}>Logo e Immagine di Copertina</div>
        <div className="flex flex-col gap-4">
          {([
            { key: 'logoUrl' as const, label: 'Logo' },
            { key: 'heroImageUrl' as const, label: 'Immagine di Copertina' },
          ]).map(({ key, label }) => (
            <div key={key}>
              <label className={labelClass} style={{ color: colors.textSecondary }}>{label}</label>
              {form[key] && (
                <img src={form[key]} alt={label} className="mb-2 h-16 max-w-[220px] rounded-lg border object-contain" style={{ borderColor: colors.border }} />
              )}
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  placeholder="https://..."
                />
                <label
                  className="shrink-0 cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium"
                  style={{ borderColor: colors.border, color: colors.text }}
                >
                  Sfoglia...
                  <input type="file" accept="image/*" onChange={handleImageFile(key)} className="hidden" />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Orari di apertura */}
      <div className={subCard} style={{ borderColor: colors.border, background: colors.cardBg }}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: colors.textSecondary }}>Orari di Apertura</div>
          <button
            type="button"
            onClick={addHour}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
            style={{ background: colors.primary + '20', color: colors.primary }}
          >
            <Plus size={13} /> Aggiungi
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {form.openingHours.length === 0 ? (
            <p className="text-xs" style={{ color: colors.textSecondary }}>Nessun orario configurato.</p>
          ) : (
            form.openingHours.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={h.day}
                  onChange={(e) => updateHour(i, 'day', e.target.value)}
                  placeholder="Giorni (es. Lun-Ven)"
                />
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={h.hours}
                  onChange={(e) => updateHour(i, 'hours', e.target.value)}
                  placeholder="Orario (es. 09:00-19:00)"
                />
                <button
                  type="button"
                  onClick={() => removeHour(i)}
                  className="shrink-0 rounded-lg p-2"
                  style={{ color: colors.danger }}
                  aria-label="Rimuovi orario"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-medium" style={{ background: colors.danger + '20', color: colors.danger }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(form)}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: colors.primary }}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {saving ? 'Salvataggio...' : 'Salva Dati Attività'}
        </button>
        {saved && (
          <span className="text-xs font-medium" style={{ color: colors.success }}>Salvato con successo</span>
        )}
      </div>
    </div>
  );
}
