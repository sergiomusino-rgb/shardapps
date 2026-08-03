'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ImageFieldInput from './ImageFieldInput';

interface ColumnDef {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}

interface CustomRecord {
  id: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CustomRecordModalProps {
  columns: ColumnDef[];
  record: CustomRecord | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
  colors?: unknown;
  tableLabel: string;
}

const SELECT_CLASSES = 'flex h-10 w-full appearance-none rounded-xl border border-tenant-input-border bg-tenant-input-bg px-3.5 pr-9 py-2 text-sm text-tenant-text outline-none transition-colors focus:border-tenant-primary';

export default function CustomRecordModal({
  columns, record, onSave, onClose, saving, tableLabel,
}: CustomRecordModalProps) {
  const isEdit = record !== null;

  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    if (record) {
      const data = (record.data || record) as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      columns.forEach((col) => {
        result[col.name] = data[col.name] ?? '';
      });
      return result;
    }
    const result: Record<string, unknown> = {};
    columns.forEach((col) => {
      result[col.name] = col.type === 'checkbox' ? false : '';
    });
    return result;
  });

  const handleChange = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title={isEdit ? `Modifica ${tableLabel}` : `Nuovo ${tableLabel}`} onClose={onClose} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        {columns.map((col) => (
          <div key={col.name}>
            <Label>
              {col.label}
              {col.required && <span className="ml-1 text-tenant-danger">*</span>}
            </Label>

            {col.type === 'textarea' ? (
              <Textarea
                value={String(formData[col.name] ?? '')}
                onChange={(e) => handleChange(col.name, e.target.value)}
                rows={3}
              />
            ) : col.type === 'select' ? (
              <div className="relative">
                <select
                  value={String(formData[col.name] ?? '')}
                  onChange={(e) => handleChange(col.name, e.target.value)}
                  className={SELECT_CLASSES}
                >
                  <option value="">Seleziona...</option>
                  {(col.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tenant-text-secondary" />
              </div>
            ) : col.type === 'image' ? (
              <ImageFieldInput
                value={String(formData[col.name] ?? '')}
                onChange={(url) => handleChange(col.name, url)}
              />
            ) : col.type === 'checkbox' ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(formData[col.name])}
                  onChange={(e) => handleChange(col.name, e.target.checked)}
                  className="h-[18px] w-[18px] accent-tenant-primary"
                />
                <span className="text-sm text-tenant-text">
                  {formData[col.name] ? 'Attivo' : 'Non attivo'}
                </span>
              </label>
            ) : col.type === 'number' ? (
              <Input
                type="number"
                step="0.01"
                value={String(formData[col.name] ?? '')}
                onChange={(e) => handleChange(col.name, e.target.value)}
              />
            ) : col.type === 'date' ? (
              <Input
                type="date"
                value={String(formData[col.name] ?? '')}
                onChange={(e) => handleChange(col.name, e.target.value)}
              />
            ) : (
              <Input
                type={col.type === 'email' ? 'email' : col.type === 'tel' ? 'tel' : 'text'}
                value={String(formData[col.name] ?? '')}
                onChange={(e) => handleChange(col.name, e.target.value)}
              />
            )}
          </div>
        ))}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
