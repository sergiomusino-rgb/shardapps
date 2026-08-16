// ─── Test isolati — risoluzione branding sidebar (CreatorAI Engine 2.0) ────
// node:test nativo, nessun DOM/jsdom — solo la funzione pura usata da
// SidebarBrandFooter (sidebar-primitives.tsx) per decidere logo/nome
// effettivi da mostrare nel footer della sidebar dell'app pubblicata.
//
// Copre i requisiti "Test obbligatori" 2, 3, 4, 5, 10, 11.
//
// Uso: node --test "app/a/[slug]/app/sidebar-branding.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSidebarBranding, extractBrandingFromConfig, SHARDAPPS_DEFAULT_LABEL } from './sidebar-branding.ts';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

test('1./10. branding completo (logo + nome) -> entrambi mostrati, ShardApps sostituito interamente', () => {
  const result = resolveSidebarBranding(LOGO, 'Studio Rossi');
  assert.equal(result.logoUrl, LOGO);
  assert.equal(result.label, 'Studio Rossi');
});

test('2. solo nome -> il nome resta, il logo ricade su ShardApps (null -> renderer usa /favicon.png)', () => {
  const result = resolveSidebarBranding(undefined, 'Studio Rossi');
  assert.equal(result.logoUrl, null);
  assert.equal(result.label, 'Studio Rossi');
});

test('3. solo logo -> il logo resta, il nome ricade sul default ShardApps', () => {
  const result = resolveSidebarBranding(LOGO, undefined);
  assert.equal(result.logoUrl, LOGO);
  assert.equal(result.label, SHARDAPPS_DEFAULT_LABEL);
});

test('4./11. branding completamente assente -> fallback ShardApps completo (logo null, label default)', () => {
  const result = resolveSidebarBranding(undefined, undefined);
  assert.equal(result.logoUrl, null);
  assert.equal(result.label, SHARDAPPS_DEFAULT_LABEL);
});

test('5. app esistente senza branding (chiamata come SidebarBrandFooter senza props) -> stesso fallback ShardApps di sempre, nessuna eccezione', () => {
  // Nessun argomento — esattamente come SidebarBrandFooter viene chiamato
  // per un'app pubblicata prima di questa feature (config.branding assente).
  const result = resolveSidebarBranding();
  assert.equal(result.logoUrl, null);
  assert.equal(result.label, SHARDAPPS_DEFAULT_LABEL);
});

test('stringhe vuote/solo spazi sono trattate come assenti (coerente con "lasciato vuoto")', () => {
  const result = resolveSidebarBranding('   ', '   ');
  assert.equal(result.logoUrl, null);
  assert.equal(result.label, SHARDAPPS_DEFAULT_LABEL);
});

// ═══════════════════════════════════════════════════════════════════════════
// extractBrandingFromConfig — usata da CommandAI (ComandiInstanceDashboard.tsx,
// app/agente/page.tsx) per leggere apps.config.branding da AppInfoContext,
// stessa forma già letta dal motore generico (ViewerProFinal) per FollowAI/
// CheckAI/CreatorAI. Copre il requisito "6. compatibilità con prodotti/app
// esistenti": mai un'eccezione qualunque sia la forma di `config`.
// ═══════════════════════════════════════════════════════════════════════════

test('extractBrandingFromConfig: 1. branding completo -> entrambi i campi estratti', () => {
  const result = extractBrandingFromConfig({ branding: { footer_logo_url: LOGO, footer_label: 'Studio Rossi' } });
  assert.deepEqual(result, { footer_logo_url: LOGO, footer_label: 'Studio Rossi' });
});

test('extractBrandingFromConfig: 2. solo logo -> footer_label undefined', () => {
  const result = extractBrandingFromConfig({ branding: { footer_logo_url: LOGO } });
  assert.deepEqual(result, { footer_logo_url: LOGO, footer_label: undefined });
});

test('extractBrandingFromConfig: 3. solo nome -> footer_logo_url undefined', () => {
  const result = extractBrandingFromConfig({ branding: { footer_label: 'Studio Rossi' } });
  assert.deepEqual(result, { footer_logo_url: undefined, footer_label: 'Studio Rossi' });
});

test('extractBrandingFromConfig: 4./6. config senza "branding" (compatibilità app esistenti) -> undefined, mai un\'eccezione', () => {
  assert.equal(extractBrandingFromConfig({ appName: 'Vecchia App', businessConfig: {} }), undefined);
  assert.equal(extractBrandingFromConfig(null), undefined);
  assert.equal(extractBrandingFromConfig(undefined), undefined);
  assert.equal(extractBrandingFromConfig('non un oggetto'), undefined);
  assert.equal(extractBrandingFromConfig({ branding: 'non un oggetto' }), undefined);
  assert.deepEqual(extractBrandingFromConfig({ branding: { footer_logo_url: 42, footer_label: null } }), { footer_logo_url: undefined, footer_label: undefined });
});
