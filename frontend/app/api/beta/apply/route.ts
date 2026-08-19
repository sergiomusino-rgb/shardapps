import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';
import { captureError } from '@/src/lib/error-tracking';

// ─── POST /api/beta/apply — Fase 1B: persistenza candidature Private Beta ──
// Endpoint pubblico (nessuna sessione richiesta: chiunque visiti /beta deve
// poter candidarsi) che inserisce in beta_applications (migration
// 20260825000000_beta_applications.sql). La tabella ha RLS deny-all — questo
// è l'UNICO percorso di scrittura, tramite service role key, mai esposta al
// browser (questo file è un route.ts: eseguito solo server-side da Next.js,
// mai incluso nel bundle client — vedi anche il test dedicato che verifica
// che BetaApplicationForm.tsx non referenzi mai la service role key).
//
// Client Supabase volutamente SENZA il generic <Database>: beta_applications
// non è ancora presente in src/types/supabase.ts (generato da `supabase gen
// types` sullo schema remoto, non rigenerato da questa migration — stesso
// gap già esistente per generation_jobs/app_versions, vedi
// src/lib/app-versions.ts). Stesso principio, non una scelta ad hoc.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Rate limit restrittivo (solo IP, nessun utente autenticato): un'agenzia
// legittima invia una candidatura, forse un paio di retry dopo un errore di
// validazione — 5 tentativi/ora è ampio per l'uso reale e stretto per uno
// script che tenta di riempire la tabella.
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX = 5;

// Tetto sulla dimensione grezza del body PRIMA di fare JSON.parse: copre in
// un colpo solo qualunque campo (o combinazione di campi) fuori misura,
// senza dover validare la lunghezza a valle di un parse costoso su un
// payload potenzialmente enorme.
const MAX_BODY_BYTES = 20_000;

const MAX_SHORT = 200; // full_name, company_name, website, country
const MAX_EMAIL = 320; // limite RFC 5321
const MAX_LONG = 2000; // app_types, message (textarea)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BUSINESS_TYPES = ['agency', 'freelancer', 'reseller', 'other'] as const;
const CLIENT_COUNTS = ['1-10', '11-50', '51-100', '100+'] as const;
const EXPECTED_APPS_OPTIONS = ['1-3', '4-10', '10+'] as const;

interface ValidatedApplication {
  full_name: string;
  company_name: string;
  email: string;
  website: string | null;
  country: string;
  business_type: string;
  client_count: string;
  app_types: string;
  expected_apps: string;
  message: string | null;
}

type ValidationResult = { ok: true; value: ValidatedApplication } | { ok: false; fields: string[] };

// Soglie numeriche (non escape di regex) dei code point di controllo da
// scartare prima di scrivere in una colonna text: 0-8, 11, 12, 14-31, 127
// (tutto l'intervallo C0 tranne tab/LF/CR, più DEL) — scritto come confronto
// numerico su ogni code point invece che come classe di caratteri con escape
// \u letterali nel sorgente, per non lasciare byte di controllo non
// stampabili dentro il file stesso.
function stripControlChars(value: string): string {
  let result = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    if (!isControl) result += ch;
  }
  return result;
}

function requiredText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0 || cleaned.length > maxLength) return null;
  return cleaned;
}

function optionalText(raw: unknown, maxLength: number): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length === 0) return { ok: true, value: null };
  if (cleaned.length > maxLength) return { ok: false };
  return { ok: true, value: cleaned };
}

function requiredEnum(raw: unknown, allowed: readonly string[]): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  return allowed.includes(cleaned) ? cleaned : null;
}

