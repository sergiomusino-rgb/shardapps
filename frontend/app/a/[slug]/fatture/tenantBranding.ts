import type { CSSProperties } from 'react';
import { getDesignTokens } from '@/lib/designTokens';
import { tenantThemeVars, type TenantColors } from '../app/tenant-theme';

/**
 * Le pagine /fatture sono route standalone (fuori dalla shell ViewerProFinal,
 * niente sidebar fissa), ma devono comunque riflettere il brand del tenant
 * invece di un dark/light generico. Stessa fonte dati usata da ViewerProFinal
 * (localStorage `app_session_{slug}` per il settore, `_prefs` per l'eventuale
 * colore personalizzato), versione più leggera senza il flip forzato
 * scuro/chiaro (queste pagine non hanno un proprio toggle tema).
 */
function shadeHex(hex: string, percent: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return hex;
  const target = percent < 0 ? 0 : 255;
  const p = Math.min(Math.abs(percent), 1);
  const channel = (shift: number) => Math.round((target - ((num >> shift) & 255)) * p) + ((num >> shift) & 255);
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`;
}

export function getTenantColors(slug: string): { colors: TenantColors; style: CSSProperties } {
  let sector = '';
  let primaryOverride: string | undefined;

  try {
    const rawSession = localStorage.getItem(`app_session_${slug}`);
    if (rawSession) {
      const session = JSON.parse(rawSession);
      const cfg = session?.appInfo?.config;
      sector = cfg?.blueprint?.sector || cfg?.sector || '';
      primaryOverride = cfg?.branding?.primary_color || undefined;
    }
    const rawPrefs = localStorage.getItem(`app_session_${slug}_prefs`);
    if (rawPrefs) {
      const prefs = JSON.parse(rawPrefs);
      if (prefs?.primaryColor) primaryOverride = prefs.primaryColor;
    }
  } catch {
    // ignore, si ricade sui default del settore "saas" generico
  }

  const tokens = getDesignTokens(sector);
  const c = tokens.colors;
  const primary = primaryOverride || c.primary;
  const sidebar = primaryOverride
    ? { bg: shadeHex(primaryOverride, -0.55), text: '#f8fafc', hover: shadeHex(primaryOverride, -0.4) }
    : { bg: c['sidebar-bg'], text: c['sidebar-text'], hover: c['sidebar-hover'] };

  const colors: TenantColors = {
    bg: c.bg,
    cardBg: c['card-bg'],
    cardBgAlt: c['card-bg-alt'],
    text: c.text,
    textSecondary: c['text-secondary'],
    border: c.border,
    sidebarBg: sidebar.bg,
    sidebarText: sidebar.text,
    sidebarHover: sidebar.hover,
    inputBg: c['input-bg'],
    inputBorder: c.border,
    primary,
    primaryHover: primaryOverride ? `${primaryOverride}dd` : c['primary-hover'],
    danger: c.error,
    success: c.success,
    warning: c.warning,
  };

  return { colors, style: tenantThemeVars(colors) };
}
