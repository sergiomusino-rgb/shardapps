'use client';

import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ColumnDef {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

interface CreateCustomTableModalProps {
  onSave: (tableData: {
    name: string;
    label: string;
    labelPlural: string;
    columns: ColumnDef[];
  }) => Promise<void>;
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

export default function CreateCustomTableModal({
  onSave, onClose, saving,
}: CreateCustomTableModalProps) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [labelPlural, setLabelPlural] = useState('');
  const [columns, setColumns] = useState<ColumnDef[]>([
    { name: 'nome', label: 'Nome', type: 'text', required: true, options: [] },
  ]);

  const addColumn = () => {
    setColumns((prev) => [
      ...prev,
      { name: '', label: '', type: 'text', required: false, options: [] },
    ]);
  };

  const removeColumn = (index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, field: keyof ColumnDef, value: unknown) => {
    setColumns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };

      // Auto-genera name dal label
      if (field === 'label') {
        next[index].name = String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
      }

      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !label.trim()) return;

    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
    const validColumns = columns.filter((c) => c.name.trim() && c.label.trim());

    if (validColumns.length === 0) return;

    await onSave({
      name: sanitizedName,
      label: label.trim(),
      labelPlural: labelPlural.trim() || label.trim() + 'i',
      columns: validColumns,
    });
  };

  const sectionCard = 'rounded-xl border border-tenant-border bg-tenant-card-alt p-5';
  const sectionTitle = 'mb-3 text-[15px] font-bold uppercase tracking-wide text-tenant-text';
  const smallSelectClasses = 'w-full appearance-none rounded-md border border-tenant-input-border bg-tenant-input-bg py-1.5 pl-2.5 pr-7 text-[13px] text-tenant-text outline-none';
  const smallInputClasses = 'w-full rounded-md border border-tenant-input-border bg-tenant-input-bg px-2.5 py-1.5 text-[13px] text-tenant-text outline-none focus:border-tenant-primary';

  return (
    <Dialog open onClose={onClose} maxWidthClassName="max-w-[640px]">
      <DialogHeader title="Nuova Tabella Personalizzata" onClose={onClose} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        {/* INFO TABELLA */}
        <div className={sectionCard}>
          <div className={sectionTitle}>Info Tabella</div>
          <div className="flex flex-col gap-3">
            <div>
              <Label>Nome Tabella (per il sistema)</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/[^a-z0-9_ ]/g, '').replace(/\s+/g, '_');
                  setName(v);
                }}
                placeholder="es. fornitori"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Nome Visualizzato (singolare)</Label>
              <Input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="es. Fornitore" />
            </div>
            <div>
              <Label>Nome Visualizzato (plurale)</Label>
              <Input type="text" value={labelPlural} onChange={(e) => setLabelPlural(e.target.value)} placeholder="es. Fornitori" />
            </div>
          </div>
        </div>

        {/* COLONNE */}
        <div className={sectionCard}>
          <div className="mb-3 flex items-center justify-between">
            <div className={sectionTitle}>Colonne</div>
            <span className="text-xs text-tenant-text-secondary">{columns.length} colonne</span>
          </div>

          <div className="mb-3 flex flex-col gap-2.5">
            {columns.map((col, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-tenant-border bg-tenant-card p-3">
                <div className="min-w-0 flex-[1_1_30%]">
                  <Label className="text-[11px]">Label</Label>
                  <input
                    type="text"
                    value={col.label}
                    onChange={(e) => updateColumn(i, 'label', e.target.value)}
                    placeholder="Nome campo"
                    className={smallInputClasses}
                  />
                </div>
                <div className="w-[110px] shrink-0">
                  <Label className="text-[11px]">Tipo</Label>
                  <div className="relative">
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(i, 'type', e.target.value)}
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
                      checked={col.required}
                      onChange={(e) => updateColumn(i, 'required', e.target.checked)}
                      className="accent-tenant-primary"
                    />
                    Richiesto
                  </label>
                </div>
                <div className="self-end pb-1.5">
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeColumn(i)}
                    disabled={columns.length <= 1}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addColumn}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-tenant-border py-2 text-[13px] font-semibold text-tenant-primary transition-colors hover:bg-tenant-primary/5"
          >
            <Plus size={14} /> Aggiungi Colonna
          </button>
        </div>

        {/* BUTTONS */}
        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
          <Button
            type="submit"
            disabled={saving || !name.trim() || !label.trim() || columns.filter((c) => c.name.trim()).length === 0}
          >
            {saving ? 'Creazione...' : 'Crea Tabella'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
