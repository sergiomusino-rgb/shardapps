// Legal content loader - keeps JSON files clean and avoids token limits
// Place legal text files in: frontend/public/legal/[type].[lang].txt

export type LegalType = 'terms' | 'privacy';
export type Locale = 'it' | 'en' | 'fr' | 'de' | 'es';

// Default placeholder content (used when file not found)
const DEFAULT_CONTENT: Record<LegalType, Record<Locale, string>> = {
  terms: {
    it: 'Inserisci qui il testo dei termini e condizioni di ShardApps...',
    en: 'Insert the terms and conditions text for ShardApps here...',
    fr: 'Insérez le texte des conditions générales de ShardApps ici...',
    de: 'Fügen Sie hier den AGB-Text von ShardApps ein...',
    es: 'Inserta aquí el texto de términos y condiciones de ShardApps...',
  },
  privacy: {
    it: 'Inserisci qui il testo della privacy policy di ShardApps...',
    en: 'Insert the privacy policy text for ShardApps here...',
    fr: 'Insérez le texte de la politique de confidentialité de ShardApps ici...',
    de: 'Fügen Sie hier den Datenschutzrichtlinien-Text von ShardApps ein...',
    es: 'Inserta aquí el texto de la política de privacidad de ShardApps...',
  },
};

/**
 * Get legal content URL for a specific type and locale.
 * Returns the public URL path for fetching the legal text file.
 */
export function getLegalContentUrl(type: LegalType, locale: Locale): string {
  return `/legal/${type}.${locale}.txt`;
}

/**
 * Get legal content for a specific type and locale.
 * On server-side: reads from filesystem.
 * On client-side: returns placeholder (use fetch to get actual content).
 */
export function getLegalContent(type: LegalType, locale: Locale): string {
  // In server context, we can read files directly
  if (typeof window === 'undefined') {
    // Server-side: read from filesystem. require() qui (non import in cima al
    // file) e' intenzionale: questo modulo e' importato anche da pagine
    // 'use client' (per getLegalContentUrl, l'export client-safe) — un
    // import statico di 'fs'/'path' verrebbe risolto anche nel bundle
    // client e romperebbe la build (Node core module senza polyfill
    // browser). Con require() dentro il branch server-only, il bundler non
    // lo eager-risolve per il client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const filePath = path.join(process.cwd(), 'public', 'legal', `${type}.${locale}.txt`);
    
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return DEFAULT_CONTENT[type][locale];
    }
  }
  
  // Client-side: return placeholder (the page will fetch on mount)
  return DEFAULT_CONTENT[type][locale];
}

/**
 * Get all available locales for a legal type
 */
export function getAvailableLocales(type: LegalType): Locale[] {
  return ['it', 'en', 'fr', 'de', 'es'];
}