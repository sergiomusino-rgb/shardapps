// ─── Comandi: export tabella "Ordini" (CSV/Excel) ──────────────────────────
// Righe appiattite ordine+riga-prodotto per l'esportazione richiesta dal
// titolare: una riga per prodotto ordinato, con i riferimenti economici e
// documentali (bolla/fattura) ripetuti dall'ordine padre. Condiviso tra la
// route di download (app/api/comandi/orders-export) e quella di invio email
// (app/api/comandi/orders-export/email), che generano lo stesso file.

import * as XLSX from 'xlsx';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderExportRow {
  customer: string;
  productCode: string;
  productDescription: string;
  quantity: number;
  orderDate: string;
  unitPrice: number;
  productTotal: number;
  orderTotal: number;
  deliveryNoteNumber: string;
  invoiceNumber: string;
}

// L'ordine delle colonne segue esattamente la richiesta originale (ID
// Cliente, Numero/Codice Prodotto, Descrizione Prodotto, Quantità, Data
// Ordine, Prezzo Unitario, Prezzo Totale Prodotto, Prezzo Totale Ordine, N.
// Bolla di Accompagnamento, N. Fattura).
const EXPORT_HEADERS = [
  'ID Cliente',
  'Codice Prodotto',
  'Descrizione Prodotto',
  'Quantità',
  'Data Ordine',
  'Prezzo Unitario',
  'Prezzo Totale Prodotto',
  'Prezzo Totale Ordine',
  'N. Bolla di Accompagnamento',
  'N. Fattura',
];

export async function buildOrdersExportRows(
  supabaseAdmin: SupabaseClient,
  tenantId: string
): Promise<OrderExportRow[]> {
  const { data: orderRows } = await (supabaseAdmin as any)
    .from('orders')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const orders = (orderRows || []) as Record<string, any>[];
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: itemRows } = await (supabaseAdmin as any)
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  const items = (itemRows || []) as Record<string, any>[];

  // SKU non è salvato su order_items (solo product_name, snapshot storico):
  // recuperato dal catalogo tramite product_id quando ancora disponibile.
  const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  const skuByProductId = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: catalogRows } = await (supabaseAdmin as any)
      .from('catalog_items')
      .select('id, sku')
      .in('id', productIds);
    for (const row of (catalogRows || []) as { id: string; sku: string }[]) {
      skuByProductId.set(row.id, row.sku);
    }
  }

  const orderById = new Map(orders.map((o) => [o.id, o]));

  return items.map((item) => {
    const order = orderById.get(item.order_id) || {};
    return {
      customer: order.customer_name || '',
      productCode: (item.product_id && skuByProductId.get(item.product_id)) || '',
      productDescription: item.product_name || '',
      quantity: Number(item.quantity) || 0,
      orderDate: order.delivery_date || (order.created_at ? String(order.created_at).slice(0, 10) : ''),
      unitPrice: Number(item.unit_price) || 0,
      productTotal: Number(item.subtotal) || 0,
      orderTotal: Number(order.total_amount) || 0,
      deliveryNoteNumber: order.delivery_note_number || '',
      invoiceNumber: order.invoice_number || '',
    };
  });
}

// Anti CSV-injection: un valore che inizia con =, +, -, @ o un carattere di
// tabulazione/ritorno a capo può essere interpretato come formula da
// Excel/Google Sheets all'apertura del file (stesso pattern già in uso nel
// backend Express legacy, vedi backend/routes/app-records.js).
function sanitizeCsvValue(value: string | number): string {
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

function csvField(value: string | number): string {
  const sanitized = sanitizeCsvValue(value);
  const escaped = sanitized.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function rowsToCsv(rows: OrderExportRow[]): string {
  const lines = [EXPORT_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.customer),
        csvField(r.productCode),
        csvField(r.productDescription),
        csvField(r.quantity),
        csvField(r.orderDate),
        csvField(r.unitPrice.toFixed(2)),
        csvField(r.productTotal.toFixed(2)),
        csvField(r.orderTotal.toFixed(2)),
        csvField(r.deliveryNoteNumber),
        csvField(r.invoiceNumber),
      ].join(',')
    );
  }
  // BOM UTF-8: senza, Excel su Windows apre il CSV interpretando gli accenti
  // (è, à, ...) con l'encoding sbagliato.
  return '﻿' + lines.join('\r\n');
}

export function rowsToXlsxBuffer(rows: OrderExportRow[]): Buffer {
  const data = rows.map((r) => ({
    [EXPORT_HEADERS[0]]: r.customer,
    [EXPORT_HEADERS[1]]: r.productCode,
    [EXPORT_HEADERS[2]]: r.productDescription,
    [EXPORT_HEADERS[3]]: r.quantity,
    [EXPORT_HEADERS[4]]: r.orderDate,
    [EXPORT_HEADERS[5]]: r.unitPrice,
    [EXPORT_HEADERS[6]]: r.productTotal,
    [EXPORT_HEADERS[7]]: r.orderTotal,
    [EXPORT_HEADERS[8]]: r.deliveryNoteNumber,
    [EXPORT_HEADERS[9]]: r.invoiceNumber,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data, { header: EXPORT_HEADERS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ordini');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
