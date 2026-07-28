'use client';

import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldDef {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  fixed?: boolean;
}

interface TableDef {
  name: string;
  label: string;
  labelPlural: string;
  icon: string;
  fields: FieldDef[];
  color?: string;
}

interface EditTableModalProps {
  table: TableDef;
  onSave: (data: { name?: string; label?: string; labelPlural?: string; fields: FieldDef[] }) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  colors?: unknown;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Testo' },
  { value: 'number', label: 'Numero' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Selezione' },
  { value: 'textarea', label: 'Testo Lungo' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Telefono' },
  { value: 'checkbox', label: 'Checkbox' },
];

export default function EditTableModal({
  table, onSave, onClose, saving,
}: EditTableModalProps) {
  const [tableName, setTableName] = useState(table.name || '');
  const [tableLabel, setTableLabel] = useState(table.label || '');
  const [tableLabelPlural, setTableLabelPlural] = useState(table.labelPlural || '');
  const [fields, setFields] = useState<FieldDef[]>(() =>
    table.fields.map(f => ({ ...f }))
  );

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { name: '', label: '', type: 'text', required: false, options: [], fixed: false },
    ]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const updateField = (index: number, key: keyof FieldDef, value: unknown) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };

      // Auto-genera name dal label
      if (key === 'label') {
        next[index].name = String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
      }

      return next;
    });
  };

  const moveField = (index: number, direction: 'up' | 'down') => {
    setFields((prev) => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validFields = fields.filter((f) => f.name.trim() && f.label.trim());
    if (validFields.length === 0) return;
    await onSave({
      name: tableName,
      label: tableLabel,
      labelPlural: tableLabelPlural,
      fields: validFields,
    });
  };

  const sectionCard = 'rounded-xl border border-tenant-border bg-tenant-card-alt p-5';
  const sectionTitle = 'mb-3 text-[15px] font-bold uppercase tracking-wide text-tenant-text';
  const smallSelectClasses = 'w-full appearance-none rounded-md border border-tenant-input-border bg-tenant-input-bg py-1.5 pl-2.5 pr-7 text-[13px] text-tenant-text outline-none disabled:bg-tenant-card-alt';
  const smallInputClasses = 'w-full rounded-md border border-tenant-input-border bg-tenant-input-bg px-2.5 py-1.5 text-[13px] text-tenant-text outline-none focus:border-tenant-primary disabled:bg-tenant-card-alt';

  return (
    <Dialog open onClose={onClose} maxWidthClassName="max-w-[720px]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="m-0 text-xl font-bold text-tenant-text">Modifica Tabella</h2>
          <p className="mt-1 text-[13px] text-tenant-text-secondary">{table.labelPlural} · {table.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-tenant-text-secondary transition-colors hover:bg-tenant-card-alt hover:text-tenant-text"
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        {/* METADATI TABELLA */}
        <div className={sectionCard}>
          <div className={sectionTitle}>Nome Tabella</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Nome (identificativo)</Label>
              <Input
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_'))}
                placeholder="nome_tabella"
              />
            </div>
            <div>
              <Label>Label (singolare)</Label>
              <Input type="text" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <Label>Label (plurale)</Label>
              <Input type="text" value={tableLabelPlural} onChange={(e) => setTableLabelPlural(e.target.value)} placeholder="Nomi" />
            </div>
          </div>
        </div>

        {/* CAMPI */}
        <div className={sectionCard}>
          <div className="mb-3 flex items-center justify-between">
            <div className={sectionTitle}>Campi della Tabella</div>
            <span className="text-xs text-tenant-text-secondary">{fields.length} campi</span>
          </div>

          <div className="mb-3 flex flex-col gap-2">
            {fields.map((field, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-tenant-border bg-tenant-card p-3',
                  field.fixed && 'opacity-70'
                )}
              >
                {/* Move buttons */}
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveField(i, 'up')}
                    disabled={i === 0}
                    className="p-0.5 leading-none text-tenant-text-secondary disabled:text-tenant-border"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(i, 'down')}
                    disabled={i === fields.length - 1}
                    className="p-0.5 leading-none text-tenant-text-secondary disabled:text-tenant-border"
                  >
                    ▼
                  </button>
                </div>

                <div className="min-w-0 flex-[1_1_25%]">
                  <Label className="text-[11px]">Label</Label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(i, 'label', e.target.value)}
                    placeholder="Nome campo"
                    disabled={field.fixed}
                    className={smallInputClasses}
                  />
                </div>
                <div className="w-[110px] shrink-0">
                  <Label className="text-[11px]">Tipo</Label>
                  <div className="relative">
                    <select
                      value={field.type}
                      onChange={(e) => updateField(i, 'type', e.target.value)}
                      disabled={field.fixed}
                      className={smallSelectClasses}
                    >
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft.value} value={ft.value}>{ft.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 self-end pb-1.5">
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-tenant-text-secondary">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(i, 'required', e.target.checked)}
                      disabled={field.fixed}
                      className="accent-tenant-primary"
                    />
                    Richiesto
                  </label>
                </div>
                <div className="self-end pb-1.5">
                  <Button
                    type="button"
                    variant={field.fixed ? 'ghost' : 'destructive'}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeField(i)}
                    disabled={field.fixed || fields.length <= 1}
                    title={field.fixed ? 'Campo fisso non eliminabile' : 'Elimina campo'}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                {field.fixed && (
                  <span className="self-end whitespace-nowrap pb-1.5 text-[10px] font-medium text-tenant-text-secondary">
                    FISSO
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addField}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-tenant-border py-2 text-[13px] font-semibold text-tenant-primary transition-colors hover:bg-tenant-primary/5"
          >
            <Plus size={14} /> Aggiungi Campo
          </button>
        </div>

        {/* BUTTONS */}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={saving || fields.filter((f) => f.name && f.name.trim()).length === 0}>
            {saving ? 'Salvataggio...' : 'Salva Tabella'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
