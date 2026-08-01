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
  extra_fields: Record<string, string>;
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

// Se un'intestazione contiene token di più campi (es. "Cod. Articolo" tocca
// sia code che name), vince il campo con priorità più alta: un codice
// articolo è quasi sempre inteso come identificativo (code), non come nome.
const FIELD_PRIORITY: CanonicalField[] = ['code', 'name', 'category', 'unit', 'price', 'image_url', 'description'];

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

// Spezza un'intestazione nelle sue parole (accenti rimossi, minuscolo), per
// riconoscere intestazioni composte da più parole reali come "Descrizione
// Prodotto" o "Prezzo Listino Ufficiale (€)": un gestionale/listino esterno
// raramente usa un nome di colonna a parola singola come i nostri sinonimi.
function tokenizeHeader(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Riconosce a quale campo canonico corrisponde un'intestazione: prima un
// confronto esatto sull'intero testo normalizzato (veloce, copre anche i
// sinonimi composti espliciti come "prezzounitario"), poi — se non trova
// nulla — un confronto parola per parola con tie-break su FIELD_PRIORITY,
// per le intestazioni multi-parola di listini/gestionali reali.
function matchField(header: string): CanonicalField | null {
  const exact = SYNONYM_TO_FIELD.get(normalizeKey(header));
  if (exact) return exact;

  const matchedFields = new Set<CanonicalField>();
  for (const token of tokenizeHeader(header)) {
    const field = SYNONYM_TO_FIELD.get(token);
    if (field) matchedFields.add(field);
  }
  for (const field of FIELD_PRIORITY) {
    if (matchedFields.has(field)) return field;
  }
  return null;
}

interface MappedRow {
  fields: Partial<Record<CanonicalField, string>>;
  // Colonne del file senza un campo nativo corrispondente (es. "Brand",
  // "Formato/Confezione", "Aliquota IVA" di un listino ingrosso reale):
  // dato reale che l'utente si aspetta di ritrovare, conservato invece di
  // essere scartato in silenzio solo perché Comandi non ha una colonna
  // dedicata per esso (vedi catalog_items.extra_fields).
  extras: Record<string, string>;
}

// Legge una riga grezza del foglio e la traduce nei campi canonici del
// catalogo, indipendentemente da come sono nominate le colonne nel file
// originale. Se più colonne mappano sullo stesso campo, vince la prima non
// vuota. Le colonne non riconosciute finiscono in `extras` con l'intestazione
// originale come chiave, non vengono scartate.
function mapRowToCanonical(row: Record<string, unknown>): MappedRow {
  const fields: Partial<Record<CanonicalField, string>> = {};
  const extras: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(row)) {
    const value = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();
    if (!value) continue;

    const field = matchField(key);
    if (field) {
      if (!fields[field]) fields[field] = value;
      continue;
    }

    // "__COLONNA_N" è il segnaposto assegnato in arrayRowsToObjects a una
    // cella di intestazione vuota: non è un'intestazione reale del file,
    // non ha senso mostrarla all'utente come campo extra.
    const header = key.trim();
    if (header && !/^__COLONNA_\d+$/.test(header)) {
      extras[header] = value;
    }
  }
  return { fields, extras };
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

// Restituisce l'insieme dei campi canonici DISTINTI riconosciuti se la riga
// venisse trattata come intestazione: usato sia per individuare dove inizia
// davvero la tabella prodotti in un foglio, sia — con più fogli — per capire
// quali fogli sono tabelle prodotti e quali no.
function recognizedFieldsInRow(headerRow: unknown[]): Set<CanonicalField> {
  const fields = new Set<CanonicalField>();
  for (const cell of headerRow) {
    const field = matchField(cell === null || cell === undefined ? '' : String(cell));
    if (field) fields.add(field);
  }
  return fields;
}

// Una riga è considerata una vera intestazione di catalogo prodotti solo se
// riconosce "price" insieme ad almeno uno tra "name"/"code": è la
// combinazione che distingue una tabella prodotti da un foglio di
// anagrafica/sconti/riepilogo, che può comunque contenere singole parole
// come "categoria" o "note" pur non essendo affatto un elenco di prodotti
// (es. il foglio "Anagrafica & Listini" di un listino ingrosso reale, con
// colonne "Categoria Prodotto"/"Note per Rappresentante" ma nessun prezzo).
function looksLikeProductHeader(fields: Set<CanonicalField>): boolean {
  return fields.has('price') && (fields.has('name') || fields.has('code'));
}

// Molti listini/gestionali esportano un blocco titolo (ragione sociale,
// versione, riepilogo totali) PRIMA della vera tabella prodotti: assumere
// sempre che la riga 1 sia l'intestazione lascerebbe l'intero file
// irriconoscibile (0 colonne mappate su alcun sinonimo -> 0 prodotti
// importati, senza che l'utente capisca perché). Cerca invece, nelle prime
// righe, la prima che sembra un'intestazione di catalogo prodotti.
const HEADER_SCAN_LIMIT = 20;

function findHeaderRowIndex(rows: unknown[][]): number {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (looksLikeProductHeader(recognizedFieldsInRow(rows[i]))) return i;
  }
  return -1;
}

