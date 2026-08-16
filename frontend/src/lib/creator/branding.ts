// ─── Branding reseller — logica pura (CreatorAI Engine 2.0) ────────────────
// Nessun componente React qui dentro: costruzione del payload da salvare,
// validazione del logo, chiamate all'API GIÀ ESISTENTE per la persistenza —
// tutto testabile con node:test senza jsdom/React Testing Library (stessa
// scelta già fatta per version-history.ts, Hardening 2/2).
//
// RIUSO ARCHITETTURALE (nessun sistema parallelo):
// - Il branding vive in `apps.config.branding.{footer_logo_url,footer_label}`,
//   ESATTAMENTE gli stessi due campi già usati dal white-label reseller
//   esistente (dashboard/projects/[id]/page.tsx -> PATCH /api/apps/[id]),
//   letti dalla sidebar dell'app pubblicata (SidebarBrandFooter, vedi
//   app/a/[slug]/app/sidebar-primitives.tsx). Nessun nuovo nome di campo.
// - La persistenza riusa la STESSA route PATCH /api/apps/[id] (whitelist
//   BRANDING_FIELDS, gate piano Business, limite dimensione logo) — nessuna
//   nuova route, nessuna nuova migration: il branding resta un campo dentro
//   il JSONB apps.config già esistente.
// - `branding` NON fa mai parte di SiteBlueprintSchema (site-schema.ts): non
//   è mai visibile all'AI di generate/refactor, quindi un prompt non può
//   MAI sovrascriverlo (verificato anche da un test dedicato, vedi
//   branding.test.ts "il branding non è mai visibile all'AI").
// - Il campo libero "Richiesta branding" non è mai la fonte autorevole del
//   brand: è solo testo che il chiamante (AppEditorView) può opzionalmente
//   inoltrare a /api/creator/refactor come un normale messaggio in chat
//   (stessa identica strada già percorsa da un messaggio digitato
//   dall'utente) — non aggiunge nessuna capacità nuova all'AI Engine.

// Stesso limite di /api/apps/[id]/route.ts (MAX_LOGO_DATA_URL_LENGTH): il
// valore va tenuto allineato lì, non importato da qui per non introdurre un
// accoppiamento tra un modulo client-side (bundle browser) e una route
// server-side — stesso numero, stesso commento in entrambi i punti.
export const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

const ALLOWED_LOGO_DATA_URL = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i;

export interface BrandingFormState {
  name: string;
  logoDataUrl: string;
  instructions: string;
}

export const EMPTY_BRANDING_FORM: BrandingFormState = { name: '', logoDataUrl: '', instructions: '' };

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Valida tipo/formato/dimensione del logo PRIMA di inviarlo — stessa difesa
 * già presente lato server (MAX_LOGO_DATA_URL_LENGTH), qui applicata anche
 * al FORMATO (il controllo server-side esistente verifica solo la
 * lunghezza della stringa, non che sia davvero un'immagine): "nessun URL
 * arbitrario" (requisito sicurezza) — un valore che non è un vero data URL
 * immagine viene rifiutato qui, prima ancora di provare a salvarlo.
 * Una stringa vuota è valida (significa "nessun logo", fallback ShardApps).
 */
export function validateBrandingLogoDataUrl(dataUrl: string): ValidationResult {
  const trimmed = dataUrl.trim();
  if (!trimmed) return { ok: true };
  if (!ALLOWED_LOGO_DATA_URL.test(trimmed)) {
    return { ok: false, error: 'Formato logo non valido: carica un\'immagine (PNG, JPG, WEBP, GIF, SVG).' };
  }
  if (trimmed.length > MAX_LOGO_DATA_URL_LENGTH) {
    return { ok: false, error: 'Logo troppo grande (max ~1MB): scegline uno più leggero.' };
  }
  return { ok: true };
}

/** File grezzo (prima della lettura come data URL): stesso limite già usato
 * da dashboard/projects/[id]/page.tsx (1MB) per non far attendere all'utente
 * l'encoding base64 di un file già troppo grande — qui riusato identico. */
export function validateBrandingLogoFile(file: { size: number; type: string }): ValidationResult {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Il file deve essere un\'immagine.' };
  }
  if (file.size > 1_000_000) {
    return { ok: false, error: 'Immagine troppo grande (max 1MB). Scegline una più leggera.' };
  }
  return { ok: true };
}

export interface StructuredBrandingPayload {
  footer_logo_url: string;
  footer_label: string;
}

/**
 * Costruisce il payload strutturato da salvare (stessa forma già accettata
 * da PATCH /api/apps/[id]) a partire dal form. Ritorna null se il form è
 * completamente vuoto: nessun branding da salvare, fallback totale
 * ShardApps (requisito "se non inserisce nulla -> fallback automatico").
 * Ritorna SEMPRE entrambe le chiavi quando c'è qualcosa da salvare (anche se
 * una delle due è vuota): permette di "svuotare" un campo già impostato in
 * precedenza (stesso comportamento già supportato dalla route riusata).
 */
export function buildBrandingPayload(form: Pick<BrandingFormState, 'name' | 'logoDataUrl'>): StructuredBrandingPayload | null {
  const name = form.name.trim();
  const logo = form.logoDataUrl.trim();
  if (!name && !logo) return null;
  return { footer_logo_url: logo, footer_label: name };
}

export type SaveBrandingResult =
  | { ok: true; config: unknown }
  | { ok: false; error: string; code?: string };

/**
 * Persiste il branding per un'app GIÀ pubblicata, riusando PATCH
 * /api/apps/[id] (nessuna nuova route). Il server applica da solo il gate
 * "piano Business richiesto" e il limite dimensione — qui ci si limita a
 * propagarne l'esito, mai a duplicarne la logica.
 */
export async function saveBrandingForApp(
  appId: string,
  payload: StructuredBrandingPayload,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<SaveBrandingResult> {
  try {
    const res = await fetchImpl(`/api/apps/${appId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ branding: payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || 'Errore salvataggio branding', code: data?.code };
    }
    return { ok: true, config: data?.app?.config };
  } catch {
    return { ok: false, error: 'Errore di connessione. Riprova.' };
  }
}

export type FetchAppBrandingResult =
  | { ok: true; name: string; hasLogo: boolean }
  | { ok: false; error: string };

/**
 * Legge il branding CORRENTE di un'app già pubblicata (riusa GET
 * /api/apps/[id], già ownership-checked) per pre-compilare il pannello alla
 * riapertura — `hasLogo` invece del data URL intero: non serve rimandare al
 * browser un blob base64 potenzialmente enorme solo per sapere "è già
 * impostato un logo", l'utente lo sostituisce caricandone uno nuovo.
 */
export async function fetchCurrentBranding(
  appId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchAppBrandingResult> {
  try {
    const res = await fetchImpl(`/api/apps/${appId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.error || 'Errore caricamento branding' };
    }
    const branding = data?.app?.config?.branding as { footer_logo_url?: string; footer_label?: string } | undefined;
    return { ok: true, name: branding?.footer_label || '', hasLogo: !!branding?.footer_logo_url };
  } catch {
    return { ok: false, error: 'Errore di connessione. Riprova.' };
  }
}
