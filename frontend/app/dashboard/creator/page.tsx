'use client';

import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Send, Loader2, Mic, MicOff, CheckCircle2, ExternalLink } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

// Type declarations for SpeechRecognition (stesso pattern di dashboard/generator/page.tsx)
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// Valori settore: alias riconosciuti da SECTOR_TO_DESIGN_KEY in frontend/lib/designTokens.ts
// (determinano sia il tema colori sia il layoutType renderizzato in /a/[slug]/app)
const SECTORS: { value: string; labelKey: string }[] = [
  { value: 'food', labelKey: 'creator_sector_food' },
  { value: 'ecommerce', labelKey: 'creator_sector_ecommerce' },
  { value: 'saas', labelKey: 'creator_sector_saas' },
  { value: 'docs', labelKey: 'creator_sector_docs' },
  { value: 'recipe', labelKey: 'creator_sector_recipe' },
  { value: 'finance', labelKey: 'creator_sector_finance' },
  { value: 'realestate', labelKey: 'creator_sector_realestate' },
  { value: 'volunteer', labelKey: 'creator_sector_volunteer' },
];

export default function CreatorPage() {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProvisioningComandi, setIsProvisioningComandi] = useState(false);
  const [comandiError, setComandiError] = useState<string | null>(null);
  const [provisionedComandiSlug, setProvisionedComandiSlug] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Inizializza SpeechRecognition (stesso pattern di dashboard/generator/page.tsx)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.lang = locale === 'it' ? 'it-IT' :
                                   locale === 'es' ? 'es-ES' :
                                   locale === 'de' ? 'de-DE' :
                                   locale === 'fr' ? 'fr-FR' : 'en-US';
        recognitionRef.current.interimResults = true;
        recognitionRef.current.continuous = false;

        recognitionRef.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result: any) => result.transcript)
            .join('');
          setPrompt(transcript);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current.onerror = () => {
          setIsListening(false);
        };
      }
    }
  }, [locale]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);

    try {
      // Get auth session
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session?.access_token) {
        alert('Devi effettuare il login per generare un\'app');
        router.push('/login');
        return;
      }

      // Call the creator generate API (Groq)
      const response = await fetch('/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          userPrompt: prompt,
          sector: selectedSector || 'saas',
          lang: locale
        })
      });

      const data = await response.json();

      if (data.success && data.data?.projectId) {
        // Redirect to app-create page
        router.push(`/dashboard/app-create?projectId=${data.data.projectId}`);
      } else {
        alert('Errore nella generazione: ' + (data.error || 'Errore sconosciuto'));
      }
    } catch (err) {
      console.error('Errore generazione:', err);
      alert('Errore di connessione. Riprova più tardi.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Comandi AI non passa dalla generazione di uno schema via AI: è un
  // modulo a schema fisso già pronto, selezionarlo consuma direttamente
  // uno slot e provisiona l'istanza (trial 30gg, vedi provisionComandiAppAction).
  const handleProvisionComandi = async () => {
    setIsProvisioningComandi(true);
    setComandiError(null);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session?.access_token) {
        router.push('/login');
        return;
      }

      const result = await provisionComandiAppAction({ accessToken: session.access_token });

      if (result.success && result.slug) {
        // Non reindirizza subito: mostra prima la success screen con l'URL
        // dell'istanza, così l'utente può copiarlo/tornare al Creator senza
        // perdere il contesto.
        setProvisionedComandiSlug(result.slug);
        setIsProvisioningComandi(false);
      } else {
        setComandiError(result.error || t('creator_comandi_error_generic'));
        setIsProvisioningComandi(false);
      }
    } catch (err) {
      console.error('Errore provisioning Comandi AI:', err);
      setComandiError(t('creator_comandi_error_generic'));
      setIsProvisioningComandi(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">{t('creator_title')}</h1>
          <p className="text-gray-400 text-lg">{t('creator_subtitle')}</p>
        </div>

        {/* Comandi AI: template a schema fisso, pronto all'uso, nessun prompt richiesto */}
        {provisionedComandiSlug ? (
          <div className="mb-4 rounded-2xl border border-green-700/50 bg-gradient-to-br from-green-950/40 to-emerald-950/20 p-6 flex flex-col items-center text-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
            <p className="text-lg font-bold text-white">{t('creator_comandi_success_title')}</p>
            <p className="text-sm text-gray-400 max-w-md">{t('creator_comandi_success_desc')}</p>
            <p className="text-xs font-mono text-gray-500 bg-gray-900/60 rounded-lg px-3 py-1.5 break-all">
              {typeof window !== 'undefined' ? window.location.origin : ''}/a/{provisionedComandiSlug}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
              <a
                href={`/a/${provisionedComandiSlug}/app`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {t('creator_comandi_success_cta')}
              </a>
              <button
                type="button"
                onClick={() => setProvisionedComandiSlug(null)}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-semibold bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {t('creator_comandi_success_dismiss')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-amber-700/40 bg-gradient-to-br from-amber-950/40 to-orange-950/20 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center shrink-0">
                <Mic className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{t('creator_comandi_card_title')}</p>
                <p className="text-sm text-gray-400 mt-1">{t('creator_comandi_card_desc')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleProvisionComandi}
              disabled={isProvisioningComandi}
              className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isProvisioningComandi && <Loader2 className="w-4 h-4 animate-spin" />}
              {isProvisioningComandi ? t('creator_comandi_card_loading') : t('creator_comandi_card_cta')}
            </button>
          </div>
        )}

        {comandiError && (
          <div className="mb-6 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">{comandiError}</div>
        )}

        {/* Main Box */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          {/* Sector Picker */}
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
              {t('creator_sector_label')}
            </p>
            <div className="flex flex-wrap gap-2">
              {SECTORS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSelectedSector(s.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selectedSector === s.value
                      ? 'bg-amber-600 border-amber-600 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-amber-500 hover:text-white'
                  }`}
                >
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Area */}
          <div className="mb-6 relative">
            <textarea
              value={prompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              placeholder={t('creator_prompt_placeholder')}
              className="w-full h-32 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-amber-500 resize-none p-4 pr-12"
            />
            {/* Microphone Button */}
            <button
              type="button"
              onClick={toggleListening}
              disabled={isGenerating}
              className={`absolute right-3 top-3 p-2 rounded-lg transition-colors ${
                isListening
                  ? 'bg-red-500/20 text-red-400 animate-pulse'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
              }`}
              title={isListening ? 'Stop listening' : 'Speak to enter text'}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {t('creator_generate_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
