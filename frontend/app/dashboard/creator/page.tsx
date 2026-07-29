'use client';

import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { Send, Loader2, Mic, MicOff } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import DynamicAppPreview from '@/src/components/creator/DynamicAppPreview';
import type { BlueprintJSON } from '@/src/lib/blueprint-schema';

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
  const [previewSchema, setPreviewSchema] = useState<BlueprintJSON | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
    setPreviewError(null);

    try {
      // Get auth session
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session?.access_token) {
        alert('Devi effettuare il login per generare un\'app');
        router.push('/login');
        return;
      }

      // Genera solo l'anteprima (nessun salvataggio): la persistenza avviene
      // solo dopo conferma esplicita su handleConfirmCreate.
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

      if (data.success && data.data?.schema) {
        setPreviewSchema(data.data.schema);
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        alert(data.message || 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.');
        router.push(data.redirectTo || '/pricing');
      } else {
        setPreviewError(data.error || 'Errore sconosciuto');
      }
    } catch (err) {
      console.error('Errore generazione:', err);
      setPreviewError('Errore di connessione. Riprova più tardi.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!previewSchema) return;

    setIsCreating(true);
    setPreviewError(null);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();

      if (!session?.access_token) {
        alert('Devi effettuare il login per creare un\'app');
        router.push('/login');
        return;
      }

      const response = await fetch('/api/creator/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ schema: previewSchema })
      });

      const data = await response.json();

      if (data.success && data.data?.projectId) {
        router.push(`/dashboard/app-create?projectId=${data.data.projectId}`);
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        alert(data.message || 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.');
        router.push(data.redirectTo || '/pricing');
      } else {
        setPreviewError(data.error || 'Errore nella creazione dell\'app');
      }
    } catch (err) {
      console.error('Errore creazione app:', err);
      setPreviewError('Errore di connessione. Riprova più tardi.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-8">
      <div className={`mx-auto transition-[max-width] ${previewSchema ? 'max-w-6xl' : 'max-w-2xl'}`}>
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">{t('creator_title')}</h1>
          <p className="text-gray-400 text-lg">{t('creator_subtitle')}</p>
        </div>

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
              maxLength={4000}
              className="w-full h-56 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-amber-500 resize-none p-4 pr-12"
            />
            <div className="absolute right-3 bottom-3 text-xs text-gray-500 pointer-events-none">
              {prompt.length}/4000
            </div>
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

        {previewError && (
          <div className="mb-6 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
            {previewError}
          </div>
        )}

        {/* Dynamic Preview: anteprima live dello schema generato, stile Totalum/Hercules */}
        {previewSchema && (
          <div className="mb-6">
            <DynamicAppPreview
              schema={previewSchema}
              onRegenerate={handleGenerate}
              onConfirm={handleConfirmCreate}
              isCreating={isCreating}
              labels={{
                previewLabel: t('creator_preview_label'),
                tablesLabel: t('creator_preview_tables'),
                fieldsLabel: t('creator_preview_fields'),
                dashboardLabel: t('creator_preview_dashboard'),
                regenerateLabel: t('creator_preview_regenerate'),
                confirmLabel: t('creator_preview_confirm'),
                creatingLabel: t('creator_preview_creating'),
                emptyLabel: t('creator_preview_empty'),
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
