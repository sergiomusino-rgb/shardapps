'use client';

// ─── Creator AI (motore Sito/PWA) ───────────────────────────────────────────
// Rotta principale del Creator AI: collega ProjectWizard -> POST
// /api/creator/generate (ramo projectType) -> AppEditorView, che a sua volta
// chiama /api/creator/refactor per ogni modifica in chat. Promosso da
// dashboard/creator-v2 (ambiente di test) dopo verifica end-to-end.
//
// Il flusso storico a tabelle (sector-based) è ora su /dashboard/creator-v1,
// visibile solo all'admin di sistema (vedi components/layout/Sidebar.tsx).
//
// Nota: questa pagina genera e permette di modificare live lo schema, ma non
// lo persiste ancora — non chiama /api/creator/create, che si aspetta il
// vecchio BlueprintJSON tabellare, incompatibile con il nuovo
// SiteBlueprintJSON. Il passo di conferma/pubblicazione per il nuovo motore
// resta da costruire.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, AlertCircle } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import ProjectWizard from '@/src/components/creator/ProjectWizard';
import AppEditorView from '@/src/components/creator/AppEditorView';
import { useLanguage } from '@/src/lib/LanguageContext';
import type { ProjectType } from '@/src/lib/site-schema';
import type { SiteBlueprintJSON } from '@/src/lib/site-schema';

export default function CreatorPage() {
  const router = useRouter();
  const { locale } = useLanguage();
  const [schema, setSchema] = useState<SiteBlueprintJSON | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (projectType: ProjectType, prompt: string) => {
    setIsGenerating(true);
    setError(null);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) {
        alert('Devi effettuare il login per generare un progetto');
        router.push('/login');
        return;
      }

      const response = await fetch('/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userPrompt: prompt, projectType, lang: locale }),
      });
      const data = await response.json();

      if (data.success && data.data?.schema) {
        setSchema(data.data.schema);
      } else if (data.code === 'SLOTS_EXHAUSTED') {
        alert(data.message || 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.');
        router.push(data.redirectTo || '/pricing');
      } else {
        setError(data.error || 'Errore sconosciuto durante la generazione');
      }
    } catch (err) {
      console.error('[creator] generate error:', err);
      setError('Errore di connessione. Riprova più tardi.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Creator AI</h1>
        {schema && (
          <button
            onClick={() => { setSchema(null); setError(null); }}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            <RotateCcw size={14} /> Ricomincia
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Wizard o Editor */}
      {!schema ? (
        <div className="flex flex-1 items-center justify-center py-10">
          <ProjectWizard onGenerate={handleGenerate} isGenerating={isGenerating} />
        </div>
      ) : (
        <div className="h-[calc(100vh-180px)] min-h-[560px]">
          <AppEditorView initialSchema={schema} onSchemaChange={setSchema} lang={locale} />
        </div>
      )}
    </div>
  );
}
