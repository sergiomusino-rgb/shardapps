'use client';

import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { TableDef, fieldName } from './table-definitions';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ImageFieldInput from './ImageFieldInput';

interface AppRecord {
  id: string;
  dati_personalizzati?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DynamicRecordModalProps {
  table: TableDef;
  record: AppRecord | null; // null = new record
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
  colors: unknown;
  /**
   * Record disponibili per popolare le select di relazione (field.targetTable),
   * chiave = nome tabella target. Generico su qualunque entità collegata —
   * non più 3 liste fisse per clienti/prodotti/ordini (le tabelle demo del
   * motore v1): copre anche le entità relazionate generate da CreatorAI
   * (adminPanel.entities, type:'relation', vedi site-schema.ts).
   */
  relationRecords?: Record<string, Array<{ id: string; [key: string]: unknown }>>;
  /** Fase 4: true per il ruolo 'viewer' — disabilita ogni campo e nasconde
   * "Salva". Difesa in profondità: i punti d'ingresso che aprono questa
   * modale (Nuovo/Modifica) sono già nascosti per 'viewer' in
   * DynamicDataTable/RecordCardGrid/DynamicLayoutRenderer/Dashboard, questa
   * è la rete di sicurezza per se la modale venisse comunque aperta. */
  readOnly?: boolean;
}

const SELECT_CLASSES = 'flex h-10 w-full appearance-none rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3.5 pr-9 py-2 text-sm text-tenant-text outline-none transition-colors focus:border-tenant-primary disabled:cursor-not-allowed disabled:opacity-60';

export default function DynamicRecordModal({
  table, record, onSave, onClose, saving,
  relationRecords = {}, readOnly = false,
}: DynamicRecordModalProps) {
  const isEdit = record !== null;

  // Stato per campi FISSI
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (record) {
      const data: Record<string, unknown> = {};
      table.fields.forEach((f) => {
        const fn = fieldName(f);
        data[fn] = record[fn] ?? '';
      });
      return data;
    }
    const data: Record<string, unknown> = {};
    table.fields.forEach((f) => {
      data[fieldName(f)] = f.type === 'checkbox' ? false : '';
    });
    return data;
  });

  // Stato per DATI_PERSONALIZZATI
  const [dynamicFields, setDynamicFields] = useState<Record<string, string>>(() => {
    if (record?.dati_personalizzati) {
      const dp: Record<string, string> = {};
      Object.entries(record.dati_personalizzati).forEach(([k, v]) => {
        dp[k] = String(v ?? '');
      });
      return dp;
    }
    return {};
  });

  // Nuova chiave/valore da aggiungere
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleChange = (fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleDynamicChange = (key: string, value: string) => {
    setDynamicFields((prev) => ({ ...prev, [key]: value }));
  };

  const removeDynamicField = (key: string) => {
    setDynamicFields((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addDynamicField = () => {
    const trimmedKey = newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!trimmedKey) return;
    if (dynamicFields[trimmedKey] !== undefined) {
      alert('Chiave già esistente');
      return;
    }
    setDynamicFields((prev) => ({ ...prev, [trimmedKey]: newValue }));
    setNewKey('');
    setNewValue('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Costruisce il payload: campi fissi + dati_personalizzati
    const payload: Record<string, unknown> = { ...formData };

    // Aggiunge dati_personalizzati solo se ci sono chiavi dinamiche
    if (Object.keys(dynamicFields).length > 0) {
      payload.dati_personalizzati = { ...dynamicFields };
    }

    onSave(payload);
  };

  // Helper per ottenere i record di una tabella target: generico su
  // qualunque targetTable presente in relationRecords, con displayField
  // esplicito (field.targetLabel) invece di un ternario hardcoded sui 3 nomi
  // delle tabelle demo — funziona anche per un'entità relazionata qualunque
  // generata da CreatorAI.
  const getTargetRecords = (targetTable?: string, displayField?: string): Array<{ id: string; label: string }> => {
    if (!targetTable) return [];
    const records = relationRecords[targetTable] || [];
    return records.map((r) => ({
      id: String(r.id),
      label: String((displayField ? r[displayField] : undefined) ?? r.id ?? ''),
    }));
  };

  return (
    <Dialog open onClose={onClose} maxWidthClassName="max-w-[640px]">
      <DialogHeader title={isEdit ? `Modifica ${table.label}` : `Nuovo ${table.label}`} onClose={onClose} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        {/* ─── CAMPI FISSI ─── */}
        <div className="rounded-xl border border-tenant-border bg-tenant-card-alt p-5">
          <div className="mb-3 text-[15px] font-bold uppercase tracking-wide text-tenant-text">Campi Fissi</div>
          {table.fields.map((field) => {
            const fn = fieldName(field);
            return (
              <div key={fn} className="mb-3.5">
                <Label>
                  {field.label}
                  {field.required && <span className="ml-1 text-tenant-danger">*</span>}
                </Label>

                {/* Campo di relazione (select con dati da altra tabella) */}
                {field.targetTable ? (
                  <div className="relative">
                    <select
                      value={String(formData[fn] ?? '')}
                      onChange={(e) => handleChange(fn, e.target.value)}
                      className={SELECT_CLASSES}
                      disabled={readOnly}
                    >
                      <option value="">Seleziona {field.targetLabel || field.label}...</option>
                      {getTargetRecords(field.targetTable, field.targetLabel).map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
                  </div>
                ) : field.type === 'textarea' ? (
                  <Textarea
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                    rows={3}
                    disabled={readOnly}
                  />
                ) : field.type === 'select' ? (
                  <div className="relative">
                    <select
                      value={String(formData[fn] ?? '')}
                      onChange={(e) => handleChange(fn, e.target.value)}
                      className={SELECT_CLASSES}
                      disabled={readOnly}
                    >
                      <option value="">Seleziona...</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
                  </div>
                ) : field.type === 'image' ? (
                  <ImageFieldInput
                    value={String(formData[fn] ?? '')}
                    onChange={(url) => handleChange(fn, url)}
                  />
                ) : field.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formData[fn])}
                      onChange={(e) => handleChange(fn, e.target.checked)}
                      className="h-[18px] w-[18px] accent-tenant-primary"
                      disabled={readOnly}
                    />
                    <span className="text-sm text-tenant-text">
                      {formData[fn] ? 'Attivo' : 'Non attivo'}
                    </span>
                  </label>
                ) : field.type === 'number' ? (
                  <Input
                    type="number"
                    step="0.01"
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                    disabled={readOnly}
                  />
                ) : field.type === 'date' ? (
                  <Input
                    type="date"
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                    disabled={readOnly}
                  />
                ) : (
                  <Input
                    type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                    disabled={readOnly}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ─── CAMPI PERSONALIZZATI (dinamici) ─── */}
        <div className="rounded-xl border border-tenant-border bg-tenant-card-alt p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[15px] font-bold uppercase tracking-wide text-tenant-text">Campi Personalizzati</div>
            <span className="text-xs italic text-tenant-text-secondary">{Object.keys(dynamicFields).length} campi</span>
          </div>

          {/* Lista campi dinamici esistenti */}
          {Object.entries(dynamicFields).length === 0 ? (
            <p className="p-4 text-center text-[13px] text-tenant-text-secondary">
              Nessun campo personalizzato. Aggiungine uno qui sotto.
            </p>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              {Object.entries(dynamicFields).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2 rounded-lg border border-tenant-border bg-tenant-card px-3 py-2">
                  <div className="shrink-0 rounded bg-tenant-primary/15 px-2 py-1 font-mono text-xs font-semibold text-tenant-primary">
                    {key}
                  </div>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => handleDynamicChange(key, e.target.value)}
                    className="flex-1 border-none bg-transparent text-sm text-tenant-text outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Valore..."
                    disabled={readOnly}
                  />
                  {!readOnly && (
                    <Button type="button" variant="destructive" size="icon" className="h-7 w-7" onClick={() => removeDynamicField(key)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Aggiungi nuovo campo dinamico: nascosto in sola lettura, non solo
              disabilitato — non c'è nulla di sensato da "compilare e non poter
              inviare" qui, a differenza dei campi fissi sopra (mostrare il
              valore esistente ha comunque senso in sola lettura). */}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-tenant-border bg-tenant-card/50 p-3">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Nome campo (es. sconto_fedelta)"
                className="w-full shrink-0 rounded-md border border-tenant-input-border bg-tenant-input-bg px-3 py-2 font-mono text-[13px] text-tenant-text outline-none focus:border-tenant-primary sm:w-40"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDynamicField())}
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Valore iniziale"
                className="flex-1 rounded-md border border-tenant-input-border bg-tenant-input-bg px-3 py-2 text-[13px] text-tenant-text outline-none focus:border-tenant-primary"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDynamicField())}
              />
              <Button type="button" variant={newKey.trim() ? 'default' : 'ghost'} disabled={!newKey.trim()} onClick={addDynamicField} className="whitespace-nowrap">
                <Plus size={14} /> Aggiungi
              </Button>
            </div>
          )}
        </div>

        {/* ─── BUTTONS ─── */}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>{readOnly ? 'Chiudi' : 'Annulla'}</Button>
          {/* Fase 4: "Salva" nascosto in sola lettura invece che solo
              disabilitato — evita di far scoprire il blocco al click. */}
          {!readOnly && (
            <Button type="submit" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
