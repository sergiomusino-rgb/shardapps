'use client';

// ─── Pre-launch hardening: fonte canonica unica per i Termini e Condizioni ──
// Prima esistevano due testi non identici: quello realmente accettato al
// signup (le sezioni info_terms_section1-8, inline qui sotto) e un
// boilerplate generico in public/legal/terms.it.txt (servito da
// /dashboard/terms), che citava ancora "zeusx" e clausole fuori contesto
// (USD, embargo USA). Questo componente è ora l'UNICA fonte: sia /info sia
// /dashboard/terms lo importano, così un solo testo può mai esistere.
import { useLanguage } from '@/src/lib/LanguageContext';

const SECTION_KEYS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export default function TermsContent({ variant = 'panel' }: { variant?: 'panel' | 'plain' }) {
  const { t } = useLanguage();

  if (variant === 'plain') {
    return (
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        {SECTION_KEYS.map((n) => (
          <section key={n}>
            <h3 className="text-lg font-bold text-white mb-2">{t(`info_terms_section${n}_title`)}</h3>
            <p>{t(`info_terms_section${n}_desc`)}</p>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
      {SECTION_KEYS.map((n) => (
        <section key={n} className="p-6 bg-slate-900 rounded-2xl border border-slate-800">
          <h3 className="text-lg font-bold text-white mb-3">{t(`info_terms_section${n}_title`)}</h3>
          <p>{t(`info_terms_section${n}_desc`)}</p>
        </section>
      ))}
    </div>
  );
}