// Converte la matrice grezza (righe come array di celle) in oggetti chiave/
// valore usando `rows[headerIndex]` come intestazione, ignorando tutto ciò
// che precede (blocco titolo/riepilogo) e scartando le righe dati che
// risultano completamente vuote.
function arrayRowsToObjects(rows: unknown[][], headerIndex: number): Record<string, unknown>[] {
  const headers = rows[headerIndex].map((cell, i) => {
    const text = cell === null || cell === undefined ? '' : String(cell).trim();
    return text || `__COLONNA_${i + 1}`;
  });

  return rows
    .slice(headerIndex + 1)
    .map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] === null || row[i] === undefined ? '' : row[i];
      });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((value) => String(value ?? '').trim() !== ''));
}

interface ParsedWorkbookRow {
  data: Record<string, unknown>;
  sheetName: string;
  // Riga (1-based) nel foglio di origine, per i messaggi di errore/nota.
  rowNumber: number;
}

interface ParsedWorkbook {
  rows: ParsedWorkbookRow[];
  // true se righe da più di un foglio sono confluite nell'import: determina
  // se i messaggi devono specificare il nome del foglio o restare come prima
  // (il caso comune resta un file con un solo foglio prodotti).
  multiSheet: boolean;
  // Fogli con contenuto ma senza alcuna riga che sembri un'intestazione di
  // catalogo prodotti (es. un foglio di anagrafica/sconti): ignorati
  // dall'import, segnalati all'utente invece di essere processati alla
  // cieca o scomparire in silenzio.
  skippedSheets: string[];
}

function parseWorkbookRows(buffer: Buffer): ParsedWorkbook {
  // XLSX riconosce dal contenuto sia i formati binari Excel (.xlsx/.xls) sia
  // il testo CSV, quindi una sola API copre entrambi i formati richiesti.
  // codepage 65001 (UTF-8) esplicita: senza, un CSV UTF-8 senza BOM viene
  // letto con la codepage di default (Latin-1/Windows-1252) e ogni carattere
  // accentato (Città, Perché, Caffè...) risulta corrotto — comune nei
  // cataloghi italiani sia nelle intestazioni sia nei nomi prodotto.
  const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });

  const rows: ParsedWorkbookRow[] = [];
  const skippedSheets: string[] = [];

  // Un file Excel può avere più fogli (es. un listino ingrosso con un foglio
  // prodotti e un foglio di anagrafica categorie/sconti a parte): li
  // esamina tutti invece di limitarsi al primo, adattandosi a ciascuno.
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    // header:1 legge la matrice grezza senza assumere alcuna riga come
    // intestazione, per poter individuare dove inizia davvero la tabella
    // (vedi findHeaderRowIndex). raw:false forza il testo formattato della
    // cella (es. "3,50", "0102") invece del valore già tipizzato da SheetJS:
    // senza, un prezzo CSV in formato europeo come "3,50" viene interpretato
    // come numero usando la virgola come separatore delle migliaia -> 350,
    // ancora prima che parsePrice() possa intervenire.
    const arrayRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
    if (arrayRows.length === 0) continue;

    const headerIndex = findHeaderRowIndex(arrayRows);
    if (headerIndex === -1) {
      skippedSheets.push(sheetName);
      continue;
    }

    arrayRowsToObjects(arrayRows, headerIndex).forEach((data, i) => {
      rows.push({ data, sheetName, rowNumber: headerIndex + 2 + i });
    });
  }

  if (rows.length === 0 && workbook.SheetNames.length > 0) {
    // Nessun foglio contiene una tabella prodotti riconoscibile (nemmeno con
    // la soglia allentata): fallback storico sul primo foglio con la riga 1
    // come intestazione, così il file viene comunque processato —
    // validateRows segnalerà comunque le righe con contenuto ma nessun
    // campo riconosciuto, invece di restituire un'importazione vuota senza
    // alcuna spiegazione.
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const fallbackRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    fallbackRows.forEach((data, i) => rows.push({ data, sheetName: firstSheetName, rowNumber: i + 2 }));
    return { rows, multiSheet: false, skippedSheets: skippedSheets.filter((s) => s !== firstSheetName) };
  }

  const usedSheets = new Set(rows.map((r) => r.sheetName));
  return { rows, multiSheet: usedSheets.size > 1, skippedSheets };
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

