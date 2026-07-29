// ─── Design System Tokens (Client-side) ─────────────────────────────────────
// Defines CSS custom properties for each design system variant
// Used by the app viewer to style components dynamically

import type { DesignLayout } from '@/app/a/[slug]/app/DesignParser';

export interface DesignTokens {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  radii: Record<string, string>;
  spacing: Record<string, string>;
}

// ─── DocuForge Design Tokens (Documentation / API Docs) ─────────────────────
const DOCUFORGE_TOKENS: DesignTokens = {
  colors: {
    'primary': '#2563EB',
    'primary-hover': '#1D4ED8',
    'secondary': '#7C3AED',
    'tertiary': '#6B7280',
    'bg': '#FAFAFA',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#CA8A04',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1F2937',
    'text-secondary': '#6B7280',
    'border': '#E4E4E7',
    'border-light': '#F4F4F5',
    'sidebar-bg': '#1E293B',
    'sidebar-text': '#E2E8F0',
    'sidebar-hover': '#334155',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#F8FAFC',
    'input-bg': '#FFFFFF',
    'label': '#52525B',
    'label-disabled': '#A1A1AA',
  },
  fonts: {
    'headline': "'Plus Jakarta Sans', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'Fira Code', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── BistroMenu Design Tokens (Food / Restaurant) ──────────────────────────
const BISTROMENU_TOKENS: DesignTokens = {
  colors: {
    'primary': '#881337',
    'primary-hover': '#6B0F2B',
    'secondary': '#FCA5A5',
    'tertiary': '#64748B',
    'bg': '#FFF9F5',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#D97706',
    'error': '#DC2626',
    'info': '#0369A1',
    'text': '#292524',
    'text-secondary': '#78716C',
    'border': '#E7E5E4',
    'border-light': '#F5F5F4',
    'sidebar-bg': '#881337',
    'sidebar-text': '#FFF1F2',
    'sidebar-hover': '#A42E44',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#FEF2F2',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Playfair Display', serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── MarketNest Design Tokens (Retail / E-commerce) ────────────────────────
const MARKETNEST_TOKENS: DesignTokens = {
  colors: {
    'primary': '#B45309',
    'primary-hover': '#92400E',
    'secondary': '#F59E0B',
    'tertiary': '#6B7280',
    'bg': '#FFFBEB',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#CA8A04',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1C1917',
    'text-secondary': '#78716C',
    'border': '#E7E5E4',
    'border-light': '#F5F5F4',
    'sidebar-bg': '#1C1917',
    'sidebar-text': '#E7E5E4',
    'sidebar-hover': '#292524',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#FFF7ED',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Clash Display', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '2px',
    'md': '4px',
    'lg': '6px',
    'xl': '8px',
    'full': '9999px',
  },
  spacing: {
    'base': '4px',
    'xs': '4px',
    'sm': '8px',
    'md': '12px',
    'lg': '20px',
    'xl': '28px',
    '2xl': '40px',
    '3xl': '56px',
    'section': '40px',
    'page': '56px',
  },
};

// ─── CoinPulse Design Tokens (Finance / Crypto) ───────────────────────────
const COINPULSE_TOKENS: DesignTokens = {
  colors: {
    'primary': '#2563EB',
    'primary-hover': '#1D4ED8',
    'secondary': '#F59E0B',
    'tertiary': '#64748B',
    'bg': '#0F172A',
    'surface': '#1E293B',
    'success': '#22C55E',
    'warning': '#F59E0B',
    'error': '#EF4444',
    'info': '#3B82F6',
    'text': '#F8FAFC',
    'text-secondary': '#94A3B8',
    'border': '#334155',
    'border-light': '#1E293B',
    'sidebar-bg': '#0F172A',
    'sidebar-text': '#E2E8F0',
    'sidebar-hover': '#1E293B',
    'card-bg': '#1E293B',
    'card-bg-alt': '#162032',
    'input-bg': '#0F172A',
    'label': '#94A3B8',
    'label-disabled': '#475569',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── UrbanLoft Design Tokens (Real Estate) ────────────────────────────────
const URBANLOFT_TOKENS: DesignTokens = {
  colors: {
    'primary': '#1C1917',
    'primary-hover': '#292524',
    'secondary': '#78716C',
    'tertiary': '#64748B',
    'bg': '#FAFAF9',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#D97706',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1C1917',
    'text-secondary': '#78716C',
    'border': '#D6D3D1',
    'border-light': '#E7E5E4',
    'sidebar-bg': '#1C1917',
    'sidebar-text': '#E7E5E4',
    'sidebar-hover': '#292524',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#F5F5F4',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Playfair Display', serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '2px',
    'md': '4px',
    'lg': '8px',
    'xl': '12px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── VolunteerHub Design Tokens (Non-profit) ──────────────────────────────
const VOLUNTEERHUB_TOKENS: DesignTokens = {
  colors: {
    'primary': '#059669',
    'primary-hover': '#047857',
    'secondary': '#F59E0B',
    'tertiary': '#6B7280',
    'bg': '#F0FDF4',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#CA8A04',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1C1917',
    'text-secondary': '#78716C',
    'border': '#D6D3D1',
    'border-light': '#E7E5E4',
    'sidebar-bg': '#065F46',
    'sidebar-text': '#D1FAE5',
    'sidebar-hover': '#047857',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#F0FDF4',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '6px',
    'md': '10px',
    'lg': '14px',
    'xl': '18px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── WanderMap Design Tokens (SaaS / Tech / Default) ──────────────────────
const WANDERMAP_TOKENS: DesignTokens = {
  colors: {
    'primary': '#6366F1',
    'primary-hover': '#4F46E5',
    'secondary': '#8B5CF6',
    'tertiary': '#64748B',
    'bg': '#F8FAFC',
    'surface': '#FFFFFF',
    'success': '#22C55E',
    'warning': '#F59E0B',
    'error': '#EF4444',
    'info': '#3B82F6',
    'text': '#0F172A',
    'text-secondary': '#64748B',
    'border': '#E2E8F0',
    'border-light': '#F1F5F9',
    'sidebar-bg': '#1E293B',
    'sidebar-text': '#E2E8F0',
    'sidebar-hover': '#334155',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#F1F5F9',
    'input-bg': '#F1F5F9',
    'label': '#64748B',
    'label-disabled': '#94A3B8',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── RecipeBook Design Tokens (Food / Recipes) ────────────────────────────
const RECIPEBOOK_TOKENS: DesignTokens = {
  colors: {
    'primary': '#0F766E',
    'primary-hover': '#0D6B63',
    'secondary': '#D97706',
    'tertiary': '#6B7280',
    'bg': '#FFF7ED',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#CA8A04',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1C1917',
    'text-secondary': '#78716C',
    'border': '#D6D3D1',
    'border-light': '#E7E5E4',
    'sidebar-bg': '#0F766E',
    'sidebar-text': '#CCFBF1',
    'sidebar-hover': '#0D9488',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#F0FDFA',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Fraunces', serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '8px',
    'md': '12px',
    'lg': '16px',
    'xl': '20px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── Glassmorphism Theme Tokens ───────────────────────────────────────────
const GLASSMORPHISM_TOKENS: DesignTokens = {
  colors: {
    'primary': '#FFFFFF',
    'primary-hover': '#E2E8F0',
    'secondary': '#94A3B8',
    'tertiary': '#64748B',
    'bg': '#0F172A',
    'surface': 'rgba(255,255,255,0.05)',
    'success': '#22C55E',
    'warning': '#F59E0B',
    'error': '#EF4444',
    'info': '#3B82F6',
    'text': '#F1F5F9',
    'text-secondary': '#94A3B8',
    'border': 'rgba(255,255,255,0.1)',
    'border-light': 'rgba(255,255,255,0.05)',
    'sidebar-bg': 'rgba(15,23,42,0.8)',
    'sidebar-text': '#E2E8F0',
    'sidebar-hover': 'rgba(255,255,255,0.1)',
    'card-bg': 'rgba(255,255,255,0.05)',
    'card-bg-alt': 'rgba(255,255,255,0.08)',
    'input-bg': 'rgba(255,255,255,0.1)',
    'label': '#94A3B8',
    'label-disabled': '#475569',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '8px',
    'md': '12px',
    'lg': '16px',
    'xl': '20px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── Clean Tech Theme Tokens ──────────────────────────────────────────────
const CLEAN_TECH_TOKENS: DesignTokens = {
  colors: {
    'primary': '#6366F1',
    'primary-hover': '#4F46E5',
    'secondary': '#06B6D4',
    'tertiary': '#64748B',
    'bg': '#0F172A',
    'surface': '#1E293B',
    'success': '#22C55E',
    'warning': '#F59E0B',
    'error': '#EF4444',
    'info': '#3B82F6',
    'text': '#F8FAFC',
    'text-secondary': '#94A3B8',
    'border': '#334155',
    'border-light': '#1E293B',
    'sidebar-bg': '#0F172A',
    'sidebar-text': '#E2E8F0',
    'sidebar-hover': '#1E293B',
    'card-bg': '#1E293B',
    'card-bg-alt': '#162032',
    'input-bg': '#0F172A',
    'label': '#94A3B8',
    'label-disabled': '#475569',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── Warm Editorial Theme Tokens ──────────────────────────────────────────
const WARM_EDITORIAL_TOKENS: DesignTokens = {
  colors: {
    'primary': '#B45309',
    'primary-hover': '#92400E',
    'secondary': '#78716C',
    'tertiary': '#64748B',
    'bg': '#FFFBEB',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#D97706',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#1C1917',
    'text-secondary': '#78716C',
    'border': '#D6D3D1',
    'border-light': '#E7E5E4',
    'sidebar-bg': '#1C1917',
    'sidebar-text': '#E7E5E4',
    'sidebar-hover': '#292524',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#FFF7ED',
    'input-bg': '#FFFFFF',
    'label': '#57534E',
    'label-disabled': '#A8A29E',
  },
  fonts: {
    'headline': "'Playfair Display', serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '2px',
    'md': '4px',
    'lg': '8px',
    'xl': '12px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── Industrial Dark Theme Tokens ─────────────────────────────────────────
const INDUSTRIAL_DARK_TOKENS: DesignTokens = {
  colors: {
    'primary': '#F59E0B',
    'primary-hover': '#D97706',
    'secondary': '#78716C',
    'tertiary': '#6B7280',
    'bg': '#09090B',
    'surface': '#18181B',
    'success': '#22C55E',
    'warning': '#F59E0B',
    'error': '#EF4444',
    'info': '#3B82F6',
    'text': '#FAFAFA',
    'text-secondary': '#A1A1AA',
    'border': '#27272A',
    'border-light': '#18181B',
    'sidebar-bg': '#09090B',
    'sidebar-text': '#FAFAFA',
    'sidebar-hover': '#18181B',
    'card-bg': '#18181B',
    'card-bg-alt': '#27272A',
    'input-bg': '#09090B',
    'label': '#A1A1AA',
    'label-disabled': '#52525B',
  },
  fonts: {
    'headline': "'Inter', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── AutoDrive Design Tokens (Automotive / Concessionaria) ─────────────────
const AUTODRIVE_TOKENS: DesignTokens = {
  colors: {
    'primary': '#DC2626',
    'primary-hover': '#B91C1C',
    'secondary': '#71717A',
    'tertiary': '#64748B',
    'bg': '#F4F4F5',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#D97706',
    'error': '#DC2626',
    'info': '#2563EB',
    'text': '#18181B',
    'text-secondary': '#52525B',
    'border': '#E4E4E7',
    'border-light': '#F4F4F5',
    'sidebar-bg': '#18181B',
    'sidebar-text': '#F4F4F5',
    'sidebar-hover': '#27272A',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#FAFAFA',
    'input-bg': '#FFFFFF',
    'label': '#52525B',
    'label-disabled': '#A1A1AA',
  },
  fonts: {
    'headline': "'Plus Jakarta Sans', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '4px',
    'md': '8px',
    'lg': '12px',
    'xl': '16px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── ClinicLife Design Tokens (Sanità / Healthcare) ────────────────────────
const CLINICLIFE_TOKENS: DesignTokens = {
  colors: {
    'primary': '#0F766E',
    'primary-hover': '#0B5B54',
    'secondary': '#0891B2',
    'tertiary': '#64748B',
    'bg': '#F0F9F8',
    'surface': '#FFFFFF',
    'success': '#16A34A',
    'warning': '#D97706',
    'error': '#DC2626',
    'info': '#0891B2',
    'text': '#0F172A',
    'text-secondary': '#475569',
    'border': '#E2E8F0',
    'border-light': '#F1F5F9',
    'sidebar-bg': '#134E4A',
    'sidebar-text': '#CCFBF1',
    'sidebar-hover': '#0F766E',
    'card-bg': '#FFFFFF',
    'card-bg-alt': '#ECFEFF',
    'input-bg': '#FFFFFF',
    'label': '#475569',
    'label-disabled': '#94A3B8',
  },
  fonts: {
    'headline': "'Plus Jakarta Sans', sans-serif",
    'body': "'Inter', sans-serif",
    'mono': "'JetBrains Mono', monospace",
  },
  radii: {
    'none': '0px',
    'sm': '6px',
    'md': '10px',
    'lg': '16px',
    'xl': '20px',
    'full': '9999px',
  },
  spacing: {
    'base': '8px',
    'xs': '4px',
    'sm': '8px',
    'md': '16px',
    'lg': '24px',
    'xl': '32px',
    '2xl': '48px',
    '3xl': '64px',
    'section': '48px',
    'page': '64px',
  },
};

// ─── Token Map ────────────────────────────────────────────────────────────
// Maps sector names to design token sets
const DESIGN_TOKEN_MAP: Record<string, DesignTokens> = {
  docuforge: DOCUFORGE_TOKENS,
  bistromenu: BISTROMENU_TOKENS,
  marketnest: MARKETNEST_TOKENS,
  coinpulse: COINPULSE_TOKENS,
  urbanloft: URBANLOFT_TOKENS,
  volunteerhub: VOLUNTEERHUB_TOKENS,
  wandermap: WANDERMAP_TOKENS,
  recipebook: RECIPEBOOK_TOKENS,
  cliniclife: CLINICLIFE_TOKENS,
  glassmorphism: GLASSMORPHISM_TOKENS,
  'clean-tech': CLEAN_TECH_TOKENS,
  'warm-editorial': WARM_EDITORIAL_TOKENS,
  'industrial-dark': INDUSTRIAL_DARK_TOKENS,
  autodrive: AUTODRIVE_TOKENS,
};

// ─── Sector → Design Key Mapping ──────────────────────────────────────────
const SECTOR_TO_DESIGN_KEY: Record<string, string> = {
  // Documentation / API Docs
  docs: 'docuforge',
  documentation: 'docuforge',
  api: 'docuforge',

  // Food / Restaurant / Bar
  food: 'bistromenu',
  ristorante: 'bistromenu',
  ristorazione: 'bistromenu',
  bar: 'bistromenu',
  caffetteria: 'bistromenu',
  pizzeria: 'bistromenu',
  trattoria: 'bistromenu',
  osteria: 'bistromenu',
  menu: 'bistromenu',
  recipe: 'recipebook',
  recipes: 'recipebook',
  cooking: 'recipebook',
  foodblog: 'recipebook',

  // Retail / E-commerce
  retail: 'marketnest',
  ecommerce: 'marketnest',
  'e-commerce': 'marketnest',
  negozio: 'marketnest',
  shop: 'marketnest',
  store: 'marketnest',
  marketplace: 'marketnest',
  artigianato: 'marketnest',
  handmade: 'marketnest',
  prodotti: 'marketnest',

  // Finance / Crypto
  crypto: 'coinpulse',
  finance: 'coinpulse',
  banking: 'coinpulse',
  investimento: 'coinpulse',
  trading: 'coinpulse',
  wallet: 'coinpulse',

  // Real Estate
  realestate: 'urbanloft',
  property: 'urbanloft',
  immobiliare: 'urbanloft',
  casa: 'urbanloft',
  affitto: 'urbanloft',
  affittare: 'urbanloft',
  interior: 'urbanloft',

  // Non-profit
  volunteer: 'volunteerhub',
  volontariato: 'volunteerhub',
  nonprofit: 'volunteerhub',
  charity: 'volunteerhub',
  fondazione: 'volunteerhub',
  ngo: 'volunteerhub',
  cause: 'volunteerhub',

  // Sanità / Healthcare
  oculista: 'cliniclife',
  ottica: 'cliniclife',
  sanita: 'cliniclife',
  'sanità': 'cliniclife',
  clinica: 'cliniclife',
  clinic: 'cliniclife',
  ambulatorio: 'cliniclife',
  ospedale: 'cliniclife',
  hospital: 'cliniclife',
  medico: 'cliniclife',
  medici: 'cliniclife',
  dentista: 'cliniclife',
  dentist: 'cliniclife',
  studio_medico: 'cliniclife',
  veterinario: 'cliniclife',
  veterinaria: 'cliniclife',
  fisioterapia: 'cliniclife',
  salute: 'cliniclife',
  health: 'cliniclife',
  healthcare: 'cliniclife',

  // Automotive / Concessionaria
  automotive: 'autodrive',
  auto: 'autodrive',
  concessionaria: 'autodrive',
  concessionario: 'autodrive',
  autofficina: 'autodrive',
  officina: 'autodrive',
  autosalone: 'autodrive',
  carrozzeria: 'autodrive',
  autonoleggio: 'autodrive',
  gommista: 'autodrive',

  // SaaS / Tech / Dashboard
  saas: 'wandermap',
  tech: 'wandermap',
  dashboard: 'wandermap',
  software: 'wandermap',
  app: 'wandermap',
  travel: 'wandermap',
  viaggi: 'wandermap',
  booking: 'wandermap',
  prenotazione: 'wandermap',
};

// ─── Sector Keyword Fallback ───────────────────────────────────────────────
// Il Creator (form libero, non i pulsanti fissi di dashboard/creator) lascia
// scrivere/generare settori come "piadineria", "ingrosso-materiale-idraulico"
// o "ristopub", che non compaiono mai in SECTOR_TO_DESIGN_KEY: senza questo
// fallback ogni app del genere collassa sulla palette blu generica wandermap,
// che è esattamente il difetto di landing "piatta e anonima" da correggere.
// Ordine di priorità: la prima categoria il cui keyword compare come
// sottostringa del settore normalizzato vince.
const SECTOR_KEYWORD_FALLBACK: Array<{ keywords: string[]; designKey: string }> = [
  {
    designKey: 'cliniclife',
    keywords: ['sanit', 'clinic', 'ambulator', 'ospedal', 'hospital', 'medic', 'dentist', 'odontoiatr', 'veterinari', 'fisioterap', 'farmac', 'poliambulator', 'dottor', 'ocul', 'ottic', 'optometr'],
  },
  {
    designKey: 'bistromenu',
    keywords: ['ristor', 'pizz', 'piadin', 'trattor', 'osteria', 'bar', 'caff', 'bistro', 'gastro', 'pub', 'panin', 'gelat', 'pasticc', 'forno', 'kebab', 'sushi', 'burger', 'street-food'],
  },
  {
    designKey: 'recipebook',
    keywords: ['ricett', 'cooking', 'cucina', 'foodblog'],
  },
  {
    designKey: 'autodrive',
    keywords: ['automot', 'concessionari', 'autofficin', 'autosalon', 'carrozzeri', 'autonolegg', 'gommist', 'auto-usat', 'auto usat', 'rivendita-aut', 'rivendita auto'],
  },
  {
    designKey: 'industrial-dark',
    keywords: ['trasport', 'logistic', 'magazzin', 'spedizion', 'ingrosso', 'idraulic', 'agricol', 'ricambi', 'industrial', 'cantiere', 'edil', 'manifattur', 'officina'],
  },
  {
    designKey: 'urbanloft',
    keywords: ['realestate', 'real-estate', 'immobil', 'affitt', 'interior', 'arred'],
  },
  {
    designKey: 'coinpulse',
    keywords: ['crypto', 'financ', 'banking', 'invest', 'trading', 'wallet', 'borsa', 'contabil', 'assicura', 'mutuo', 'fiscal'],
  },
  {
    designKey: 'volunteerhub',
    keywords: ['volont', 'nonprofit', 'non-profit', 'charity', 'fondazion', 'onlus', 'associazion'],
  },
  {
    designKey: 'docuforge',
    keywords: ['docs', 'documentation', 'wiki'],
  },
  {
    designKey: 'marketnest',
    keywords: ['retail', 'ecommerce', 'e-commerce', 'negozio', 'shop', 'store', 'market', 'artigian', 'handmade', 'prodott', 'boutique', 'abbigliamento', 'petshop', 'animali', 'elettr'],
  },
  {
    designKey: 'wandermap',
    keywords: ['saas', 'software', 'travel', 'viaggi', 'booking', 'prenotaz', 'hotel'],
  },
];

// ─── Default Tokens ───────────────────────────────────────────────────────
const DEFAULT_TOKENS: DesignTokens = WANDERMAP_TOKENS;

// Settori "contenitore" scelti dai pulsanti fissi del Creator (o assenti):
// da soli non dicono nulla sulla vera attività (es. uno studio odontoiatrico
// viene salvato con sector="saas" perché in dashboard/creator non esiste un
// pulsante Sanità). Per questi proviamo anche il fallback per keyword su
// appName/description prima di arrenderci al design generico.
const GENERIC_SECTOR_VALUES = new Set(['saas', 'tech', 'dashboard', 'software', 'app', 'generale', 'custom', 'general', 'gestionale', '']);

// ─── Resolve Design Key by Sector (match esatto poi keyword fallback) ──────
// `extraText` (tipicamente appName + description) viene usato come segnale
// aggiuntivo per riconoscere il vero settore quando `sector` è generico o
// non compare in nessuna mappa.
function resolveDesignKey(sector?: string, extraText?: string): string {
  const normalizedSector = (sector || '').toLowerCase().trim();
  const isGeneric = !normalizedSector || GENERIC_SECTOR_VALUES.has(normalizedSector);

  if (!isGeneric) {
    const exact = SECTOR_TO_DESIGN_KEY[normalizedSector];
    if (exact) return exact;
  }

  const combined = `${normalizedSector} ${(extraText || '').toLowerCase()}`.trim();
  if (combined) {
    for (const category of SECTOR_KEYWORD_FALLBACK) {
      if (category.keywords.some((kw) => combined.includes(kw))) {
        return category.designKey;
      }
    }
  }

  return 'wandermap';
}

// ─── Get Design Tokens by Sector ─────────────────────────────────────────
export function getDesignTokens(sector?: string, extraText?: string): DesignTokens {
  return DESIGN_TOKEN_MAP[resolveDesignKey(sector, extraText)] || DEFAULT_TOKENS;
}

// ─── Get Design Tokens by Design Key ─────────────────────────────────────
export function getDesignTokensByKey(key: string): DesignTokens {
  return DESIGN_TOKEN_MAP[key] || DEFAULT_TOKENS;
}

// ─── Get Design Key by Sector ─────────────────────────────────────────────
// Espone la stessa risoluzione settore → design key usata internamente da
// getDesignTokens, utile a chi (es. la landing pubblica) deve scegliere
// contenuti (immagini, badge, copy) coerenti col design system applicato.
export function getDesignKeyForSector(sector?: string, extraText?: string): string {
  return resolveDesignKey(sector, extraText);
}

// ─── Apply Design Tokens as CSS Custom Properties ────────────────────────
export function applyDesignTokens(root: HTMLElement, tokens: DesignTokens): void {
  // Apply color tokens
  Object.entries(tokens.colors).forEach(([key, value]) => {
    root.style.setProperty(`--ds-${key}`, value);
  });

  // Apply font tokens
  Object.entries(tokens.fonts).forEach(([key, value]) => {
    root.style.setProperty(`--ds-font-${key}`, value);
  });

  // Apply radius tokens
  Object.entries(tokens.radii).forEach(([key, value]) => {
    root.style.setProperty(`--ds-radius-${key}`, value);
  });

  // Apply spacing tokens
  Object.entries(tokens.spacing).forEach(([key, value]) => {
    root.style.setProperty(`--ds-spacing-${key}`, value);
  });
}

// ─── Get CSS Variable Helpers ────────────────────────────────────────────
export function cssVar(name: string): string {
  return `var(--ds-${name})`;
}

// ─── Available Design Keys ────────────────────────────────────────────────
export const AVAILABLE_DESIGNS = Object.keys(DESIGN_TOKEN_MAP);

// ─── Design Key → Layout Type Mapping ─────────────────────────────────────
// Collega la tassonomia colori (SECTOR_TO_DESIGN_KEY sopra) al tipo di
// layout che DynamicLayoutRenderer deve renderizzare per quel settore.
export type DesignLayoutType = DesignLayout['type'];

const DESIGN_KEY_TO_LAYOUT: Record<string, DesignLayoutType> = {
  docuforge: 'docs',
  bistromenu: 'restaurant',
  recipebook: 'recipe',
  marketnest: 'ecommerce',
  coinpulse: 'saas',
  urbanloft: 'saas',
  volunteerhub: 'saas',
  cliniclife: 'saas',
  wandermap: 'saas',
  glassmorphism: 'saas',
  'clean-tech': 'saas',
  'warm-editorial': 'saas',
  'industrial-dark': 'saas',
  autodrive: 'ecommerce',
};

// ─── Get Layout Type by Sector ────────────────────────────────────────────
export function getLayoutTypeForSector(sector?: string, extraText?: string): DesignLayoutType {
  return DESIGN_KEY_TO_LAYOUT[resolveDesignKey(sector, extraText)] || 'saas';
}