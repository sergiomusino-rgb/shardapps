import type { CSSProperties } from 'react';

/** Forma di `colors` già calcolata in page.tsx da getThemeVars/designTokensToThemeVars. */
export interface TenantColors {
  primary: string;
  primaryHover: string;
  bg: string;
  cardBg: string;
  cardBgAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarHover: string;
  inputBg: string;
  inputBorder: string;
  danger: string;
  success: string;
  warning: string;
}

/**
 * Converte la palette del tenant (settore + eventuale override utente) nelle
 * CSS custom properties `--tenant-*` dichiarate in globals.css, da iniettare
 * come inline style sul container radice. Da lì in poi qualsiasi classe
 * Tailwind `bg-tenant-*`/`text-tenant-*`/`border-tenant-*` (vedi
 * components/ui/*) riflette automaticamente il brand del tenant corrente,
 * senza dover passare `colors` come prop a ogni nuovo componente.
 */
export function tenantThemeVars(colors: TenantColors): CSSProperties {
  return {
    '--tenant-primary': colors.primary,
    '--tenant-primary-hover': colors.primaryHover,
    '--tenant-bg': colors.bg,
    '--tenant-card': colors.cardBg,
    '--tenant-card-alt': colors.cardBgAlt,
    '--tenant-border': colors.border,
    '--tenant-text': colors.text,
    '--tenant-text-secondary': colors.textSecondary,
    '--tenant-sidebar-bg': colors.sidebarBg,
    '--tenant-sidebar-text': colors.sidebarText,
    '--tenant-sidebar-hover': colors.sidebarHover,
    '--tenant-input-bg': colors.inputBg,
    '--tenant-input-border': colors.inputBorder,
    '--tenant-danger': colors.danger,
    '--tenant-success': colors.success,
    '--tenant-warning': colors.warning,
  } as CSSProperties;
}
