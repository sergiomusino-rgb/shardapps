'use client';

// ─── Pre-launch hardening: prima questa pagina caricava un boilerplate
// generico (public/legal/terms.it.txt via getLegalContentUrl) diverso e non
// identico ai Termini realmente accettati al signup (/info) — due Terms
// diversi pubblicamente raggiungibili. Ora renderizza la stessa fonte
// canonica di /info tramite TermsContent, eliminando il rischio di
// disallineamento. Nessuna nuova clausola: stesso identico testo di /info.
import { useLanguage } from '@/src/lib/LanguageContext';
import { FileText } from 'lucide-react';
import TermsContent from '@/components/legal/TermsContent';

export default function TermsPage() {
  const { t } = useLanguage();

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-8 h-8 text-indigo-400" />
            <h1 className="text-4xl font-bold">{t('terms_title')}</h1>
          </div>
          <p className="text-gray-400 text-lg">
            {t('terms_content')}
          </p>
        </div>

        {/* Content — stessa fonte canonica di /info (TermsContent) */}
        <TermsContent />
      </div>
    </div>
  );
}
