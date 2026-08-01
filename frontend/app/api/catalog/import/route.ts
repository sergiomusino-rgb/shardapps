// ─── Comandi: Catalog Bulk Import API Route (Next.js App Router) ──────────────
// Importazione massiva del catalogo prodotti da file Excel (.xlsx) o CSV. Usa
// il pacchetto 'xlsx' (SheetJS) per leggere entrambi i formati con la stessa
// API — NB: installato dal CDN ufficiale SheetJS (non dal registry npm, fermo
// alla 0.18.5 con una vulnerabilità nota di prototype pollution, vedi
// package.json: "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz").
//
// Mappatura tollerante: le intestazioni non devono coincidere esattamente con
// le colonne di catalog_items. Vengono normalizzate (accenti/spazi/underscore
// rimossi, minuscolo) e riconosciute tramite sinonimi comuni IT/EN (vedi
// FIELD_SYNONYMS) — es. "prezzo"/"costo" per price, "nome"/"prodotto" per
// name, "immagine"/"foto" per image_url. Colonne assenti o valori non validi
// non bloccano la riga: viene applicato un fallback sicuro (name -> "Prodotto
// Senza Nome", price -> 0, category -> "Generale", description/image_url ->
// vuoto) e l'accaduto è riportato in 'errors' come nota informativa, non come
// fallimento dell'importazione.
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
  category: string;
  description: string;
  image_url: string | null;
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

type CanonicalField = 'code' | 'name' | 'category' | 'price' | 'description' | 'image_url' | 'unit';

// Sinonimi comuni (IT/EN) accettati per ogni colonna del catalogo: l'utente
// non è vincolato ai nomi esatti del template, può caricare un file esportato
// da un altro gestionale purché usi uno di questi alias.
const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  code: ['code', 'sku', 'codice', 'codiceprodotto', 'cod'],
  name: ['name', 'nome', 'prodotto', 'titolo', 'nomeprodotto', 'articolo'],
  category: ['category', 'categoria', 'gruppo', 'reparto', 'tipo'],
  price: ['price', 'prezzo', 'costo', 'prezzounitario', 'importo'],
  description: ['description', 'descrizione', 'note', 'desc'],
  image_url: ['imageurl', 'immagine', 'foto', 'immagineurl', 'fotourl', 'image', 'img'],
  unit: ['unit', 'unita', 'unitadimisura', 'um', 'unitamisura'],
};

const SYNONYM_TO_FIELD = new Map<string, CanonicalField>();
(Object.entries(FIELD_SYNONYMS) as [CanonicalField, string[]][]).forEach(([field, synonyms]) => {
  synonyms.forEach((synonym) => SYNONYM_TO_FIELD.set(synonym, field));
});

// Normalizza un'intestazione per il confronto: rimuove accenti, spazi,
// underscore e trattini, converte in minuscolo. Così "Prezzo (€)", "prezzo_unitario"
// e "PREZZO" mappano tutti sullo stesso sinonimo.
function normalizeKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Legge una riga grezza del foglio e la traduce nei campi canonici del
// catalogo, indipendentemente da come sono nominate le colonne nel file
// originale. Se più colonne mappano sullo stesso campo, vince la prima non vuota.
function mapRowToCanonical(row: Record<string, unknown>): Partial<Record<CanonicalField, string>> {
  const result: Partial<Record<CanonicalField, string>> = {};
  for (const [key, rawValue] of Object.entries(row)) {
    const field = SYNONYM_TO_FIELD.get(normalizeKey(key));
    if (!field || result[field]) continue;
    const value = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();
    if (value) result[field] = value;
  }
  return result;
}

