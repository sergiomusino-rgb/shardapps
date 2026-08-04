'use client';

/**
 * LanguageContext — infrastruttura i18n "Zero Impatto".
 *
 * REGOLE:
 * - Nessun routing basato su URL (niente /it/, /en/ ecc.)
 * - Nessuna modifica a proxy.ts o al routing di Next.js
 * - La lingua scelta viene salvata in localStorage (client-side) e
 *   letta al mount. Nessuna dipendenza da next-intl / cookie NEXT_LOCALE.
 * - Il dizionario JSON corrispondente viene caricato dinamicamente da
 *   `frontend/messages/simple/<locale>.json`.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import itDict from '../../messages/simple/it.json';
import enDict from '../../messages/simple/en.json';
import frDict from '../../messages/simple/fr.json';
import deDict from '../../messages/simple/de.json';
import esDict from '../../messages/simple/es.json';

// Lingue supportate
export const SUPPORTED_LOCALES = ['en', 'it', 'es', 'fr', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'it';

const STORAGE_KEY = 'zeusx_locale';

// Dizionari — import statico di tutti i JSON "simple" (bundle piccolo, nessun impatto sul routing)
const DICTIONARIES: Record<Locale, Record<string, string>> = {
  it: itDict,
  en: enDict,
  fr: frDict,
  de: deDict,
  es: esDict,
};


interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Traduzione semplice per chiave piatta, es. t('welcome') */
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function isValidLocale(value: string | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [mounted, setMounted] = useState(false);

  // Leggi la lingua salvata al mount (client-side only, no SSR mismatch grazie a `mounted`)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isValidLocale(saved)) {
        setLocaleState(saved);
      } else {
        // Fallback: prova a leggere la lingua del browser, altrimenti default IT
        const browserLang = navigator.language?.slice(0, 2);
        if (isValidLocale(browserLang)) {
          setLocaleState(browserLang);
        }
      }
    } catch {
      /* ignore (SSR / privacy mode) */
    }
    setMounted(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string): string => {
      const dict = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];
      return dict[key] ?? key;
    },
    [locale]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  // Evita hydration mismatch: renderizza i figli solo dopo il mount client-side.
  // Non blocchiamo la UI, mostriamo semplicemente il default finché non è pronto.
  if (!mounted) {
    return (
      <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
    );
  }

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage deve essere usato dentro un <LanguageProvider>');
  }
  return ctx;
}
