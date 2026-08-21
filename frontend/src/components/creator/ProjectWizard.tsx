'use client';

// ─── ProjectWizard ──────────────────────────────────────────────────────────
// Selettore del tipo di progetto per il motore Sito/PWA (site-schema.ts):
// 3 tipologie selezionabili + prompt libero + generazione. Componente
// controllato dall'esterno solo per lo stato di caricamento (`isGenerating`):
// tipo progetto e prompt sono gestiti qui per restare un blocco autonomo,
// riusabile ovunque serva avviare una generazione.

import { useState } from 'react';
import { Loader2, Mic, MicOff, Sparkles } from 'lucide-react';
import { PROJECT_TYPES, type ProjectType } from '@/src/lib/site-schema';
import { useVoiceInput } from '@/src/lib/useVoiceInput';
import { useLanguage } from '@/src/lib/LanguageContext';

export interface ProjectWizardLabels {
  title: string;
  subtitle: string;
  projectTypeLabel: string;
  promptLabel: string;
  promptPlaceholder: string;
  generateButton: string;
  generatingButton: string;
}

export default function ProjectWizard({
  onGenerate,
  isGenerating = false,
  labels,
  defaultProjectType = 'landing',
  lang = 'it',
}: {
  onGenerate: (projectType: ProjectType, prompt: string) => void;
  isGenerating?: boolean;
  labels?: Partial<ProjectWizardLabels>;
  defaultProjectType?: ProjectType;
  lang?: string;
}) {
  // i18n (root-cause report "/dashboard/creator non traduce"): useLanguage()
  // chiamato direttamente qui (non via prop `lang`, che resta solo per
  // useVoiceInput sotto — riconoscimento vocale, non testo UI). I default
  // sotto sono ora costruiti da t(); `labels` resta un override ESTERNO
  // opzionale (usato da dashboard/creator/page.tsx per il messaggio di step
  // reale durante la generazione) — stesso contratto di prima, solo con
  // default tradotti invece di stringhe fisse.
  const { t: translate } = useLanguage();
  const [projectType, setProjectType] = useState<ProjectType>(defaultProjectType);
  const [prompt, setPrompt] = useState('');
  const defaultLabels: ProjectWizardLabels = {
    title: translate('creator_v2_wizard_title'),
    subtitle: translate('creator_v2_wizard_subtitle'),
    projectTypeLabel: translate('creator_v2_project_type_label'),
    promptLabel: translate('creator_v2_prompt_label'),
    promptPlaceholder: translate('creator_v2_prompt_placeholder'),
    generateButton: translate('creator_v2_generate_button'),
    generatingButton: translate('creator_v2_generating_button'),
  };
  const t = { ...defaultLabels, ...labels };

  // Comandi AI: dettatura vocale del prompt, stesso pattern di Generator AI.
  const { isListening, isSupported: isVoiceSupported, toggleListening } = useVoiceInput(lang, setPrompt);

  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  const handleSubmit = () => {
    if (!canGenerate) return;
    onGenerate(projectType, prompt.trim());
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2 text-white">{t.title}</h1>
        <p className="text-gray-400 text-lg">{t.subtitle}</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        {/* Selettore tipo progetto */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
            {t.projectTypeLabel}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PROJECT_TYPES.map((pt) => {
              const isSelected = projectType === pt.value;
              return (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => setProjectType(pt.value)}
                  aria-pressed={isSelected}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-800 bg-gray-950 hover:border-gray-700'
                  }`}
                >
                  <span className="text-2xl" aria-hidden="true">{pt.icon}</span>
                  <span className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-200'}`}>
                    {pt.label}
                  </span>
                  <span className="text-xs leading-relaxed text-gray-500">{pt.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt */}
        <div className="mb-6">
          <label htmlFor="zeusx-project-prompt" className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3 block">
            {t.promptLabel}
          </label>
          <div className="relative">
            <textarea
              id="zeusx-project-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.promptPlaceholder}
              maxLength={4000}
              disabled={isGenerating}
              className="w-full h-40 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-indigo-500 focus:outline-none resize-none p-4 pr-12 disabled:opacity-60"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
              }}
            />
            {isVoiceSupported && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={isGenerating}
                className={`absolute right-3 top-3 p-2 rounded-lg transition-colors disabled:opacity-40 ${
                  isListening
                    ? 'bg-red-500/20 text-red-400 animate-pulse'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                }`}
                title={isListening ? translate('creator_v2_mic_stop') : translate('creator_v2_mic_start')}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}
          </div>
          <div className="mt-1 text-right text-xs text-gray-500">{prompt.length}/4000</div>
        </div>

        {/* Genera */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canGenerate}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGenerating ? t.generatingButton : t.generateButton}
        </button>
      </div>
    </div>
  );
}
