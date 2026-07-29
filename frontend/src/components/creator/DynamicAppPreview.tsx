'use client';

// ─── DynamicAppPreview ──────────────────────────────────────────────────────────
// Anteprima "live" (stile Totalum/Hercules) dello schema generato dal Creator AI:
// sidebar navigabile, dashboard cards e una griglia dati mock, tutto tematizzato
// sul primaryColor restituito dal modello. Puramente client-side: non chiama
// nessuna API, riceve lo schema già generato/sanitizzato dal chiamante.

import { useState } from 'react';
import { RefreshCw, Rocket, Loader2, Table as TableIcon, LayoutDashboard } from 'lucide-react';
import type { BlueprintJSON, Field } from '@/src/lib/blueprint-schema';

const HEX_COLOR_RE = /^#([0-9a-f]{6})$/i;

function mockCellValue(field: Field, seed: number): string {
  switch (field.type) {
    case 'number':
      return String(100 + seed * 37);
    case 'currency':
      return `€ ${(19.9 + seed * 12.5).toFixed(2)}`;
    case 'boolean':
      return seed % 2 === 0 ? '✅' : '—';
    case 'date':
      return new Date(Date.now() - seed * 86400000).toLocaleDateString('it-IT');
    case 'datetime':
      return new Date(Date.now() - seed * 3600000).toLocaleString('it-IT');
    case 'select':
    case 'multiselect':
      return field.options?.[seed % Math.max(field.options.length, 1)] || '—';
    case 'email':
      return `cliente${seed + 1}@esempio.it`;
    case 'phone':
      return `+39 333 000 0${seed}${seed}0`;
    case 'relation':
      return `→ #${seed + 1}`;
    case 'image':
    case 'file':
      return '📎 allegato';
    default:
      return ['Esempio Alfa', 'Esempio Beta', 'Esempio Gamma'][seed % 3];
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(99,102,241,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface DynamicAppPreviewLabels {
  previewLabel: string;
  tablesLabel: string;
  fieldsLabel: string;
  dashboardLabel: string;
  regenerateLabel: string;
  confirmLabel: string;
  creatingLabel: string;
  emptyLabel: string;
}

export default function DynamicAppPreview({
  schema,
  onRegenerate,
  onConfirm,
  isCreating,
  labels,
}: {
  schema: BlueprintJSON;
  onRegenerate: () => void;
  onConfirm: () => void;
  isCreating: boolean;
  labels: DynamicAppPreviewLabels;
}) {
  const tables = schema.schema?.tables || [];
  const [activeIndex, setActiveIndex] = useState(0);
  const activeTable = tables[Math.min(activeIndex, Math.max(tables.length - 1, 0))];
  const color = HEX_COLOR_RE.test(schema.ui?.primaryColor || '') ? schema.ui.primaryColor : '#6366f1';
  const cards = schema.ui?.dashboardCards || [];
  const slugPreview = (schema.appName || 'anteprima')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-gray-800">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">{labels.previewLabel}</p>
          <h2 className="text-xl font-bold text-white truncate">{schema.appName}</h2>
          {schema.description && (
            <p className="text-sm text-gray-400 mt-1 max-w-lg line-clamp-2">{schema.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 whitespace-nowrap">{tables.length} {labels.tablesLabel}</span>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isCreating}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {labels.regenerateLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isCreating}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-colors"
            style={{ backgroundColor: color }}
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {isCreating ? labels.creatingLabel : labels.confirmLabel}
          </button>
        </div>
      </div>

      {/* Mock app window */}
      <div className="p-5">
        <div className="rounded-xl border border-gray-700 overflow-hidden bg-gray-950 shadow-2xl">
          {/* Fake browser bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            <span className="ml-3 text-[11px] text-gray-500 font-mono truncate">
              zeusx.app/a/{slugPreview || 'anteprima'}
            </span>
          </div>

          <div className="flex min-h-[420px]">
            {/* Sidebar */}
            <aside
              className="w-44 sm:w-48 shrink-0 flex flex-col text-white p-3 gap-1 overflow-y-auto"
              style={{ background: `linear-gradient(180deg, ${hexToRgba(color, 0.95)}, ${hexToRgba(color, 0.75)})` }}
            >
              <div className="flex items-center gap-2 px-2 py-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-sm font-bold shrink-0">
                  {(schema.appName || 'A').charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-semibold truncate">{schema.appName}</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium bg-white/15">
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                {labels.dashboardLabel}
              </div>
              {tables.map((table, i) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                    i === activeIndex ? 'bg-white/25' : 'hover:bg-white/10 text-white/85'
                  }`}
                >
                  <span className="text-base leading-none shrink-0">{table.icon || '📋'}</span>
                  <span className="truncate">{table.labelPlural || table.label}</span>
                </button>
              ))}
            </aside>

            {/* Main panel */}
            <div className="flex-1 min-w-0 bg-gray-950 p-5 overflow-x-auto">
              {cards.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {cards.slice(0, 4).map((card, i) => (
                    <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                      <p className="text-[11px] text-gray-500 truncate">{card.label || card.table}</p>
                      <p className="text-lg font-bold text-white mt-1">{[128, 42, 7, 980][i % 4]}</p>
                    </div>
                  ))}
                </div>
              )}

              {activeTable ? (
                <div className="rounded-lg border border-gray-800 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-800">
                    <p className="text-sm font-semibold text-white truncate">{activeTable.labelPlural || activeTable.label}</p>
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                      {activeTable.fields.length} {labels.fieldsLabel}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-900/60">
                          {activeTable.fields.slice(0, 6).map((f) => (
                            <th
                              key={f.id}
                              className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap"
                            >
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1, 2].map((row) => (
                          <tr key={row} className="border-t border-gray-800/80">
                            {activeTable.fields.slice(0, 6).map((f) => (
                              <td key={f.id} className="px-4 py-2.5 text-gray-300 whitespace-nowrap">
                                {mockCellValue(f, row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[200px] text-gray-600 text-sm gap-2">
                  <TableIcon className="w-4 h-4" />
                  {labels.emptyLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
