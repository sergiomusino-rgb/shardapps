// ─── Test isolati — Branding reseller (CreatorAI Engine 2.0) ───────────────
// node:test nativo, stesso stile delle altre suite: nessuna chiamata di rete
// reale (fetch iniettato come fake), nessun DOM/React — solo la logica pura
// di src/lib/creator/branding.ts.
//
// Copre i requisiti "Test obbligatori" 1-4 (fallback per campo), 8 (logo
// invalido) e 7 (il branding non è mai visibile all'AI — verificato qui
// contro sanitizeSiteBlueprint, la porta d'ingresso di OGNI dato che l'AI
// può vedere/riscrivere).
//
// Uso: node --test src/lib/creator/branding.test.ts (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrandingPayload,
  validateBrandingLogoDataUrl,
  validateBrandingLogoFile,
  saveBrandingForApp,
  fetchCurrentBranding,
  MAX_LOGO_DATA_URL_LENGTH,
} from './branding.ts';
import { sanitizeSiteBlueprint } from '../site-schema.ts';

const VALID_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: (r.status ?? 200) < 300, status: r.status ?? 200, json: async () => r.body } as Response;
  }) as typeof fetch;
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK PER CAMPO (requisiti 1-4)
// ═══════════════════════════════════════════════════════════════════════════

test('1. branding completo (nome + logo) -> entrambi i campi nel payload', () => {
  const payload = buildBrandingPayload({ name: 'Studio Rossi', logoDataUrl: VALID_PNG_DATA_URL });
  assert.deepEqual(payload, { footer_logo_url: VALID_PNG_DATA_URL, footer_label: 'Studio Rossi' });
});

test('2. solo nome -> footer_logo_url vuoto nel payload (fallback ShardApps per il logo, gestito dal renderer)', () => {
  const payload = buildBrandingPayload({ name: 'Studio Rossi', logoDataUrl: '' });
  assert.deepEqual(payload, { footer_logo_url: '', footer_label: 'Studio Rossi' });
});

test('3. solo logo -> footer_label vuoto nel payload (fallback ShardApps per il nome, gestito dal renderer)', () => {
  const payload = buildBrandingPayload({ name: '', logoDataUrl: VALID_PNG_DATA_URL });
  assert.deepEqual(payload, { footer_logo_url: VALID_PNG_DATA_URL, footer_label: '' });
});

test('4. branding completamente assente -> nessun payload da salvare (null), fallback totale ShardApps', () => {
  assert.equal(buildBrandingPayload({ name: '', logoDataUrl: '' }), null);
  assert.equal(buildBrandingPayload({ name: '   ', logoDataUrl: '   ' }), null); // solo spazi = vuoto
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LOGO INVALIDO VIENE RIFIUTATO
// ═══════════════════════════════════════════════════════════════════════════

test('8. validateBrandingLogoDataUrl: formato immagine valido accettato', () => {
  assert.deepEqual(validateBrandingLogoDataUrl(VALID_PNG_DATA_URL), { ok: true });
  assert.deepEqual(validateBrandingLogoDataUrl(''), { ok: true }); // vuoto = nessun logo, valido
});

test('8. validateBrandingLogoDataUrl: URL arbitrario/non immagine rifiutato', () => {
  const r1 = validateBrandingLogoDataUrl('https://evil.example.com/tracker.png');
  assert.equal(r1.ok, false);
  const r2 = validateBrandingLogoDataUrl('javascript:alert(1)');
  assert.equal(r2.ok, false);
  const r3 = validateBrandingLogoDataUrl('data:text/html;base64,PHNjcmlwdD4=');
  assert.equal(r3.ok, false);
});

test('8. validateBrandingLogoDataUrl: data URL immagine oltre il limite di dimensione viene rifiutato', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_DATA_URL_LENGTH);
  const result = validateBrandingLogoDataUrl(huge);
  assert.equal(result.ok, false);
});

