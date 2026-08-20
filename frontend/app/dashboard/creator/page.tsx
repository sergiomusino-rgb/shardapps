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
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RotateCcw, AlertCircle, UploadCloud, Loader2, Check, Sparkles, Pencil, X } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import ProjectWizard from '@/src/components/creator/ProjectWizard';
import AppEditorView from '@/src/components/creator/AppEditorView';
import { useLanguage } from '@/src/lib/LanguageContext';
import { sanitizeSiteBlueprint, promptSuggestsStateButMissing } from '@/src/lib/site-schema';
import type { ProjectType } from '@/src/lib/site-schema';
import type { SiteBlueprintJSON } from '@/src/lib/site-schema';

// P0-1/P0-6 (async generation + client recovery): chiave sessionStorage per
// il jobId di una generazione in corso — sopravvive a un reload della pagina
// nella stessa tab, non oltre (nessun bisogno di localStorage/persistenza
// più a lungo: un job termina sempre entro pochi minuti, vedi P0-3).
const PENDING_JOB_STORAGE_KEY = 'creatorai:pendingGenerationJobId';

// Messaggi reali per passo (requisito UX del task, "non è necessario
// introdurre una UI complessa" — solo testo, nessun componente nuovo).
const GENERATION_STEP_LABELS: Record<string, string> = {
  planning: 'Analisi della struttura…',
  generating: 'Generazione dell\'app…',
  validating: 'Validazione…',
  repairing: 'Finalizzazione…',
};

function stepLabelFor(status: string | null | undefined): string {
  if (status && GENERATION_STEP_LABELS[status]) return GENERATION_STEP_LABELS[status];
  return 'Creazione app in corso…';
}

// Intervallo di polling — un compromesso tra reattività percepita e numero
// di richieste per una pipeline che dura tipicamente decine di secondi.
// Validazione live V4 (preview zeusx-zwu8): un intervallo di 3s saturava un
// rate-limit lato Edge/proxy Vercel dopo ~4 poll consecutivi (429 mai
// arrivati al runtime dell'app, quindi non gestibili lato route — solo
// riducendo la frequenza lato client). Backoff a scalino invece che una
// vera progressione esponenziale: sufficiente a restare sotto la soglia
// osservata senza introdurre latenza percepita eccessiva su generazioni
// brevi.
const BASE_POLL_INTERVAL_MS = 5000;
const BACKOFF_POLL_INTERVAL_MS = 8000;
const BACKOFF_AFTER_ATTEMPTS = 5;
// Un 429 è per costruzione un problema di frequenza, non del job — mai
// farlo contare come un errore fatale (MAX_CONSECUTIVE_POLL_ERRORS sotto),
// solo un'attesa più lunga prima del prossimo tentativo.
const RATE_LIMIT_BACKOFF_MS = 10000;

function nextPollIntervalMs(attempt: number): number {
  return attempt > BACKOFF_AFTER_ATTEMPTS ? BACKOFF_POLL_INTERVAL_MS : BASE_POLL_INTERVAL_MS;
}

