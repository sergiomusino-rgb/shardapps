// ─── Risoluzione branding sidebar — logica pura (CreatorAI Engine 2.0) ─────
// Estratta da sidebar-primitives.tsx (SidebarBrandFooter) in un file .ts
// separato (nessuna JSX) per poter essere testata con node:test: Node non
// riconosce l'estensione .tsx per l'esecuzione diretta (nessun transform
// JSX nel type-stripping nativo), mentre un .ts puro sì — stesso principio
// già seguito ovunque in questo repo (pure logic in .ts, wrapper React in
// .tsx, vedi src/lib/creator/version-history.ts + VersionHistoryPanel.tsx).

// Fallback ShardApps di default, un pezzo per volta — SidebarBrandFooter e
// questa funzione condividono la stessa costante, mai due stringhe diverse
// in due punti del codice.
export const SHARDAPPS_DEFAULT_LABEL = 'by MUSINO';

/**
 * Risoluzione del branding effettivo da mostrare nel footer della sidebar.
 *
 * Fallback per singolo campo (CreatorAI Engine 2.0, Branding reseller): logo
 * e nome ricadono su ShardApps INDIPENDENTEMENTE l'uno dall'altro — un
 * reseller che ha impostato solo il nome vede comunque il proprio nome con
 * il logo ShardApps (non il logo ShardApps E il nome ShardApps insieme),
 * e viceversa. Un'app esistente senza alcun branding (logoUrl/label entrambi
 * assenti — comportamento invariato per ogni app già pubblicata prima di
 * questa feature) ricade sul default ShardApps completo, come sempre.
 */
export function resolveSidebarBranding(logoUrl?: string, label?: string): { logoUrl: string | null; label: string } {
  const trimmedLogo = (logoUrl || '').trim();
  const trimmedLabel = (label || '').trim();
  return {
    logoUrl: trimmedLogo || null,
    label: trimmedLabel || SHARDAPPS_DEFAULT_LABEL,
  };
}

/**
 * Estrae `{footer_logo_url, footer_label}` da un `apps.config` grezzo (tipato
 * `unknown`/`Record<string, unknown> | null` a seconda del chiamante — es.
 * AppInfoContext.config) — usata dai renderer di CommandAI/FollowAI/CheckAI
 * (CreatorAI Engine 2.0, Branding reseller multi-prodotto) per non ripetere
 * lo stesso cast in ogni componente. Non lancia mai, qualunque sia la forma
 * di `config` (assente, null, senza `branding`, con `branding` malformato).
 */
export function extractBrandingFromConfig(config: unknown): { footer_logo_url?: string; footer_label?: string } | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const branding = (config as { branding?: unknown }).branding;
  if (!branding || typeof branding !== 'object') return undefined;
  const b = branding as { footer_logo_url?: unknown; footer_label?: unknown };
  return {
    footer_logo_url: typeof b.footer_logo_url === 'string' ? b.footer_logo_url : undefined,
    footer_label: typeof b.footer_label === 'string' ? b.footer_label : undefined,
  };
}
