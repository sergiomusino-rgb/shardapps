'use client';

// ─── TemplateQuickModal ─────────────────────────────────────────────────────
// Modal di input rapido mostrata alla selezione di un Template Verticale
// (dashboard/creator/page.tsx): raccoglie i 3-4 campi essenziali (QUICK_FIELDS
// in src/lib/templates.ts) e restituisce il prompt finale già composto,
// pronto per essere inviato a /api/creator/generate.

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { QUICK_FIELDS, buildTemplatePrompt, type QuickField, type QuickFieldValues, type VerticalTemplate } from '@/src/lib/templates';

interface TemplateQuickModalProps {
  template: VerticalTemplate;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}

export default function TemplateQuickModal({ template, onClose, onSubmit }: TemplateQuickModalProps) {
  const [values, setValues] = useState<QuickFieldValues>({ color: '#f97316' });

  const missingRequired = QUICK_FIELDS.some((f) => f.required && !values[f.id]?.trim());

  const handleChange = (id: QuickField['id'], value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired) return;
    onSubmit(buildTemplatePrompt(template, values));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{template.icon}</span>
            <div>
              <h2 className="text-lg font-bold text-white">{template.name}</h2>
              <p className="text-sm text-gray-400">{template.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {QUICK_FIELDS.map((field) => (
            <div key={field.id}>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                {field.label}
                {field.required && <span className="ml-1 text-amber-500">*</span>}
              </label>
              {field.type === 'color' ? (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={values.color || '#f97316'}
                    onChange={(e) => handleChange('color', e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-gray-700 bg-gray-800"
                  />
                  <span className="text-sm text-gray-400">{values.color || '#f97316'}</span>
                </div>
              ) : (
                <input
                  type={field.type}
                  value={values[field.id] || ''}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={missingRequired}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 py-3 font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
          >
            <Sparkles className="h-4 w-4" />
            Genera App
          </button>
        </form>
      </div>
    </div>
  );
}