// Elenco dei campi obbligatori lato server come da scope Fase 1B: NB
// `website` non è in questo elenco (a differenza della UI, dove il campo è
// required — vedi BetaApplicationForm.tsx, non toccata da questa fase) —
// scelta esplicita della richiesta, non un'incoerenza da correggere qui.
function validateApplication(payload: Record<string, unknown>): ValidationResult {
  const fields: string[] = [];

  const full_name = requiredText(payload.full_name, MAX_SHORT);
  if (!full_name) fields.push('full_name');

  const company_name = requiredText(payload.company_name, MAX_SHORT);
  if (!company_name) fields.push('company_name');

  const emailCandidate = requiredText(payload.email, MAX_EMAIL);
  const email = emailCandidate && EMAIL_RE.test(emailCandidate) ? emailCandidate : null;
  if (!email) fields.push('email');

  const country = requiredText(payload.country, MAX_SHORT);
  if (!country) fields.push('country');

  const business_type = requiredEnum(payload.business_type, BUSINESS_TYPES);
  if (!business_type) fields.push('business_type');

  const client_count = requiredEnum(payload.client_count, CLIENT_COUNTS);
  if (!client_count) fields.push('client_count');

  const app_types = requiredText(payload.app_types, MAX_LONG);
  if (!app_types) fields.push('app_types');

  const expected_apps = requiredEnum(payload.expected_apps, EXPECTED_APPS_OPTIONS);
  if (!expected_apps) fields.push('expected_apps');

  const website = optionalText(payload.website, MAX_SHORT);
  if (!website.ok) fields.push('website');

  const message = optionalText(payload.message, MAX_LONG);
  if (!message.ok) fields.push('message');

  if (fields.length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      full_name: full_name as string,
      company_name: company_name as string,
      email: email as string,
      website: website.ok ? website.value : null,
      country: country as string,
      business_type: business_type as string,
      client_count: client_count as string,
      app_types: app_types as string,
      expected_apps: expected_apps as string,
      message: message.ok ? message.value : null,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const { allowed } = await checkRateLimit(`beta-apply:${ip}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX);
    if (!allowed) {
      return NextResponse.json(
        { success: false, code: 'RATE_LIMITED', error: 'Troppe richieste, riprova più tardi.' },
        { status: 429 }
      );
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, code: 'PAYLOAD_TOO_LARGE', error: 'Richiesta troppo grande.' },
        { status: 400 }
      );
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ success: false, code: 'INVALID_JSON', error: 'JSON non valido.' }, { status: 400 });
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return NextResponse.json({ success: false, code: 'VALIDATION_ERROR', error: 'Payload non valido.' }, { status: 400 });
    }

    const validation = validateApplication(payload as Record<string, unknown>);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, code: 'VALIDATION_ERROR', error: 'Dati non validi.', fields: validation.fields },
        { status: 400 }
      );
    }

    const app = validation.value;
    // Email normalizzata in minuscolo sia per il controllo duplicati sia per
    // l'insert: "Mario@Agency.it" e "mario@agency.it" sono la stessa
    // candidatura, coerente con l'indice unico su lower(email) della
    // migration.
    const emailLower = app.email.toLowerCase();

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('beta_applications')
      .select('id')
      .eq('email', emailLower)
      .maybeSingle();

    if (lookupError) {
      captureError('beta.apply.lookup', lookupError);
      return NextResponse.json({ success: false, code: 'INTERNAL_ERROR', error: 'Errore interno del server.' }, { status: 500 });
    }

    // Nessun aggiornamento della candidatura esistente: comportamento
    // volutamente conservativo finché non si decide cosa deve succedere per
    // chi si ricandida (vedi report Fase 1B) — qui ci si limita a non
    // creare un duplicato e a dirlo chiaramente al chiamante.
    if (existing) {
      return NextResponse.json({ success: true, code: 'ALREADY_APPLIED' }, { status: 200 });
    }

    const { error: insertError } = await supabaseAdmin.from('beta_applications').insert({
      full_name: app.full_name,
      company_name: app.company_name,
      email: emailLower,
      website: app.website,
      country: app.country,
      business_type: app.business_type,
      client_count: app.client_count,
      app_types: app.app_types,
      expected_apps: app.expected_apps,
      message: app.message,
    });

    if (insertError) {
      // 23505 = unique_violation sull'indice lower(email): due richieste
      // concorrenti per la stessa email hanno superato entrambe il
      // controllo "existing" sopra (race condition). Stesso trattamento del
      // duplicato già rilevato, mai un errore generico per questo caso.
      if ((insertError as { code?: string }).code === '23505') {
        return NextResponse.json({ success: true, code: 'ALREADY_APPLIED' }, { status: 200 });
      }
      captureError('beta.apply.insert', insertError);
      return NextResponse.json({ success: false, code: 'INTERNAL_ERROR', error: 'Errore interno del server.' }, { status: 500 });
    }

    // Risposta minimale: nessun id/riga restituita, il client non ne ha
    // bisogno (nessuna dashboard/stato da mostrare in questa fase).
    return NextResponse.json({ success: true, code: 'CREATED' }, { status: 201 });
  } catch (err) {
    captureError('beta.apply', err);
    return NextResponse.json({ success: false, code: 'INTERNAL_ERROR', error: 'Errore interno del server.' }, { status: 500 });
  }
}
