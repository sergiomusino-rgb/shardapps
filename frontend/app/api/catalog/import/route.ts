// ─── Comandi: Catalog Bulk Import API Route (Next.js App Router) ──────────────
// Importazione massiva del catalogo prodotti da file Excel (.xlsx) o CSV,
// con colonne standard: code, name, category, price, unit. Usa il pacchetto
// 'xlsx' (SheetJS) per leggere entrambi i formati con la stessa API — NB:
// installato dal CDN ufficiale SheetJS (non dal registry npm, fermo alla
// 0.18.5 con una vulnerabilità nota di prototype pollution, vedi
// package.json: "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz").
//
// Sicurezza: stesso principio delle altre route Comandi (agent-voice-order,
// generate-video) — tenant_id derivato ESCLUSIVAMENTE dall'utente risolto dal
// token Bearer via tenant_members, mai da un valore fornito dal client. In
// più, a differenza delle altre route, questa richiede esplicitamente ruolo
// 'owner' o 'admin': modificare in blocco il catalogo prodotti (prezzi
// inclusi) non è un'azione che 'member' (cassa) o 'agent' devono poter fare.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import type { Database } from '@/types/database';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 5000;
const UPSERT_CHUNK_SIZE = 500;

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Alcuni browser/OS inviano un mime type generico per file .csv/.xlsx.
  'application/octet-stream',
  '',
]);

interface RowError {
  row: number;
  error: string;
}

interface CatalogImportRow {
  tenant_id: string;
  sku: string;
  name: string;
  category: string | null;
  unit_price: number;
  unit_of_measure: string;
}

// ─── Client Supabase ────────────────────────────────────────────────────────

function getServiceSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Stesso pattern usato in app/api/agent-voice-order/route.ts: l'app non usa
// @supabase/ssr, quindi niente cookie di sessione — il token va letto
// dall'header Authorization e validato esplicitamente.
async function getUserIdFromBearerToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch (err) {
    console.error('[catalog-import] Auth error:', err);
    return null;
  }
}

// ─── Parsing & validazione righe ────────────────────────────────────────────

