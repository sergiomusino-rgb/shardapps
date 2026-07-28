'use client';

import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { TableDef, fieldName } from './table-definitions';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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
  /** Lista di record clienti per popolare select relazionate */
  clientiRecords?: Array<{ id: string; ragione_sociale?: string; [key: string]: unknown }>;
  /** Lista di record prodotti per popolare select relazionate */
  prodottiRecords?: Array<{ id: string; nome_prodotto?: string; [key: string]: unknown }>;
  /** Lista di record ordini per popolare select relazionate */
  ordiniRecords?: Array<{ id: string; numero_ordine?: string; [key: string]: unknown }>;
}

const SELECT_CLASSES = 'flex h-10 w-full appearance-none rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3.5 pr-9 py-2 text-sm text-tenant-text outline-none transition-colors focus:border-tenant-primary';

export default function DynamicRecordModal({
  table, record, onSave, onClose, saving,
  clientiRecords = [], prodottiRecords = [], ordiniRecords = [],
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

  // Helper per ottenere i record di una tabella target
  const getTargetRecords = (targetTable?: string): Array<{ id: string; label: string }> => {
    let records: Array<Record<string, unknown>> = [];
    if (targetTable === 'clienti') records = clientiRecords;
    else if (targetTable === 'prodotti') records = prodottiRecords;
    else if (targetTable === 'ordini') records = ordiniRecords;
    else return [];

    return records.map((r) => ({
      id: String(r.id),
      label: String(r[targetTable === 'clienti' ? 'ragione_sociale' : targetTable === 'prodotti' ? 'nome_prodotto' : 'numero_ordine'] ?? ''),
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
                    >
                      <option value="">Seleziona {field.targetLabel || field.label}...</option>
                      {getTargetRecords(field.targetTable).map((r) => (
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
                  />
                ) : field.type === 'select' ? (
                  <div className="relative">
                    <select
                      value={String(formData[fn] ?? '')}
                      onChange={(e) => handleChange(fn, e.target.value)}
                      className={SELECT_CLASSES}
                    >
                      <option value="">Seleziona...</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
                  </div>
                ) : field.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formData[fn])}
                      onChange={(e) => handleChange(fn, e.target.checked)}
                      className="h-[18px] w-[18px] accent-tenant-primary"
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
                  />
                ) : field.type === 'date' ? (
                  <Input
                    type="date"
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
                  />
                ) : (
                  <Input
                    type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
                    value={String(formData[fn] ?? '')}
                    onChange={(e) => handleChange(fn, e.target.value)}
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
                    className="flex-1 border-none bg-transparent text-sm text-tenant-text outline-none"
                    placeholder="Valore..."
                  />
                  <Button type="button" variant="destructive" size="icon" className="h-7 w-7" onClick={() => removeDynamicField(key)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Aggiungi nuovo campo dinamico */}
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-tenant-border bg-tenant-card/50 p-3">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Nome campo (es. sconto_fedelta)"
              className="w-40 shrink-0 rounded-md border border-tenant-input-border bg-tenant-input-bg px-3 py-2 font-mono text-[13px] text-tenant-text outline-none focus:border-tenant-primary"
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
        </div>

        {/* ─── BUTTONS ─── */}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
