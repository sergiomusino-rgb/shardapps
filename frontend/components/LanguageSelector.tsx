'use client';

import { useState } from 'react';
import { useLanguage, SUPPORTED_LOCALES, type Locale } from '@/src/lib/LanguageContext';

const LANGUAGE_NAMES: Record<Locale, string> = {
  it: 'Italiano',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

// SVG invece di emoji bandiera: Windows non include i glifi Unicode delle
// bandiere nei font di sistema e Chrome su Windows non li disegna (mostra le
// due lettere del codice regione in chiaro invece dell'icona) — un problema
// noto della piattaforma, non del codice. L'SVG inline garantisce lo stesso
// rendering su qualunque sistema operativo/browser.
function FlagIcon({ code }: { code: Locale }) {
  const className = 'w-5 h-3.5 rounded-[2px] shrink-0';
  switch (code) {
    case 'it':
      return (
        <svg viewBox="0 0 3 2" className={className} preserveAspectRatio="none" aria-hidden="true">
          <rect width="1" height="2" x="0" fill="#009246" />
          <rect width="1" height="2" x="1" fill="#fff" />
          <rect width="1" height="2" x="2" fill="#ce2b37" />
        </svg>
      );
    case 'fr':
      return (
        <svg viewBox="0 0 3 2" className={className} preserveAspectRatio="none" aria-hidden="true">
          <rect width="1" height="2" x="0" fill="#0055a4" />
          <rect width="1" height="2" x="1" fill="#fff" />
          <rect width="1" height="2" x="2" fill="#ef4135" />
        </svg>
      );
    case 'de':
      return (
        <svg viewBox="0 0 3 2" className={className} preserveAspectRatio="none" aria-hidden="true">
          <rect width="3" height="0.667" y="0" fill="#000" />
          <rect width="3" height="0.667" y="0.667" fill="#dd0000" />
          <rect width="3" height="0.667" y="1.333" fill="#ffce00" />
        </svg>
      );
    case 'es':
      return (
        <svg viewBox="0 0 3 2" className={className} preserveAspectRatio="none" aria-hidden="true">
          <rect width="3" height="2" fill="#aa151b" />
          <rect width="3" height="1" y="0.5" fill="#f1bf00" />
        </svg>
      );
    case 'en':
      return (
        <svg viewBox="0 0 60 30" className={className} preserveAspectRatio="none" aria-hidden="true">
          <rect width="60" height="30" fill="#00247d" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#cf142b" strokeWidth="2" />
          <path d="M30,0 L30,30 M0,15 L60,15" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 L30,30 M0,15 L60,15" stroke="#cf142b" strokeWidth="6" />
        </svg>
      );
    default:
      return null;
  }
}

export default function LanguageSelector() {
  const { locale, setLocale } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800/50 border border-white/20 hover:scale-105 transition-all duration-200 shadow-lg"
        aria-label="Seleziona lingua"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <FlagIcon code={locale} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop per chiudere al click esterno */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          <div
            role="listbox"
            className="absolute right-0 top-full mt-2 z-20 rounded-xl border border-white/20 bg-slate-900/95 backdrop-blur-md p-2 min-w-[180px] shadow-xl"
          >
            <div className="flex flex-col gap-1">
              {SUPPORTED_LOCALES.map((code) => (
                <button
                  key={code}
                  role="option"
                  aria-selected={locale === code}
                  onClick={() => {
                    setLocale(code);
                    setIsOpen(false);
                  }}
                  className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    locale === code
                      ? 'bg-indigo-500/20 text-white'
                      : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <FlagIcon code={code} />
                  <span className="ml-2 font-mono text-xs text-slate-400 w-8">{code.toUpperCase()}</span>
                  <span className="text-slate-200">-</span>
                  <span className="ml-2 text-slate-200">{LANGUAGE_NAMES[code]}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}