function validateRows(rawRows: ParsedWorkbookRow[], tenantId: string, multiSheet: boolean): ValidationResult {
  const notices: RowError[] = [];
  const bySku = new Map<string, { row: number; item: CatalogImportRow }>();
  let autoSkuCounter = 0;
  let unrecognizedRowCount = 0;

  // Con più fogli confluiti nello stesso import, il numero di riga da solo è
  // ambiguo (es. "riga 8" può esistere in più fogli): antepone il nome del
  // foglio ai messaggi solo in quel caso, per non cambiare il testo del caso
  // comune (un solo foglio prodotti, la stragrande maggioranza dei file).
  const sheetPrefix = (sheetName: string) => (multiSheet ? `Foglio "${sheetName}" — ` : '');

  rawRows.forEach(({ data: raw, sheetName, rowNumber }) => {
    const { fields, extras } = mapRowToCanonical(raw);

    const hasAnyMappedValue = Object.values(fields).some((value) => !!value);
    const hasAnyRawValue = Object.values(raw).some((value) => value !== null && value !== undefined && String(value).trim() !== '');

    if (!hasAnyRawValue) {
      // Riga completamente vuota (comune a fine file su export Excel): la
      // saltiamo silenziosamente, non è un errore da segnalare all'utente.
      return;
    }
    if (!hasAnyMappedValue) {
      // La riga contiene dati ma nessuna delle sue colonne è stata
      // riconosciuta: a differenza di una riga vuota, qui c'è qualcosa che
      // l'utente si aspetta di vedere importato — va segnalato esplicitamente
      // invece di scomparire in silenzio come se fosse vuota.
      unrecognizedRowCount += 1;
      notices.push({ row: rowNumber, error: `${sheetPrefix(sheetName)}Riga con contenuto ma nessuna colonna riconosciuta: ignorata` });
      return;
    }

    let code = fields.code ?? '';
    if (!code) {
      autoSkuCounter += 1;
      code = `AUTO-${slugify(fields.name || `RIGA-${rowNumber}`)}-${autoSkuCounter}`;
      notices.push({ row: rowNumber, error: `${sheetPrefix(sheetName)}Campo "code" mancante: assegnato automaticamente il codice "${code}"` });
    }

    const name = fields.name || DEFAULT_NAME;
    if (!fields.name) {
      notices.push({ row: rowNumber, error: `${sheetPrefix(sheetName)}Campo "name" mancante: assegnato il valore predefinito "${DEFAULT_NAME}"` });
    }

    let price = 0;
    if (fields.price) {
      const parsed = parsePrice(fields.price);
      if (parsed === null) {
        notices.push({ row: rowNumber, error: `${sheetPrefix(sheetName)}Campo "price" non valido ("${fields.price}"): impostato a 0` });
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
      const suffix = multiSheet ? ` del foglio "${sheetName}"` : '';
      notices.push({ row: existing.row, error: `Codice "${code}" duplicato nel file: sostituito dalla riga ${rowNumber}${suffix}` });
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
        extra_fields: extras,
      },
    });
  });

  const validRows = Array.from(bySku.values()).map((entry) => entry.item);

  // Se NESSUNA riga ha prodotto un campo riconosciuto, è quasi certamente un
  // problema di intestazione (nomi di colonna troppo diversi dai sinonimi
  // supportati) piuttosto che un file vuoto: lo segnaliamo in cima con un
  // messaggio dedicato, invece di lasciare che l'utente veda solo "0
  // prodotti importati" senza capirne il motivo.
  if (validRows.length === 0 && unrecognizedRowCount > 0) {
    notices.unshift({
      row: 0,
      error: 'Nessuna colonna del file è stata riconosciuta: verifica che l\'intestazione contenga nomi come "nome"/"prodotto", "prezzo", "categoria" (anche in colonne composte, es. "Descrizione Prodotto"), oppure scarica il template CSV.',
    });
  }

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

  // ── 1. Parsing del workbook (tutti i fogli, non solo il primo) ───────────
  let parsed: ParsedWorkbook;
  try {
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    parsed = parseWorkbookRows(buffer);
  } catch (err) {
    console.error('[catalog-import] Errore parsing file:', err);
    return NextResponse.json(
      { success: false, error: 'Impossibile leggere il file: verifica che sia un .xlsx o .csv valido.', code: 'PARSE_ERROR' },
      { status: 400 }
    );
  }
  const rawRows = parsed.rows;

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
  const { validRows, errors } = validateRows(rawRows, tenantId, parsed.multiSheet);

  // Fogli con contenuto ma senza alcuna tabella prodotti riconoscibile (es.
  // un foglio di anagrafica/sconti a parte): valorizzato solo quando il file
  // aveva più di un foglio (nel fallback a foglio singolo il nome del foglio
  // "saltato" viene escluso, vedi parseWorkbookRows), quindi non serve un
  // controllo aggiuntivo su parsed.multiSheet — che riguarda invece se più
  // fogli hanno contribuito righe valide, non quanti fogli aveva il file.
  if (parsed.skippedSheets.length > 0) {
    for (const sheetName of parsed.skippedSheets) {
      errors.unshift({ row: 0, error: `Foglio "${sheetName}" ignorato: nessuna tabella prodotti riconosciuta al suo interno.` });
    }
  }

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
    // Cast necessario: 'category' (migrazione 20260804000000), 'image_url'
    // (migrazione 20260808000006) e 'extra_fields' (migrazione
    // 20260808000007) sono colonne non ancora presenti nel tipo Database
    // generato (stesso scostamento già visto per altre colonne recenti in
    // questo modulo, es. orders.audio_url in app/actions/comandi-orders.ts).
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