// Lettura case/whitespace-insensitive dell'header: il template generato usa
// esattamente questi nomi, ma un utente potrebbe rinominarli con maiuscole
// diverse aprendo il file in Excel.
function getField(row: Record<string, unknown>, name: string): string {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name);
  if (key === undefined) return '';
  const value = row[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

// Accetta sia il formato "1234.56" sia quello europeo "1.234,56" / "12,50",
// oltre a simboli di valuta/spazi residui da un export mal formattato.
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[€$\s]/g, '');
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    cleaned = cleaned.replace(',', '.');
  }
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseWorkbookRows(buffer: Buffer): Record<string, unknown>[] {
  // XLSX riconosce dal contenuto sia i formati binari Excel (.xlsx/.xls) sia
  // il testo CSV, quindi una sola API copre entrambi i formati richiesti.
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

interface ValidationResult {
  validRows: CatalogImportRow[];
  errors: RowError[];
}

function validateRows(rawRows: Record<string, unknown>[], tenantId: string): ValidationResult {
  const errors: RowError[] = [];
  const bySku = new Map<string, { row: number; item: CatalogImportRow }>();

  rawRows.forEach((raw, index) => {
    // Riga 1 = header, quindi la prima riga dati è la 2.
    const rowNumber = index + 2;

    const code = getField(raw, 'code');
    const name = getField(raw, 'name');
    const category = getField(raw, 'category');
    const priceRaw = getField(raw, 'price');
    const unit = getField(raw, 'unit');

    if (!code && !name && !priceRaw) {
      // Riga completamente vuota (comune a fine file su export Excel): la
      // saltiamo silenziosamente, non è un errore da segnalare all'utente.
      return;
    }

    if (!code) {
      errors.push({ row: rowNumber, error: 'Campo "code" mancante' });
      return;
    }
    if (!name) {
      errors.push({ row: rowNumber, error: 'Campo "name" mancante' });
      return;
    }
    const price = parsePrice(priceRaw);
    if (price === null) {
      errors.push({ row: rowNumber, error: `Campo "price" non valido: "${priceRaw}"` });
      return;
    }

    // Due righe con lo stesso codice non possono coesistere in un unico
    // upsert (ON CONFLICT non può aggiornare due volte la stessa riga nella
    // stessa istruzione): vince l'ultima occorrenza, le precedenti sono
    // segnalate come sostituite invece di fallire silenziosamente.
    const existing = bySku.get(code);
    if (existing) {
      errors.push({ row: existing.row, error: `Codice "${code}" duplicato nel file: sostituito dalla riga ${rowNumber}` });
    }

    bySku.set(code, {
      row: rowNumber,
      item: {
        tenant_id: tenantId,
        sku: code,
        name,
        category: category || null,
        unit_price: price,
        unit_of_measure: unit || 'pz',
      },
    });
  });

  const validRows = Array.from(bySku.values()).map((entry) => entry.item);
  return { validRows, errors };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ─── POST /api/catalog/import ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    console.error('[catalog-import] Supabase non configurato correttamente.');
    return NextResponse.json(
      { success: false, error: 'Servizio non configurato correttamente. Contatta il supporto.', code: 'CONFIG_ERROR' },
      { status: 500 }
    );
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const userId = await getUserIdFromBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Autenticazione richiesta.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const supabaseAdmin = getServiceSupabase();

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = membership?.tenant_id as string | undefined;
  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: 'Nessun tenant associato all\'utente. Contatta il supporto.', code: 'NO_TENANT' },
      { status: 403 }
    );
  }

  const role = (membership as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json(
      { success: false, error: 'Solo il titolare o un amministratore del tenant può importare il catalogo.', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── Parsing input (multipart: file) ──────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error('[catalog-import] Errore parsing FormData:', err);
    return NextResponse.json(
      { success: false, error: 'Richiesta non valida: atteso multipart/form-data con il campo "file".', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return NextResponse.json(
      { success: false, error: 'File mancante.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  if (fileEntry.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: 'File troppo grande (max 5MB).', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  if (!ACCEPTED_MIME_TYPES.has(fileEntry.type)) {
    return NextResponse.json(
      { success: false, error: 'Formato file non supportato: usa .xlsx o .csv.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  // ── 1. Parsing del workbook ──────────────────────────────────────────────
  let rawRows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    rawRows = parseWorkbookRows(buffer);
  } catch (err) {
    console.error('[catalog-import] Errore parsing file:', err);
    return NextResponse.json(
      { success: false, error: 'Impossibile leggere il file: verifica che sia un .xlsx o .csv valido.', code: 'PARSE_ERROR' },
      { status: 400 }
    );
  }

  if (rawRows.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Il file non contiene righe di prodotto.', code: 'EMPTY_FILE' },
      { status: 400 }
    );
  }
  if (rawRows.length > MAX_ROWS) {
    return NextResponse.json(
      { success: false, error: `Il file supera il limite di ${MAX_ROWS} prodotti per importazione.`, code: 'TOO_MANY_ROWS' },
      { status: 400 }
    );
  }

  // ── 2. Validazione + pulizia righe ───────────────────────────────────────
  const { validRows, errors } = validateRows(rawRows, tenantId);

  if (validRows.length === 0) {
    return NextResponse.json({
      success: true,
      data: { importedCount: 0, skippedCount: errors.length, totalRows: rawRows.length, errors },
    });
  }

  // ── 3. Upsert a blocchi (ON CONFLICT tenant_id,sku) ──────────────────────
  // A blocchi perché una singola richiesta troppo grande rischierebbe il
  // limite di dimensione payload di PostgREST; ogni blocco che fallisce
  // (es. un problema non intercettato in validazione) viene segnalato senza
  // bloccare gli altri, per un'importazione parzialmente riuscita invece di
  // un fallimento totale.
  let importedCount = 0;
  const chunks = chunk(validRows, UPSERT_CHUNK_SIZE);

  for (const rowsChunk of chunks) {
    // Cast necessario: 'category' è una colonna aggiunta dalla migrazione
    // 20260804000000, non ancora presente nel tipo Database generato (stesso
    // scostamento già visto per altre colonne recenti in questo modulo, es.
    // orders.audio_url in app/actions/comandi-orders.ts).
    const { error: upsertError, count } = await (supabaseAdmin as any)
      .from('catalog_items')
      .upsert(rowsChunk, { onConflict: 'tenant_id,sku', count: 'exact' });

    if (upsertError) {
      console.error('[catalog-import] Errore upsert blocco catalogo:', upsertError);
      for (const failedRow of rowsChunk) {
        errors.push({ row: 0, error: `Riga "${failedRow.sku}" non salvata: ${upsertError.message}` });
      }
      continue;
    }
    importedCount += count ?? rowsChunk.length;
  }

  return NextResponse.json({
    success: true,
    data: {
      importedCount,
      skippedCount: errors.length,
      totalRows: rawRows.length,
      errors,
    },
  });
}
