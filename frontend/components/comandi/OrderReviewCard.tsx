'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { confirmOrderAction } from '@/app/actions/comandi-orders';
import type { ParsedOrderItem, VoiceOrderExtraction } from '@/types/comandi';
import { useLanguage } from '@/src/lib/LanguageContext';

export interface OrderReviewCardProps {
  extraction: VoiceOrderExtraction;
  onOrderConfirmed?: (orderId: string) => void;
  className?: string;
}

interface EditableItem extends ParsedOrderItem {
  _key: string;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const QUANTITY_STEP = 1;
const MIN_QUANTITY = 0.01;

function makeKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCurrency(value: number): string {
  return `€ ${value.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function OrderReviewCard({ extraction, onOrderConfirmed, className = '' }: OrderReviewCardProps) {
  const { t } = useLanguage();
  const [items, setItems] = useState<EditableItem[]>(() =>
    extraction.parsed_items.map((item) => ({ ...item, _key: makeKey() }))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);

  const confidencePct = Math.round(extraction.confidence_score * 100);
  const isHighConfidence = extraction.confidence_score >= HIGH_CONFIDENCE_THRESHOLD && !extraction.requires_manual_confirmation;

  const totalAmount = useMemo(
    () => round2(items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)),
    [items]
  );

  const updateQuantity = (key: string, nextQuantity: number) => {
    const clamped = Math.max(MIN_QUANTITY, round2(nextQuantity));
    setItems((prev) => prev.map((item) => (item._key === key ? { ...item, quantity: clamped } : item)));
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((item) => item._key !== key));
  };

  const handleConfirm = async () => {
    if (items.length === 0) {
      setError(t('comandi_review_error_empty'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await confirmOrderAction({
        audio_transcript: extraction.summary_text,
        confidence_score: extraction.confidence_score,
        items: items.map((item) => ({
          product_id: item.product_id,
          sku: item.sku,
          product_name: item.matched_name,
          unit_price: item.unit_price,
          quantity: item.quantity,
          unit: item.unit,
        })),
      });

      if (!result.success || !result.orderId) {
        setError(result.error || t('comandi_review_error_save_generic'));
        return;
      }

      setSavedOrderId(result.orderId);
      onOrderConfirmed?.(result.orderId);
    } catch (err) {
      console.error('[OrderReviewCard] Errore invocazione confirmOrderAction:', err);
      setError(t('comandi_review_error_server_communication'));
    } finally {
      setIsSaving(false);
    }
  };

  if (savedOrderId) {
    return (
      <div className={`bg-gray-800 border border-green-700/50 rounded-xl p-6 flex flex-col items-center gap-3 text-center ${className}`}>
        <CheckCircle2 className="w-10 h-10 text-green-400" />
        <p className="text-white font-semibold">{t('comandi_review_saved_title')}</p>
        <p className="text-sm text-gray-400">{t('comandi_review_saved_id_label')} {savedOrderId}</p>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-col gap-5 ${className}`}>
      {/* Header: badge confidenza + riepilogo */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">{t('comandi_review_summary_label')}</p>
          <p className="text-sm text-gray-300">{extraction.summary_text}</p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            isHighConfidence
              ? 'bg-green-500/15 text-green-400 border border-green-700/50'
              : 'bg-amber-500/15 text-amber-400 border border-amber-700/50'
          }`}
        >
          {isHighConfidence ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {(isHighConfidence ? t('comandi_review_high_confidence') : t('comandi_review_low_confidence')).replace('{pct}', String(confidencePct))}
        </span>
      </div>

      {/* Righe ordine agganciate */}
      <div className="overflow-x-auto -mx-2">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-700">
              <th className="px-2 py-2 font-medium">{t('comandi_review_col_product')}</th>
              <th className="px-2 py-2 font-medium">{t('comandi_review_col_sku')}</th>
              <th className="px-2 py-2 font-medium">{t('comandi_review_col_quantity')}</th>
              <th className="px-2 py-2 font-medium">{t('comandi_review_col_unit')}</th>
              <th className="px-2 py-2 font-medium text-right">{t('comandi_review_col_unit_price')}</th>
              <th className="px-2 py-2 font-medium text-right">{t('comandi_review_col_subtotal')}</th>
              <th className="px-2 py-2 font-medium" aria-label={t('comandi_review_col_actions_aria')} />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                  {t('comandi_review_empty_rows')}
                </td>
              </tr>
            )}
            {items.map((item) => {
              const subtotal = round2(item.unit_price * item.quantity);
              return (
                <tr key={item._key} className="border-b border-gray-700/60 last:border-b-0">
                  <td className="px-2 py-2.5 text-white">
                    {item.matched_name}
                    {!item.product_id && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-700/40">
                        {t('comandi_review_not_in_catalog')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-gray-400 font-mono text-xs">{item.sku || '—'}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item._key, item.quantity - QUANTITY_STEP)}
                        className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white disabled:opacity-30"
                        disabled={item.quantity <= MIN_QUANTITY}
                        aria-label={t('comandi_review_decrease_qty_aria').replace('{name}', item.matched_name)}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        step="0.01"
                        min={MIN_QUANTITY}
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item._key, parseFloat(e.target.value) || MIN_QUANTITY)}
                        className="w-16 text-center bg-gray-900 border border-gray-700 rounded py-1 text-white tabular-nums"
                        aria-label={t('comandi_review_qty_aria').replace('{name}', item.matched_name)}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item._key, item.quantity + QUANTITY_STEP)}
                        className="w-6 h-6 flex items-center justify-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
                        aria-label={t('comandi_review_increase_qty_aria').replace('{name}', item.matched_name)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-gray-400">{item.unit}</td>
                  <td className="px-2 py-2.5 text-right text-gray-300 tabular-nums">{formatCurrency(item.unit_price)}</td>
                  <td className="px-2 py-2.5 text-right text-white font-medium tabular-nums">{formatCurrency(subtotal)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(item._key)}
                      className="p-1.5 rounded text-gray-500 hover:bg-red-500/15 hover:text-red-400"
                      aria-label={t('comandi_review_remove_item_aria').replace('{name}', item.matched_name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Articoli scartati / non riconosciuti */}
      {extraction.discarded_items.length > 0 && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-400 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t('comandi_review_discarded_header').replace('{count}', String(extraction.discarded_items.length))}
          </p>
          <ul className="space-y-1.5">
            {extraction.discarded_items.map((discarded, i) => (
              <li key={i} className="text-sm text-amber-200/90">
                <span className="italic text-amber-200/70">&ldquo;{discarded.original_spoken_text}&rdquo;</span>
                {' — '}
                <span>{discarded.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Totale + conferma */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-gray-700">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_review_total_label')}</p>
          <p className="text-2xl font-bold text-white tabular-nums">{formatCurrency(totalAmount)}</p>
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSaving || items.length === 0}
          className="flex items-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {isSaving ? t('comandi_review_saving') : t('comandi_review_confirm_button')}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