// Genera uno SKU leggibile per righe senza codice prodotto, invece di
// bloccare l'importazione: es. "Birra 33cl" -> "AUTO-BIRRA-33CL-1".
function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 40) || 'PRODOTTO';
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
  // codepage 65001 (UTF-8) esplicita: senza, un CSV UTF-8 senza BOM viene
  // letto con la codepage di default (Latin-1/Windows-1252) e ogni carattere
  // accentato (Città, Perché, Caffè...) risulta corrotto — comune nei
  // cataloghi italiani sia nelle intestazioni sia nei nomi prodotto.
  const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  // raw:false forza il testo formattato della cella (es. "3,50", "0102")
  // invece del valore già tipizzato da SheetJS: senza, un prezzo CSV in
  // formato europeo come "3,50" viene interpretato come numero usando la
  // virgola come separatore delle migliaia -> 350, ancora prima che
  // parsePrice() possa intervenire. Con raw:false il parsing numerico resta
  // interamente sotto il nostro controllo (parsePrice, sku come stringa).
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

interface ValidationResult {
  validRows: CatalogImportRow[];
  errors: RowError[];
}

// Valori di fallback usati quando una colonna manca o non è valorizzata nel
// file: l'obiettivo è che una riga "sporca" venga comunque importata (con una
// nota informativa) invece di far fallire l'intera importazione.
const DEFAULT_NAME = 'Prodotto Senza Nome';
const DEFAULT_CATEGORY = 'Generale';
const DEFAULT_UNIT = 'pz';

function validateRows(rawRows: Record<string, unknown>[], tenantId: string): ValidationResult {
  const notices: RowError[] = [];
  const bySku = new Map<string, { row: number; item: CatalogImportRow }>();
  let autoSkuCounter = 0;

  rawRows.forEach((raw, index) => {
    // Riga 1 = header, quindi la prima riga dati è la 2.
    const rowNumber = index + 2;
    const fields = mapRowToCanonical(raw);

    const hasAnyValue = Object.values(fields).some((value) => !!value);
    if (!hasAnyValue) {
      // Riga completamente vuota (comune a fine file su export Excel): la
      // saltiamo silenziosamente, non è un errore da segnalare all'utente.
      return;
    }

    let code = fields.code ?? '';
    if (!code) {
      autoSkuCounter += 1;
      code = `AUTO-${slugify(fields.name || `RIGA-${rowNumber}`)}-${autoSkuCounter}`;
      notices.push({ row: rowNumber, error: `Campo "code" mancante: assegnato automaticamente il codice "${code}"` });
    }

    const name = fields.name || DEFAULT_NAME;
    if (!fields.name) {
      notices.push({ row: rowNumber, error: `Campo "name" mancante: assegnato il valore predefinito "${DEFAULT_NAME}"` });
    }

    let price = 0;
    if (fields.price) {
      const parsed = parsePrice(fields.price);
      if (parsed === null) {
        notices.push({ row: rowNumber, error: `Campo "price" non valido ("${fields.price}"): impostato a 0` });
      } else {
        price = parsed;
      }
    }

    const category = fields.category || DEFAULT_CATEGORY;
    const description = fields.description || '';
    const image_url = fields.image_url || null;
    const unit = fields.unit || DEFAULT_UNIT;

    // Due righe con lo stesso codice non possono coesistere in un unico
    // upsert (ON CONFLICT non può aggiornare due volte la stessa riga nella
    // stessa istruzione): vince l'ultima occorrenza, le precedenti sono
    // segnalate come sostituite invece di fallire silenziosamente.
    const existing = bySku.get(code);
    if (existing) {
      notices.push({ row: existing.row, error: `Codice "${code}" duplicato nel file: sostituito dalla riga ${rowNumber}` });
    }

    bySku.set(code, {
      row: rowNumber,
      item: {
        tenant_id: tenantId,
        sku: code,
        name,
        category,
        description,
        image_url,
        unit_price: price,
        unit_of_measure: unit,
      },
    });
  });

  const validRows = Array.from(bySku.values()).map((entry) => entry.item);
  return { validRows, errors: notices };
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
    // Cast necessario: 'category' (migrazione 20260804000000) e 'image_url'
    // (migrazione 20260808000006) sono colonne non ancora presenti nel tipo
    // Database generato (stesso scostamento già visto per altre colonne
    // recenti in questo modulo, es. orders.audio_url in app/actions/comandi-orders.ts).
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