test('8. validateBrandingLogoFile: file non-immagine rifiutato, file oversize rifiutato, file valido accettato', () => {
  assert.equal(validateBrandingLogoFile({ size: 100, type: 'application/pdf' }).ok, false);
  assert.equal(validateBrandingLogoFile({ size: 2_000_000, type: 'image/png' }).ok, false);
  assert.equal(validateBrandingLogoFile({ size: 100, type: 'image/png' }).ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. IL BRANDING STRUTTURATO NON PUÒ ESSERE SOVRASCRITTO DAL TESTO AI
// ═══════════════════════════════════════════════════════════════════════════
// Garanzia strutturale: "branding" non fa parte di SiteBlueprintSchema, quindi
// qualunque JSON attraversi sanitizeSiteBlueprint (la porta d'ingresso di
// TUTTO ciò che generate/refactor producono, patch o riscrittura completa)
// perde silenziosamente un'eventuale chiave "branding" — un prompt non può
// mai instillarne uno, né sovrascrivere quello reale (mai visibile all'AI).

test('7. sanitizeSiteBlueprint scarta sempre una chiave "branding" nell\'input: il branding non è mai visibile/scrivibile dall\'AI', () => {
  const rawWithBranding = {
    projectType: 'gestionale',
    appName: 'Test',
    sector: 'custom',
    description: '',
    businessConfig: { name: 'Test', language: 'it' },
    adminPanel: { entities: [{ name: 'clienti', label: 'Cliente', fields: [{ id: 'id', type: 'id', label: 'ID' }] }] },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
    // Un'AI "maliziosa" o un refactor che tenta di inserire/sovrascrivere il brand:
    branding: { footer_logo_url: 'data:image/png;base64,ATTACKER', footer_label: 'AI Hijack Brand' },
  };
  const sanitized = sanitizeSiteBlueprint(rawWithBranding);
  assert.ok(sanitized);
  assert.equal((sanitized as unknown as { branding?: unknown }).branding, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENZA (riusa PATCH /api/apps/[id], nessuna nuova route)
// ═══════════════════════════════════════════════════════════════════════════

test('saveBrandingForApp: successo -> ok:true con il config aggiornato', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { success: true, app: { config: { branding: { footer_label: 'Studio Rossi' } } } } }]);
  const result = await saveBrandingForApp('app-1', { footer_logo_url: '', footer_label: 'Studio Rossi' }, 'tok', fetchImpl);
  assert.equal(result.ok, true);
});

test('saveBrandingForApp: piano non Business -> ok:false con il code del server propagato (nessuna logica di gating duplicata qui)', async () => {
  const fetchImpl = fakeFetch([{ status: 403, body: { error: 'Il white label è disponibile solo con il piano Business', code: 'PLAN_REQUIRED' } }]);
  const result = await saveBrandingForApp('app-1', { footer_logo_url: '', footer_label: 'X' }, 'tok', fetchImpl);
  assert.equal(result.ok, false);
  assert.equal((result as { code?: string }).code, 'PLAN_REQUIRED');
});

test('saveBrandingForApp: errore di rete -> ok:false, mai un\'eccezione non gestita', async () => {
  const fetchImpl = (async () => { throw new Error('network down'); }) as typeof fetch;
  const result = await saveBrandingForApp('app-1', { footer_logo_url: '', footer_label: 'X' }, 'tok', fetchImpl);
  assert.equal(result.ok, false);
});

test('fetchCurrentBranding: legge nome/presenza-logo dall\'app già pubblicata, mai il data URL intero', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { app: { config: { branding: { footer_label: 'Studio Rossi', footer_logo_url: VALID_PNG_DATA_URL } } } } }]);
  const result = await fetchCurrentBranding('app-1', 'tok', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal((result as { name: string }).name, 'Studio Rossi');
  assert.equal((result as { hasLogo: boolean }).hasLogo, true);
});

test('fetchCurrentBranding: app senza branding -> name vuoto, hasLogo false (nessun crash)', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { app: { config: {} } } }]);
  const result = await fetchCurrentBranding('app-1', 'tok', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal((result as { name: string }).name, '');
  assert.equal((result as { hasLogo: boolean }).hasLogo, false);
});