// Interruzioni di rete transitorie durante il polling (non del job stesso)
// non devono far fallire l'intera generazione al primo blip — solo dopo
// diversi tentativi consecutivi falliti si mostra un errore reale.
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export default function CreatorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLanguage();
  const [schema, setSchema] = useState<SiteBlueprintJSON | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Product Readiness Audit (P2 — qualità percepita): avviso non bloccante,
  // mai un blocco della generazione — vedi promptSuggestsStateButMissing.
  const [stateWarning, setStateWarning] = useState<string | null>(null);
  // P0-1 (async generation): messaggio reale sul passo corrente, mostrato al
  // posto del generico "Generazione in corso…" di ProjectWizard (labels
  // override, nessuna modifica al componente) mentre si fa polling di
  // GET /api/creator/generate/status/[jobId].
  const [generationStep, setGenerationStep] = useState<string | null>(null);

  // ─── Editor re-entry (FASE 3) ────────────────────────────────────────────
  // /dashboard/creator?appId=<id> — riapertura di un'app già pubblicata dalla
  // lista "App Create" (dashboard/projects). editingAppId, quando valorizzato,
  // è l'unica cosa che serve passare ad AppEditorView per farla lavorare in
  // modalità "modifica/aggiornamento" invece che "prima pubblicazione": il
  // componente lo usa già come publishedAppId iniziale (bottone "Salva
  // Modifiche" invece di "Pubblica Gestionale", ogni refactor/publish
  // successivo aggiorna l'app esistente invece di crearne una nuova, vedi
  // AppEditorView.tsx). Qui serve solo recuperare lo schema live dell'app
  // (app.config, via GET /api/apps/:id, già autenticato+ownership-checked)
  // e reidratare lo state dell'editor con quello al posto del wizard.
  const [editingAppId, setEditingAppId] = useState<string | undefined>(undefined);
  const [editingAppName, setEditingAppName] = useState<string>('');
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);

  useEffect(() => {
    const appIdParam = searchParams.get('appId');
    if (!appIdParam) return;

    let cancelled = false;
    (async () => {
      setIsLoadingExisting(true);
      setError(null);
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        if (!session?.access_token) {
          if (!cancelled) {
            setError('Devi effettuare il login per modificare questa app.');
            router.push('/login');
          }
          return;
        }

        const res = await fetch(`/api/apps/${appIdParam}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();

        if (!res.ok || !data.app) {
          if (!cancelled) setError(data.error || 'App non trovata o non autorizzata.');
          return;
        }

        // Ri-sanitizzato con lo stesso schema Zod usato ovunque nel motore
        // (generate/refactor/publish): app.config è quello che è stato
        // salvato l'ultima volta, ma un'app pubblicata prima dell'aggiunta di
        // un campo (es. authConfig, arrivato in Fase 3) potrebbe non averlo —
        // sanitizeSiteBlueprint applica gli stessi default sicuri usati alla
        // generazione, invece di forzare l'editor a gestire un blueprint
        // parziale.
        const sanitized = sanitizeSiteBlueprint(data.app.config);
        if (!sanitized) {
          if (!cancelled) setError('Questa app non usa il motore Creator AI (Sito/PWA) e non può essere riaperta qui.');
          return;
        }

        if (!cancelled) {
          setSchema(sanitized);
          setEditingAppId(data.app.id);
          setEditingAppName(data.app.name || sanitized.businessConfig.name || sanitized.appName);
        }
      } catch (err) {
        console.error('[creator] load existing app error:', err);
        if (!cancelled) setError('Errore di connessione durante il caricamento dell\'app.');
      } finally {
        if (!cancelled) setIsLoadingExisting(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  // ─── P0-1 (async generation) ──────────────────────────────────────────
  // Applica il risultato di un job 'ready' allo stato dell'editor — stessa
  // logica che prima viveva inline in handleGenerate quando la risposta
  // arrivava sincrona, ora condivisa fra il percorso "generazione appena
  // avviata" e "job recuperato dopo un reload" (P0-6).
  const applyReadySchema = (readySchema: SiteBlueprintJSON, prompt?: string) => {
    setSchema(readySchema);
    if (prompt && promptSuggestsStateButMissing(prompt, readySchema)) {
      setStateWarning('La tua descrizione sembra menzionare uno stato/workflow, ma lo schema generato non include un campo di questo tipo. Puoi chiederlo di nuovo al Copilot qui a destra (es. "aggiungi un campo di stato con i valori...").');
    }
  };

  // Polling di GET /api/creator/generate/status/[jobId] finché lo status non
  // è 'ready' o 'failed' (requisito esplicito: MAI mostrare "generation
  // failed" per un job ancora planning/generating/validating/repairing —
  // root-cause report, "async generation / client-server lifecycle
  // mismatch"). `prompt` è opzionale: assente quando il job viene recuperato
  // dopo un reload (P0-6), nel qual caso si salta solo l'euristica non
  // bloccante di promptSuggestsStateButMissing.
  const pollGenerationJob = async (jobId: string, prompt?: string) => {
    let consecutiveErrors = 0;
    let attempt = 0;

    const tick = async (): Promise<void> => {
      attempt += 1;
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        if (!session?.access_token) {
          sessionStorage.removeItem(PENDING_JOB_STORAGE_KEY);
          setIsGenerating(false);
          setGenerationStep(null);
          alert('Devi effettuare il login per continuare');
          router.push('/login');
          return;
        }

        const res = await fetch(`/api/creator/generate/status/${jobId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (res.status === 429) {
          // Rate-limit lato Edge/proxy Vercel, non un errore del job (la
          // richiesta non arriva nemmeno al runtime dell'app — vedi
          // validazione live V4): mai farlo contare come tentativo fatale,
          // solo un'attesa più lunga prima del prossimo poll.
          console.warn('[creator] poll rate-limited (429), backoff prima del prossimo tentativo');
          setTimeout(tick, RATE_LIMIT_BACKOFF_MS);
          return;
        }

        const data = await res.json();
        consecutiveErrors = 0;

        if (!res.ok || !data.success) {
          // 404 (job non trovato/non proprio) è terminale, non transitorio.
          if (res.status === 404) {
            sessionStorage.removeItem(PENDING_JOB_STORAGE_KEY);
            setError(data.error || 'Generazione non trovata.');
            setIsGenerating(false);
            setGenerationStep(null);
            return;
          }
          throw new Error(data.error || `status ${res.status}`);
        }

        if (data.status === 'ready') {
          sessionStorage.removeItem(PENDING_JOB_STORAGE_KEY);
          setGenerationStep(null);
          setIsGenerating(false);
          if (data.data?.schema) applyReadySchema(data.data.schema, prompt);
          else setError('La generazione è terminata senza uno schema valido. Riprova.');
          return;
        }
        if (data.status === 'failed') {
          sessionStorage.removeItem(PENDING_JOB_STORAGE_KEY);
          setGenerationStep(null);
          setIsGenerating(false);
          setError(data.error || 'Errore sconosciuto durante la generazione');
          return;
        }

        // planning/generating/validating/repairing: ancora in corso, MAI un
        // errore mostrato qui — solo il messaggio di passo aggiornato.
        setGenerationStep(stepLabelFor(data.status));
        setTimeout(tick, nextPollIntervalMs(attempt));
      } catch (err) {
        consecutiveErrors += 1;
        console.error('[creator] poll error:', err);
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          setError('Errore di connessione durante il controllo della generazione. Riprova più tardi — se la generazione era già in corso potrebbe comunque completarsi: controlla tra qualche minuto prima di riprovare.');
          setIsGenerating(false);
          setGenerationStep(null);
          return;
        }
        setTimeout(tick, nextPollIntervalMs(attempt));
      }
    };

    await tick();
  };

  // ─── P0-6 (client recovery dopo disconnessione) ──────────────────────────
  // Se il browser perde la connessione/ricarica la pagina mentre un job è
  // ancora in corso, al rientro su questa pagina si riprende il polling
  // dello STESSO job invece di lasciare l'utente senza feedback (o peggio,
  // permettergli di avviarne uno nuovo credendo che il precedente sia
  // perso — vedi P0-2, idempotenza, che comunque lo eviterebbe lato server,
  // ma qui l'obiettivo è UX: recuperare lo stato reale). Meccanismo più
  // semplice compatibile col resto del codice: sessionStorage, nessuna
  // libreria nuova. Effetto posizionato DOPO pollGenerationJob (dichiarata
  // sopra) — stesso vincolo di ordine di dichiarazione già rispettato
  // altrove in questo file; il corpo async è racchiuso in una IIFE, stesso
  // pattern dell'effetto di re-entry "?appId=" più in alto.
  useEffect(() => {
    const pendingJobId = sessionStorage.getItem(PENDING_JOB_STORAGE_KEY);
    if (!pendingJobId) return;
    (async () => {
      setIsGenerating(true);
      setError(null);
      setGenerationStep('Recupero della generazione in corso…');
      await pollGenerationJob(pendingJobId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (projectType: ProjectType, prompt: string) => {
    setIsGenerating(true);
    setError(null);
    setStateWarning(null);
    setGenerationStep('Creazione app in corso…');

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
        // Risposta immediata con schema già pronto: ramo legacy sector-based
        // (invariato), o un job idempotente già 'ready' (P0-2, deduped:true).
        setGenerationStep(null);
        setIsGenerating(false);
        applyReadySchema(data.data.schema, prompt);
      } else if (data.success && data.jobId) {
        // P0-1: generazione asincrona avviata (o già in corso, deduped) —
        // la connessione HTTP di /generate è già chiusa, si fa polling dello
        // stato reale invece di aspettare qui. P0-6: jobId persistito così
        // un reload della pagina può recuperarlo.
        sessionStorage.setItem(PENDING_JOB_STORAGE_KEY, data.jobId);
        setGenerationStep(stepLabelFor(data.status));
        await pollGenerationJob(data.jobId, prompt);
        return; // pollGenerationJob gestisce già isGenerating/generationStep
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
      // pollGenerationJob (ramo asincrono) gestisce da sé isGenerating: se
      // questo finally lo resettasse comunque, un polling ancora in corso
      // lascerebbe la UI in uno stato incoerente (bottone di nuovo attivo
      // mentre il job procede). setIsGenerating(false) qui è quindi corretto
      // SOLO per i rami sincroni sopra (return anticipato nel ramo async).
      setIsGenerating((prev) => (sessionStorage.getItem(PENDING_JOB_STORAGE_KEY) ? prev : false));
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
        <div className="flex items-center gap-2">
          {editingAppId && (
            <span className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-300">
              <Pencil size={11} /> Modifica: {editingAppName}
            </span>
          )}
          {schema && (
            <button
              onClick={() => {
                setSchema(null);
                setError(null);
                setStateWarning(null);
                setEditingAppId(undefined);
                setEditingAppName('');
                // Rimuove ?appId= dall'URL: senza, un refresh o una nuova
                // generazione dal wizard ripartirebbe da qui e ricaricherebbe
                // la stessa app invece di restare sul wizard vuoto.
                router.replace('/dashboard/creator');
              }}
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              <RotateCcw size={14} /> Ricomincia
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          {/* Product Readiness Audit (P3): un rientro fallito da ?appId=
              (es. un'app del vecchio motore tabellare, non riapribile qui)
              lasciava solo il messaggio d'errore, senza un modo esplicito
              per tornare alla lista app — l'utente doveva usare "indietro"
              del browser o la sidebar. isLoadingExisting è già false qui
              (altrimenti mostreremmo lo spinner, non questo banner). */}
          {searchParams.get('appId') && !editingAppId && (
            <Link href="/dashboard/projects" className="shrink-0 whitespace-nowrap font-semibold text-red-200 underline hover:text-white">
              Torna alle tue app
            </Link>
          )}
        </div>
      )}

      {stateWarning && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{stateWarning}</span>
          <button onClick={() => setStateWarning(null)} className="shrink-0 text-amber-300 hover:text-white" aria-label="Chiudi avviso">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Wizard o Editor */}
      {isLoadingExisting ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            Caricamento dell&apos;app…
          </div>
        </div>
      ) : !schema ? (
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

          <ProjectWizard
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            lang={locale}
            // P0-1: messaggio di passo reale al posto del generico
            // "Generazione in corso…" — nessuna modifica a ProjectWizard,
            // usa l'override labels già esistente.
            labels={generationStep ? { generatingButton: generationStep } : undefined}
          />
        </div>
      ) : (
        <div className="h-[calc(100vh-180px)] min-h-[560px]">
          <AppEditorView initialSchema={schema} onSchemaChange={setSchema} appId={editingAppId} lang={locale} />
        </div>
      )}
    </div>
  );
}
