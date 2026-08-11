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

import { useState, useEffect, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RotateCcw, AlertCircle, UploadCloud, Loader2, Check, Sparkles } from 'lucide-react';
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

  // Brandizza la tua app (white label reseller, piano Business): impostato
  // una volta qui, applicato automaticamente a ogni pubblicazione da
  // getTenantWhiteLabel (src/lib/creator-server.ts) — vedi
  // 20260809000001_tenants_white_label_branding.sql.
  const [tenantPlan, setTenantPlan] = useState<string | null | undefined>(undefined);
  const [whiteLabelLogoUrl, setWhiteLabelLogoUrl] = useState('');
  const [whiteLabelLabel, setWhiteLabelLabel] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingError, setBrandingError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/tenants/white-label', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.tenant) {
        setTenantPlan(data.tenant.plan || null);
        setWhiteLabelLogoUrl(data.tenant.white_label_logo_url || '');
        setWhiteLabelLabel(data.tenant.white_label_label || '');
      } else {
        setTenantPlan(null);
      }
    })();
  }, []);

  // Stesso pattern di upload di ComandiInstanceDashboard.tsx (CompanyTab):
  // carica subito nel bucket pubblico 'vision-uploads', il PATCH persiste
  // solo l'URL risultante quando l'utente preme "Salva branding".
  const handleWhiteLabelLogoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBrandingError('');
    if (!file.type.startsWith('image/')) {
      setBrandingError('Il file deve essere un\'immagine');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setBrandingError('Immagine troppo grande (max 2MB)');
      return;
    }
    setUploadingLogo(true);
    try {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) {
        setBrandingError('Devi effettuare il login');
        return;
      }
      const ext = file.name.split('.').pop() || 'png';
      const path = `${user.id}/white-label-logo-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabaseBrowser.storage
        .from('vision-uploads')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabaseBrowser.storage.from('vision-uploads').getPublicUrl(path);
      setWhiteLabelLogoUrl(publicUrlData.publicUrl);
    } catch (err) {
      console.error('[CreatorBranding] errore upload logo:', err);
      setBrandingError('Errore durante il caricamento del logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    setBrandingSaved(false);
    setBrandingError('');
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/tenants/white-label', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          white_label_logo_url: whiteLabelLogoUrl,
          white_label_label: whiteLabelLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBrandingError(data.error || 'Errore salvataggio');
        return;
      }
      setBrandingSaved(true);
      setTimeout(() => setBrandingSaved(false), 2000);
    } catch {
      setBrandingError('Errore di connessione');
    } finally {
      setSavingBranding(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <Sparkles size={28} className="text-blue-400" />
          <h1 className="text-3xl font-bold">
            <span className="text-white">Creator</span> <span className="text-blue-400">AI</span>
          </h1>
        </div>
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
        <div className="flex flex-1 flex-col items-center gap-6 py-10">
          {/* Brandizza la tua app: qui perché è il default applicato a ogni
              app che questo tenant pubblica da questo momento in poi, non
              un'impostazione della singola app (quella resta modificabile
              dopo, in dashboard/projects/[id]). */}
          <div className="mx-auto w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-400 shrink-0" />
                <div>
                  <h2 className="text-sm font-semibold text-white">Brandizza la tua app</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Il tuo logo al posto di &quot;ShardApps by MUSINO&quot; in ogni app che pubblichi da qui in poi.
                  </p>
                </div>
              </div>
              {tenantPlan !== 'business' && (
                <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400">
                  Piano Business
                </span>
              )}
            </div>

            {tenantPlan === undefined ? null : tenantPlan !== 'business' ? (
              <p className="mt-3 text-xs text-gray-500">
                Disponibile con il piano Business.{' '}
                <Link href="/pricing" className="text-indigo-400 hover:underline">Scopri di più</Link>
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-700 bg-gray-800">
                    {whiteLabelLogoUrl ? (
                      <img src={whiteLabelLogoUrl} alt="Il tuo logo" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[9px] text-gray-500">Logo</span>
                    )}
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-600">
                    {uploadingLogo ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
                    Carica logo
                    <input type="file" accept="image/*" onChange={handleWhiteLabelLogoFile} disabled={uploadingLogo} className="hidden" />
                  </label>
                </div>
                <input
                  type="text"
                  value={whiteLabelLabel}
                  onChange={(e) => setWhiteLabelLabel(e.target.value)}
                  placeholder="Testo sotto il logo, es. by Rossi Digital"
                  maxLength={40}
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={handleSaveBranding}
                  disabled={savingBranding || uploadingLogo}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 disabled:bg-gray-700"
                >
                  {savingBranding ? 'Salvataggio...' : 'Salva'}
                </button>
                {brandingSaved && <Check size={16} className="shrink-0 text-emerald-400" />}
              </div>
            )}
            {brandingError && <p className="mt-2 text-xs text-red-400">{brandingError}</p>}
          </div>

          <ProjectWizard onGenerate={handleGenerate} isGenerating={isGenerating} lang={locale} />
        </div>
      ) : (
        <div className="h-[calc(100vh-180px)] min-h-[560px]">
          <AppEditorView initialSchema={schema} onSchemaChange={setSchema} lang={locale} />
        </div>
      )}
    </div>
  );
}
