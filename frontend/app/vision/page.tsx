'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';
import type { SplitProgress } from '@/src/lib/video-splitter';
import {
  Clapperboard,
  ImageUp,
  Film,
  Wand2,
  Loader2,
  Download,
  Zap,
  X,
  AlertTriangle,
  RefreshCw,
  CircleDollarSign,
  Plus,
  Check,
  Layers,
  Trash2,
  Sparkles,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

type Mode = 'image-to-video' | 'video-to-video';
type Duration = '5' | '10';
type SourceKind = 'image' | 'video';
type AspectRatio = '9:16' | '16:9' | '1:1';
type TargetLanguage = 'it' | 'en' | 'es' | 'fr' | 'de';

// image-to-video: costo proporzionale alla durata scelta. video-to-video
// (remix): costo fisso, nessuna durata selezionabile — stessa logica della
// API route (frontend/app/api/generate-video/route.ts), duplicata qui solo
// per il calcolo lato client (badge crediti, verifica saldo prima di inviare).
function getCreditCost(mode: Mode, duration: Duration): number {
  if (mode === 'video-to-video') return 10;
  return duration === '10' ? 10 : 5;
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE_SIZE_MB = 20;
// Il bucket 'vision-uploads' è configurato a 100MB (vedi supabase/migrations/
// 20260802000002), ma Supabase Storage applica ANCHE un limite GLOBALE di
// progetto, separato dal file_size_limit del singolo bucket e impostabile
// solo dalla Dashboard (Settings → Storage), non da una migrazione SQL — sul
// piano di questo progetto è fermo a 50MB. È quel limite, più restrittivo, a
// valere davvero: un upload tra 50 e 100MB fallisce comunque con
// StorageApiError "The object exceeded the maximum allowed size" anche se il
// bucket lo consentirebbe. Se in futuro il piano viene aggiornato e il tetto
// globale alzato, alzare qui MAX_VIDEO_SIZE_MB/SPLIT_TARGET_CHUNK_MB e
// SPLIT_HARD_LIMIT_MB in src/lib/video-splitter.ts di conseguenza.
const MAX_VIDEO_SIZE_MB = 50;
// Un video sopra soglia viene spezzato invece di essere respinto: ogni pezzo
// punta a questa dimensione target, sotto MAX_VIDEO_SIZE_MB per lasciare
// margine alla variabilità di bitrate tra un segmento e l'altro (vedi
// src/lib/video-splitter.ts).
const SPLIT_TARGET_CHUNK_MB = 35;
// Tetto generoso per chi vuole scrivere una descrizione dettagliata invece
// di una semplice idea: il Prompt Enhancer lato server (app/api/generate-video
// /route.ts) la condensa comunque in un prompt cinematografico professionale
// prima di passarla al modello video, qualunque sia la lunghezza in ingresso.
// Va tenuto allineato a MAX_PROMPT_LENGTH in quella route.
const MAX_PROMPT_LENGTH = 20000;
const MAX_PROMPT_WORDS = 2500;

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

type TFunction = (key: string) => string;

// ── Formato spot (aspect ratio) ─────────────────────────────────────────────
// Applicato lato server solo per image-to-video: il remix video-to-video
// eredita le proporzioni del video sorgente (vedi generate-video/route.ts),
// il selettore resta comunque visibile in entrambe le modalità con un avviso.
// Funzione (non costante): il testo dipende da t(), disponibile solo dentro
// il componente — vedi useMemo più sotto, stesso motivo per le altre
// funzioni getXxx qui sotto.
function getAspectRatios(t: TFunction): { value: AspectRatio; label: string; hint: string }[] {
  return [
    { value: '9:16', label: '9:16', hint: t('vision_aspect_916_hint') },
    { value: '16:9', label: '16:9', hint: t('vision_aspect_169_hint') },
    { value: '1:1', label: '1:1', hint: t('vision_aspect_11_hint') },
  ];
}

// Indicatore visivo dell'orientamento (larghezza/altezza in proporzione).
const ASPECT_RATIO_ICON_CLASS: Record<AspectRatio, string> = {
  '9:16': 'w-3.5 h-6',
  '16:9': 'w-6 h-3.5',
  '1:1': 'w-5 h-5',
};

// ── Lingua / mercato di destinazione ────────────────────────────────────────
// I nomi delle lingue sono endonimi (ogni lingua scrive il proprio nome nella
// propria forma nativa): non si traducono in base alla lingua dell'interfaccia,
// stessa convenzione di qualunque selettore di lingua.
const LANGUAGES: { value: TargetLanguage; label: string }[] = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

function getLoadingMessages(t: TFunction): Record<Mode, string[]> {
  return {
    'image-to-video': [
      t('vision_loading_i2v_1'),
      t('vision_loading_i2v_2'),
      t('vision_loading_i2v_3'),
      t('vision_loading_i2v_4'),
      t('vision_loading_i2v_5'),
    ],
    'video-to-video': [
      t('vision_loading_v2v_1'),
      t('vision_loading_v2v_2'),
      t('vision_loading_v2v_3'),
      t('vision_loading_v2v_4'),
      t('vision_loading_v2v_5'),
    ],
  };
}

function getModeConfig(t: TFunction): Record<Mode, {
  label: string;
  subtitle: string;
  icon: typeof ImageUp;
  dropzoneLabel: string;
  dropzoneHint: string;
  promptLabel: string;
  promptExample: string;
  promptPlaceholder: string;
  accepted: string[];
  maxSizeMB: number;
  kind: SourceKind;
}> {
  return {
    'image-to-video': {
      label: t('vision_mode_i2v_label'),
      subtitle: t('vision_mode_i2v_subtitle'),
      icon: ImageUp,
      dropzoneLabel: t('vision_mode_i2v_dropzone_label'),
      dropzoneHint: t('vision_mode_i2v_dropzone_hint').replace('{size}', String(MAX_IMAGE_SIZE_MB)),
      promptLabel: t('vision_prompt_label'),
      promptExample: t('vision_mode_i2v_prompt_example'),
      promptPlaceholder: t('vision_mode_i2v_prompt_placeholder'),
      accepted: ACCEPTED_IMAGE_TYPES,
      maxSizeMB: MAX_IMAGE_SIZE_MB,
      kind: 'image',
    },
    'video-to-video': {
      label: t('vision_mode_v2v_label'),
      subtitle: t('vision_mode_v2v_subtitle'),
      icon: Film,
      dropzoneLabel: t('vision_mode_v2v_dropzone_label'),
      dropzoneHint: t('vision_mode_v2v_dropzone_hint').replace('{size}', String(MAX_VIDEO_SIZE_MB)),
      promptLabel: t('vision_prompt_label'),
      promptExample: t('vision_mode_v2v_prompt_example'),
      promptPlaceholder: t('vision_mode_v2v_prompt_placeholder'),
      accepted: ACCEPTED_VIDEO_TYPES,
      maxSizeMB: MAX_VIDEO_SIZE_MB,
      kind: 'video',
    },
  };
}

// ── Sequenza / Storyboard ────────────────────────────────────────────────
// Costanti duplicate lato client dalla route (frontend/app/api/concat-videos/
// route.ts) solo per il calcolo dei limiti in UI (badge crediti, CTA
// disabilitata) prima di inviare la richiesta — la validazione che conta
// resta quella server-side.
const CONCAT_CREDIT_COST = 2;
const MAX_SEQUENCE_CLIPS = 12;

interface SequenceClip {
  id: string;
  url: string;
  mode: Mode;
  durationSeconds: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tipi risposta API
// ═══════════════════════════════════════════════════════════════════════════

interface GenerateVideoSuccess {
  success: true;
  data: {
    videoUrl: string;
    requestId?: string;
    mode: Mode;
    durationSeconds: number;
    aspectRatio: AspectRatio;
    targetLanguage: TargetLanguage;
    creditsUsed: number;
    creditsRemaining: number;
    // false se il salvataggio della clip nello storage ShardApps è fallito: la
    // clip resta guardabile/scaricabile ma non può entrare nella Sequenza
    // (concat-videos accetta solo clip del nostro bucket, vedi route).
    persisted: boolean;
  };
}

interface GenerateVideoError {
  success: false;
  error: string;
  code?: string;
  creditsRequired?: number;
  creditsAvailable?: number;
}

type GenerateVideoResponse = GenerateVideoSuccess | GenerateVideoError;

interface ConcatVideosSuccess {
  success: true;
  data: {
    videoUrl: string;
    clipsUsed: number;
    creditsUsed: number;
    creditsRemaining: number;
  };
}

interface ConcatVideosError {
  success: false;
  error: string;
  code?: string;
  creditsRequired?: number;
  creditsAvailable?: number;
}

type ConcatVideosResponse = ConcatVideosSuccess | ConcatVideosError;

// ═══════════════════════════════════════════════════════════════════════════
// Page entry point
// ═══════════════════════════════════════════════════════════════════════════

// L'autenticazione (con requireTenant) è già garantita a monte da
// DashboardLayoutClient (vedi app/vision/layout.tsx): questa pagina non ha
// più bisogno di un proprio AuthGuard, stesso criterio delle altre pagine
// /dashboard/*.
export default function VisionStudioPage() {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Testi dipendenti dalla lingua corrente: ricalcolati solo quando `t`
  // cambia identità (cioè quando cambia la lingua selezionata), non ad ogni
  // render — vedi la dipendenza [t] di useLanguage().
  const modeConfigMap = useMemo(() => getModeConfig(t), [t]);
  const loadingMessages = useMemo(() => getLoadingMessages(t), [t]);
  const aspectRatios = useMemo(() => getAspectRatios(t), [t]);

  // ── Utente & crediti ────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  // ── Modalità ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('image-to-video');
  const modeConfig = modeConfigMap[mode];

  // ── Upload sorgente (immagine o video) ──────────────────────────────────
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedSourceUrl, setUploadedSourceUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // ── Split lato client di video oversize (> MAX_VIDEO_SIZE_MB) ───────────
  // Popolato solo per video-to-video quando il file sorgente supera il
  // limite fisico del bucket: contiene gli URL (già caricati) di ciascun
  // pezzo, nell'ordine originale. Quando è valorizzato, handleGenerate segue
  // il percorso multi-parte (remix per pezzo + unione finale) invece della
  // singola chiamata a generate-video (vedi handleGenerateSplit sotto).
  const [splitParts, setSplitParts] = useState<string[] | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitProgress, setSplitProgress] = useState<SplitProgress | null>(null);

  // ── Regia AI ────────────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<Duration>('5');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>('it');

  // ── Generazione ─────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<GenerateVideoError | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultDurationSeconds, setResultDurationSeconds] = useState<number | null>(null);
  const [resultPersisted, setResultPersisted] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [generateProgress, setGenerateProgress] = useState<{ stage: 'remix' | 'merge'; current: number; total: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [addedToSequence, setAddedToSequence] = useState(false);

  // ── Sequenza / Storyboard ───────────────────────────────────────────────
  const [sequence, setSequence] = useState<SequenceClip[]>([]);
  const [concatenating, setConcatenating] = useState(false);
  const [concatError, setConcatError] = useState<string | null>(null);
  const [concatVideoUrl, setConcatVideoUrl] = useState<string | null>(null);
  const [concatDownloading, setConcatDownloading] = useState(false);

  // Percorso multi-parte: un remix per pezzo (stesso costo del remix
  // singolo) più il costo fisso di unione finale (vedi CONCAT_CREDIT_COST),
  // invece del costo fisso singolo del percorso normale.
  const cost = splitParts && splitParts.length > 0
    ? getCreditCost('video-to-video', duration) * splitParts.length + CONCAT_CREDIT_COST
    : getCreditCost(mode, duration);
  const hasEnoughCredits = credits === null ? true : credits >= cost;
  // Il prompt è opzionale: se l'utente non scrive nulla, il Prompt Enhancer
  // lato server applica un prompt di default ottimizzato (vedi generate-video/route.ts).
  const canGenerate = Boolean(uploadedSourceUrl) && !uploading && !splitting && !generating && hasEnoughCredits;

  const sequenceTotalSeconds = sequence.reduce((sum, clip) => sum + clip.durationSeconds, 0);
  const hasEnoughCreditsForConcat = credits === null ? true : credits >= CONCAT_CREDIT_COST;
  const canConcat = sequence.length >= 2 && sequence.length <= MAX_SEQUENCE_CLIPS && !concatenating && hasEnoughCreditsForConcat;

  // Percorso multi-parte: sostituisce il messaggio generico rotante con il
  // progresso reale (pezzo N/M in remix, poi unione finale) — più preciso
  // per un'operazione che può richiedere diversi minuti su più chiamate.
  const generatingLabel = generateProgress
    ? generateProgress.stage === 'remix'
      ? t('vision_split_remix_progress').replace('{current}', String(generateProgress.current)).replace('{total}', String(generateProgress.total))
      : t('vision_split_merge_progress')
    : loadingMessages[mode][loadingMessageIndex % loadingMessages[mode].length];

  // ── Sessione utente + crediti in tempo reale ────────────────────────────
  useEffect(() => {
    let channel: ReturnType<typeof supabaseBrowser.channel> | null = null;
    let cancelled = false;

    async function init() {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const uid = session?.user?.id;
      if (!uid || cancelled) return;
      setUserId(uid);

      const { data } = await supabaseBrowser
        .from('profiles')
        .select('credits')
        .eq('user_id', uid)
        .single();

      if (!cancelled) setCredits(data?.credits ?? 0);
      if (cancelled) return;

      const topic = `vision-credits-${uid}`;
      // supabase-js RIUSA un canale già esistente con lo stesso topic invece
      // di crearne uno nuovo: in dev, il doppio invoke degli effect in React
      // Strict Mode fa sì che la seconda chiamata a .channel(topic) recuperi
      // il canale già sottoscritto dalla prima, e il successivo .on() fallisca
      // con "cannot add postgres_changes callbacks ... after subscribe()".
      // Rimuoviamo qualunque canale residuo con lo stesso topic prima di
      // crearne uno nuovo, per essere sicuri di partire sempre da uno pulito.
      const stale = supabaseBrowser.getChannels().find((c) => c.topic === `realtime:${topic}`);
      if (stale) await supabaseBrowser.removeChannel(stale);
      if (cancelled) return;

      channel = supabaseBrowser
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${uid}` },
          (payload) => setCredits((payload.new as { credits: number }).credits ?? 0)
        )
        .subscribe();
    }

    init();
    return () => {
      cancelled = true;
      if (channel) supabaseBrowser.removeChannel(channel);
    };
  }, []);

  // ── Rotazione messaggi di caricamento durante la generazione ────────────
  // L'indice riparte da 0 in handleGenerate (non qui): un effetto non deve
  // chiamare setState in modo sincrono nel proprio corpo, solo in risposta
  // a eventi/timer che sottoscrive.
  useEffect(() => {
    if (!generating) return;
    const messages = loadingMessages[mode];
    const interval = setInterval(() => {
      setLoadingMessageIndex((i) => (i + 1) % messages.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [generating, mode, loadingMessages]);

  // ── Cleanup object URL locale dell'anteprima ────────────────────────────
  // Il revoke NON deve dipendere da `sourcePreview` nella dependency list: un
  // effetto keyed su quel valore viene ri-eseguito (cleanup compreso) ad ogni
  // cambio file, e sotto React Strict Mode / Fast Refresh in dev questo
  // poteva far scattare la revoke mentre il browser stava ancora
  // decodificando il blob, mostrando un'anteprima "rotta". Il ref tiene
  // traccia solo dell'URL più recente e lo revoca esclusivamente al vero
  // unmount del componente; la revoke dell'URL *precedente* resta gestita
  // esplicitamente in handleFileChosen/handleRemoveSource, nel momento giusto.
  const sourcePreviewRef = useRef<string | null>(null);
  useEffect(() => {
    sourcePreviewRef.current = sourcePreview;
  }, [sourcePreview]);

  useEffect(() => {
    return () => {
      if (sourcePreviewRef.current) URL.revokeObjectURL(sourcePreviewRef.current);
    };
  }, []);

  // ── Cambio modalità: il file caricato per una modalità non ha senso
  // nell'altra (immagine vs video), quindi si resetta lo stato di upload. ──
  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode === mode) return;
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourcePreview(null);
    setSourceKind(null);
    setUploadedSourceUrl(null);
    setUploadError(null);
    setSplitParts(null);
    setSplitting(false);
    setSplitProgress(null);
    setResultVideoUrl(null);
    setGenerationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMode(newMode);
  }, [mode, sourcePreview]);

  // ── Split + upload di un video sorgente oversize ─────────────────────────
  // Il bucket 'vision-uploads' rifiuta fisicamente i file oltre 100MB (vedi
  // SPLIT_TARGET_CHUNK_MB sopra): niente da fare lato server, lo split deve
  // avvenire nel browser PRIMA di qualunque upload. Ogni pezzo risultante
  // viene caricato come se fosse un upload singolo (stesso path pattern),
  // e i relativi URL restano in splitParts per handleGenerateSplit.
  const splitAndUploadSource = useCallback(async (file: File) => {
    if (!userId) return;

    setUploadError(null);
    setUploadedSourceUrl(null);
    setSplitParts(null);
    setSplitting(true);
    setSplitProgress({ stage: 'loading', current: 0, total: 0 });

    try {
      const { splitVideoBySize } = await import('@/src/lib/video-splitter');
      const chunks = await splitVideoBySize(file, SPLIT_TARGET_CHUNK_MB, setSplitProgress);

      const uploadedUrls: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const path = `${userId}/${crypto.randomUUID()}-part${i + 1}.mp4`;
        const { error } = await supabaseBrowser.storage
          .from('vision-uploads')
          .upload(path, chunks[i], { contentType: 'video/mp4', upsert: false });
        if (error) throw error;
        const { data } = supabaseBrowser.storage.from('vision-uploads').getPublicUrl(path);
        uploadedUrls.push(data.publicUrl);
      }

      setSplitParts(uploadedUrls);
      // Alcuni controlli di UI (canGenerate, badge "pronto") leggono
      // uploadedSourceUrl come segnale generico "sorgente pronta": la prima
      // parte basta a quello scopo, handleGenerate userà splitParts per
      // intero quando presente (vedi handleGenerateSplit).
      setUploadedSourceUrl(uploadedUrls[0]);
    } catch (err) {
      console.error('[Vision] split/upload error:', err);
      setUploadError(t('vision_error_split_failed'));
    } finally {
      setSplitting(false);
      setSplitProgress(null);
    }
  }, [userId, t]);

  // ── Upload sorgente su Supabase Storage ──────────────────────────────────
  const uploadSource = useCallback(async (file: File, kind: SourceKind) => {
    if (!userId) return;

    const config = modeConfigMap[mode];
    if (!config.accepted.includes(file.type)) {
      setUploadError(kind === 'image' ? t('vision_error_format_image') : t('vision_error_format_video'));
      return;
    }
    if (file.size > config.maxSizeMB * 1024 * 1024) {
      // Le immagini non si spezzano (non avrebbe senso): solo i video
      // oversize passano dal percorso split-e-carica-a-pezzi.
      if (kind === 'video') {
        splitAndUploadSource(file);
        return;
      }
      setUploadError(t('vision_error_file_too_large').replace('{size}', String(config.maxSizeMB)));
      return;
    }

    setUploadError(null);
    setUploadedSourceUrl(null);
    setSplitParts(null);
    setUploading(true);

    const ext = file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4');
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabaseBrowser.storage
      .from('vision-uploads')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) {
      console.error('[Vision] upload error:', error);
      setUploadError(t('vision_error_upload_failed'));
      setUploading(false);
      return;
    }

    const { data } = supabaseBrowser.storage.from('vision-uploads').getPublicUrl(path);
    setUploadedSourceUrl(data.publicUrl);
    setUploading(false);
  }, [userId, mode, modeConfigMap, t, splitAndUploadSource]);

  const handleFileChosen = useCallback((file: File | undefined | null) => {
    if (!file) return;

    const kind: SourceKind | null = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : null;

    if (!kind) {
      setUploadError(t('vision_error_format_unknown'));
      return;
    }
    if (kind !== modeConfig.kind) {
      setUploadError(kind === 'video' ? t('vision_error_wrong_kind_video') : t('vision_error_wrong_kind_image'));
      return;
    }

    setResultVideoUrl(null);
    setGenerationError(null);
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourcePreview(URL.createObjectURL(file));
    setSourceKind(kind);
    uploadSource(file, kind);
  }, [sourcePreview, uploadSource, modeConfig.kind, t]);

  const handleRemoveSource = useCallback(() => {
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourcePreview(null);
    setSourceKind(null);
    setUploadedSourceUrl(null);
    setUploadError(null);
    setSplitParts(null);
    setSplitting(false);
    setSplitProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [sourcePreview]);

  // ── Generazione video (percorso multi-parte, video oversize spezzato) ───
  // Un remix video-to-video per pezzo (stesso prompt/lingua per tutti, per
  // uno stile coerente lungo lo spot), poi un'unica chiamata a concat-videos
  // per ricomporli in un unico spot continuo — stessa route già usata dalla
  // Sequenza/Storyboard manuale più sotto in questa pagina. Si ferma al
  // primo pezzo che fallisce: i pezzi già remixati restano pagati e nel
  // bucket dell'utente, ma non c'è retry parziale automatico qui.
  const handleGenerateSplit = useCallback(async () => {
    if (!splitParts || splitParts.length === 0) return;

    setGenerating(true);
    setGenerationError(null);
    setResultVideoUrl(null);
    setResultDurationSeconds(null);
    setResultPersisted(false);
    setAddedToSequence(false);
    setGenerateProgress({ stage: 'remix', current: 0, total: splitParts.length });

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setGenerationError({ success: false, error: t('vision_error_session_expired') });
        return;
      }

      const remixedUrls: string[] = [];
      for (let i = 0; i < splitParts.length; i++) {
        setGenerateProgress({ stage: 'remix', current: i + 1, total: splitParts.length });

        const res = await fetch('/api/generate-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            sourceUrl: splitParts[i],
            prompt: prompt.trim(),
            mode: 'video-to-video',
            aspectRatio,
            targetLanguage,
          }),
        });

        const json = (await res.json().catch(() => ({
          success: false,
          error: t('vision_error_invalid_response'),
        }))) as GenerateVideoResponse;

        if (!res.ok || !json.success) {
          setGenerationError(
            json.success === false
              ? { ...json, error: `${t('vision_split_remix_progress').replace('{current}', String(i + 1)).replace('{total}', String(splitParts.length))} — ${json.error}` }
              : { success: false, error: t('vision_error_generation_failed') }
          );
          return;
        }

        remixedUrls.push(json.data.videoUrl);
        setCredits(json.data.creditsRemaining);
      }

      setGenerateProgress({ stage: 'merge', current: 0, total: 1 });

      const concatRes = await fetch('/api/concat-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ videoUrls: remixedUrls }),
      });

      const concatJson = (await concatRes.json().catch(() => ({
        success: false,
        error: t('vision_error_invalid_response'),
      }))) as ConcatVideosResponse;

      if (!concatRes.ok || !concatJson.success) {
        setGenerationError({ success: false, error: concatJson.success === false ? concatJson.error : t('vision_error_concat_failed') });
        return;
      }

      setResultVideoUrl(concatJson.data.videoUrl);
      // concat-videos non riporta la durata del risultato: il clip unito non
      // è aggiungibile a un'ULTERIORE sequenza (handleAddToSequence richiede
      // resultDurationSeconds), resta comunque guardabile/scaricabile qui.
      setResultDurationSeconds(null);
      setResultPersisted(true);
      setCredits(concatJson.data.creditsRemaining);
    } catch (err) {
      console.error('[Vision] split generate error:', err);
      setGenerationError({ success: false, error: t('vision_error_connection') });
    } finally {
      setGenerating(false);
      setGenerateProgress(null);
    }
  }, [splitParts, prompt, aspectRatio, targetLanguage, t]);

  // ── Generazione video ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (splitParts && splitParts.length > 0) {
      await handleGenerateSplit();
      return;
    }
    if (!uploadedSourceUrl) return;

    setGenerating(true);
    setGenerationError(null);
    setResultVideoUrl(null);
    setResultDurationSeconds(null);
    setResultPersisted(false);
    setAddedToSequence(false);
    setLoadingMessageIndex(0);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setGenerationError({ success: false, error: t('vision_error_session_expired') });
        return;
      }

      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceUrl: uploadedSourceUrl,
          prompt: prompt.trim(),
          mode,
          aspectRatio,
          targetLanguage,
          ...(mode === 'image-to-video' ? { duration } : {}),
        }),
      });

      const json = (await res.json().catch(() => ({
        success: false,
        error: t('vision_error_invalid_response'),
      }))) as GenerateVideoResponse;

      if (!res.ok || !json.success) {
        setGenerationError(json.success === false ? json : { success: false, error: t('vision_error_generation_failed') });
        return;
      }

      setResultVideoUrl(json.data.videoUrl);
      setResultDurationSeconds(json.data.durationSeconds);
      setResultPersisted(json.data.persisted);
      setCredits(json.data.creditsRemaining);
    } catch (err) {
      console.error('[Vision] generate error:', err);
      setGenerationError({ success: false, error: t('vision_error_connection') });
    } finally {
      setGenerating(false);
    }
  }, [splitParts, handleGenerateSplit, uploadedSourceUrl, prompt, mode, duration, aspectRatio, targetLanguage, t]);

  // ── Download diretto dell'MP4 (blob, funziona anche cross-origin) ──────
  const handleDownload = useCallback(async () => {
    if (!resultVideoUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(resultVideoUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `zeusx-vision-${mode}-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('[Vision] download error:', err);
    } finally {
      setDownloading(false);
    }
  }, [resultVideoUrl, mode]);

  const handleGenerateAnother = useCallback(() => {
    setResultVideoUrl(null);
    setResultDurationSeconds(null);
    setResultPersisted(false);
    setAddedToSequence(false);
    setGenerationError(null);
  }, []);

  // ── Sequenza / Storyboard ────────────────────────────────────────────────
  const handleAddToSequence = useCallback(() => {
    if (!resultVideoUrl || !resultPersisted || resultDurationSeconds === null) return;
    if (sequence.length >= MAX_SEQUENCE_CLIPS) return;
    setSequence((prev) => [
      ...prev,
      { id: crypto.randomUUID(), url: resultVideoUrl, mode, durationSeconds: resultDurationSeconds },
    ]);
    setAddedToSequence(true);
  }, [resultVideoUrl, resultPersisted, resultDurationSeconds, mode, sequence.length]);

  const handleRemoveFromSequence = useCallback((id: string) => {
    setSequence((prev) => prev.filter((clip) => clip.id !== id));
  }, []);

  const handleConcat = useCallback(async () => {
    if (sequence.length < 2) return;

    setConcatenating(true);
    setConcatError(null);
    setConcatVideoUrl(null);

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setConcatError(t('vision_error_session_expired'));
        return;
      }

      const res = await fetch('/api/concat-videos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ videoUrls: sequence.map((clip) => clip.url) }),
      });

      const json = (await res.json().catch(() => ({
        success: false,
        error: t('vision_error_invalid_response'),
      }))) as ConcatVideosResponse;

      if (!res.ok || !json.success) {
        setConcatError(json.success === false ? json.error : t('vision_error_concat_failed'));
        return;
      }

      setConcatVideoUrl(json.data.videoUrl);
      setCredits(json.data.creditsRemaining);
    } catch (err) {
      console.error('[Vision] concat error:', err);
      setConcatError(t('vision_error_connection'));
    } finally {
      setConcatenating(false);
    }
  }, [sequence, t]);

  const handleDownloadConcat = useCallback(async () => {
    if (!concatVideoUrl) return;
    setConcatDownloading(true);
    try {
      const res = await fetch(concatVideoUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `zeusx-vision-spot-completo-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('[Vision] concat download error:', err);
    } finally {
      setConcatDownloading(false);
    }
  }, [concatVideoUrl]);

  const handleNewSequence = useCallback(() => {
    setSequence([]);
    setConcatVideoUrl(null);
    setConcatError(null);
  }, []);

  return (
    // Nessun wrapper h-screen/header/glow proprio: sidebar, header (orologio
    // + selettore lingua) e lo scroll dell'area contenuto sono già forniti
    // da DashboardLayoutClient (vedi app/vision/layout.tsx), stesso criterio
    // di qualunque altra pagina /dashboard/*.
    <div className="mx-auto max-w-6xl text-white">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-fuchsia-600">
              <Clapperboard size={14} />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              <span className="text-white">Vision</span> <span className="text-blue-400">AI</span>
            </h1>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
            {modeConfig.subtitle}
          </p>
        </div>

        {/* Indicatore crediti in tempo reale */}
        <Link
          href="/pricing"
          className="group flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm transition-colors hover:border-indigo-500/40"
          title={t('vision_credits_link_title')}
        >
          <Zap size={14} className="text-amber-400" />
          <span className="font-bold tabular-nums">{credits === null ? '…' : credits}</span>
          <span className="text-slate-400">{t('vision_credits_label')}</span>
        </Link>
      </div>

      {/* ══════════════════ Selettore modalità ══════════════════ */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(Object.keys(modeConfigMap) as Mode[]).map((m) => {
          const config = modeConfigMap[m];
          const Icon = config.icon;
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                active
                  ? 'border-indigo-500 bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/10 shadow-sm shadow-indigo-500/20'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                active ? 'bg-gradient-to-br from-indigo-600 to-fuchsia-600' : 'bg-slate-800'
              }`}>
                <Icon size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{config.label}</span>
                  <span className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                    <Zap size={10} className="text-amber-400" />
                    {m === 'video-to-video' ? t('vision_mode_badge_10_credits') : t('vision_mode_badge_from_5_credits')}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {m === 'image-to-video' ? t('vision_mode_i2v_hint') : t('vision_mode_v2v_hint')}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        {/* ══════════════════ COLONNA SINISTRA: input ══════════════════ */}
        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          {/* Sezione 1: upload sorgente */}
          <section>
            <SectionLabel index={1} label={modeConfig.kind === 'video' ? t('vision_section_source_video') : t('vision_section_source_image')} />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => handleFileChosen(e.target.files?.[0])}
            />

            {!sourcePreview ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  handleFileChosen(e.dataTransfer.files?.[0]);
                }}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                  isDraggingOver
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-slate-700 hover:border-slate-600 hover:bg-slate-800/40'
                }`}
              >
                <modeConfig.icon size={28} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-300">{modeConfig.dropzoneLabel}</span>
                <span className="text-xs text-slate-500">{modeConfig.dropzoneHint}</span>
              </button>
            ) : (
              <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                {sourceKind === 'video' ? (
                  <video
                    src={sourcePreview}
                    controls
                    muted
                    loop
                    className="aspect-video w-full bg-black object-contain"
                    onError={() => setUploadError(t('vision_error_preview_video'))}
                  />
                ) : (
                  <img
                    src={sourcePreview}
                    alt={t('vision_preview_alt')}
                    className="aspect-video w-full object-cover"
                    onError={() => setUploadError(t('vision_error_preview_image'))}
                  />
                )}

                {(uploading || splitting) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 px-4 text-center text-sm font-medium backdrop-blur-sm">
                    <Loader2 size={16} className="animate-spin text-indigo-400" />
                    {uploading
                      ? t('vision_uploading_label')
                      : splitProgress?.stage === 'loading'
                        ? t('vision_split_loading_label')
                        : t('vision_split_progress_label')
                            .replace('{current}', String((splitProgress?.current ?? 0) + 1))
                            .replace('{total}', String(splitProgress?.total ?? 0))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRemoveSource}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/80 text-slate-300 transition-colors hover:bg-red-500/80 hover:text-white"
                  aria-label={t('vision_remove_file_aria')}
                >
                  <X size={14} />
                </button>

                {uploadedSourceUrl && !uploading && !splitting && (
                  <div className="absolute bottom-2 left-2 rounded-full bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {splitParts && splitParts.length > 0
                      ? t('vision_split_ready_badge').replace('{parts}', String(splitParts.length))
                      : t('vision_ready_badge')}
                  </div>
                )}
              </div>
            )}

            {uploadError && <ErrorInline message={uploadError} />}

            {splitParts && splitParts.length > 0 && !splitting && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300/90">
                {t('vision_split_info_note')
                  .replace('{parts}', String(splitParts.length))
                  .replace('{cost}', String(cost))}
              </p>
            )}
          </section>

          {/* Sezione 2: idea rapida + Prompt Enhancer AI */}
          <section>
            <SectionLabel index={2} label={modeConfig.promptLabel} />
            <p className="mb-2 text-xs text-slate-500">{modeConfig.promptExample}</p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(capWords(e.target.value.slice(0, MAX_PROMPT_LENGTH), MAX_PROMPT_WORDS))}
              placeholder={modeConfig.promptPlaceholder}
              rows={6}
              className="w-full resize-y rounded-xl border border-slate-700 bg-slate-800/60 p-3.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-[11px] text-slate-500">
                <Wand2 size={11} className="text-indigo-400" />
                {t('vision_prompt_optional_hint')}
              </p>
              <span className="flex-shrink-0 text-[11px] text-slate-500">
                {prompt.trim() ? prompt.trim().split(/\s+/).filter(Boolean).length : 0} / {MAX_PROMPT_WORDS} {t('vision_words_label')}
              </span>
            </div>
          </section>

          {/* Sezione 3: formato spot + lingua/mercato di destinazione */}
          <section className="space-y-4">
            <div>
              <SectionLabel index={3} label={t('vision_section_format_label')} />
              <div className="grid grid-cols-3 gap-3">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setAspectRatio(ratio.value)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-all ${
                      aspectRatio === ratio.value
                        ? 'border-indigo-500 bg-indigo-500/15 text-white shadow-sm shadow-indigo-500/20'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-800/40'
                    }`}
                  >
                    <span
                      className={`rounded-sm border-2 ${ASPECT_RATIO_ICON_CLASS[ratio.value]} ${
                        aspectRatio === ratio.value ? 'border-indigo-400' : 'border-slate-600'
                      }`}
                    />
                    <span className="text-sm font-bold">{ratio.label}</span>
                    <span className="text-center text-[10px] leading-tight text-slate-500">{ratio.hint}</span>
                  </button>
                ))}
              </div>
              {mode === 'video-to-video' && (
                <p className="mt-2 text-[11px] text-slate-500">
                  {t('vision_format_v2v_hint')}
                </p>
              )}
            </div>

            <div>
              <SectionLabel index={4} label={t('vision_section_language_label')} />
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value as TargetLanguage)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3.5 py-3 text-sm text-white outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value} className="bg-slate-900">
                    {lang.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {t('vision_language_hint')}
              </p>
            </div>
          </section>

          {/* Sezione 5: durata (solo image-to-video: il remix ha durata/costo fissi) */}
          {mode === 'image-to-video' && (
            <section>
              <SectionLabel index={5} label={t('vision_section_duration_label')} />
              <div className="grid grid-cols-2 gap-3">
                {(['5', '10'] as Duration[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-3 transition-all ${
                      duration === d
                        ? 'border-indigo-500 bg-indigo-500/15 text-white shadow-sm shadow-indigo-500/20'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="text-lg font-bold">{d} {t('vision_seconds_label')}</span>
                    <span className="flex items-center gap-1 text-xs text-slate-400">
                      <Zap size={11} className="text-amber-400" />
                      {getCreditCost('image-to-video', d)} {t('vision_credits_label')}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* CTA generazione */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:-translate-y-0.5 hover:shadow-indigo-600/30 disabled:pointer-events-none disabled:translate-y-0 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none"
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {generatingLabel}
              </>
            ) : !hasEnoughCredits ? (
              <>
                <CircleDollarSign size={16} />
                {t('vision_insufficient_credits').replace('{count}', String(cost))}
              </>
            ) : (
              <>
                <Wand2 size={16} />
                {mode === 'video-to-video' ? t('vision_cta_generate_remix') : t('vision_cta_generate_video')} · {cost} {t('vision_credits_label')}
              </>
            )}
          </button>

          {generationError && (
            <ErrorInline message={generationError.error}>
              {generationError.code === 'INSUFFICIENT_CREDITS' && (
                <Link href="/pricing" className="mt-1 inline-block font-semibold text-indigo-400 hover:underline">
                  {t('vision_recharge_credits_link')}
                </Link>
              )}
            </ErrorInline>
          )}
        </div>

        {/* ══════════════════ COLONNA DESTRA: output ══════════════════ */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 lg:sticky lg:top-6">
          <SectionLabel index={6} label={mode === 'video-to-video' ? t('vision_section_result_remix') : t('vision_section_result_spot')} />

          {resultVideoUrl ? (
            <div className="space-y-4">
              <video
                src={resultVideoUrl}
                autoPlay
                loop
                muted
                controls
                playsInline
                className="w-full rounded-xl border border-slate-800 bg-black"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-semibold transition-colors hover:bg-slate-800 disabled:opacity-60"
                >
                  {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {t('vision_download_mp4')}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateAnother}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800/60"
                >
                  <RefreshCw size={16} />
                  {t('vision_generate_another')}
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddToSequence}
                disabled={!resultPersisted || sequence.length >= MAX_SEQUENCE_CLIPS}
                title={!resultPersisted ? t('vision_clip_not_persisted_title') : undefined}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-500/40 bg-indigo-500/5 px-4 py-3 text-sm font-semibold text-indigo-300 transition-colors hover:border-indigo-500 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
              >
                {addedToSequence ? <Check size={16} /> : <Plus size={16} />}
                {addedToSequence ? t('vision_added_to_sequence') : t('vision_add_to_sequence')}
              </button>
            </div>
          ) : generating ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800/50">
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-fuchsia-600">
                  <Clapperboard size={22} />
                </div>
              </div>
              <p className="max-w-xs text-center text-sm font-medium text-slate-300">
                {generatingLabel}
              </p>
              <p className="text-xs text-slate-500">{t('vision_generating_hint')}</p>
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-800 text-center">
              <Clapperboard size={28} className="text-slate-700" />
              <p className="text-sm text-slate-500">
                {mode === 'video-to-video' ? t('vision_result_placeholder_remix') : t('vision_result_placeholder_spot')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════ Sequenza / Storyboard ══════════════════ */}
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-fuchsia-600">
              <Layers size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold">{t('vision_sequence_title')}</h2>
              <p className="text-xs text-slate-500">{t('vision_sequence_subtitle')}</p>
            </div>
          </div>
          {sequence.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-300">
              <Clapperboard size={12} className="text-indigo-400" />
              {t('vision_sequence_stats')
                .replace('{seconds}', String(sequenceTotalSeconds))
                .replace('{count}', String(sequence.length))
                .replace('{max}', String(MAX_SEQUENCE_CLIPS))}
            </span>
          )}
        </div>

        {sequence.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-800 py-10 text-center">
            <Layers size={24} className="text-slate-700" />
            <p className="max-w-sm text-sm text-slate-500">
              {t('vision_sequence_empty')}
            </p>
          </div>
        ) : (
          <>
            {/* Griglia orizzontale della sequenza */}
            <div className="flex gap-3 overflow-x-auto pb-2">
              {sequence.map((clip, index) => (
                <div
                  key={clip.id}
                  className="group relative w-40 flex-shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
                >
                  <span className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/80 text-[11px] font-bold text-slate-300">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFromSequence(clip.id)}
                    className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/80 text-slate-300 opacity-0 transition-opacity hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                    aria-label={t('vision_remove_clip_aria').replace('{index}', String(index + 1))}
                  >
                    <Trash2 size={12} />
                  </button>
                  <video
                    src={clip.url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="aspect-video w-full bg-black object-cover"
                  />
                  <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      {clip.mode === 'video-to-video' ? <Film size={10} /> : <ImageUp size={10} />}
                      {clip.mode === 'video-to-video' ? t('vision_clip_badge_remix') : t('vision_clip_badge_spot')}
                    </span>
                    <span className="font-semibold text-slate-300">{clip.durationSeconds}s</span>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA unione + risultato */}
            <div className="mt-5 border-t border-slate-800 pt-5">
              {concatVideoUrl ? (
                <div className="space-y-4">
                  <video
                    src={concatVideoUrl}
                    autoPlay
                    loop
                    muted
                    controls
                    playsInline
                    className="w-full max-w-xl rounded-xl border border-slate-800 bg-black"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleDownloadConcat}
                      disabled={concatDownloading}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-semibold transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      {concatDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      {t('vision_download_final')}
                    </button>
                    <button
                      type="button"
                      onClick={handleNewSequence}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800/60"
                    >
                      <RefreshCw size={16} />
                      {t('vision_new_sequence')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleConcat}
                    disabled={!canConcat}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:-translate-y-0.5 hover:shadow-indigo-600/30 disabled:pointer-events-none disabled:translate-y-0 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:shadow-none"
                  >
                    {concatenating ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t('vision_concat_in_progress')}
                      </>
                    ) : sequence.length < 2 ? (
                      <>
                        <Sparkles size={16} />
                        {t('vision_concat_need_more_clips')}
                      </>
                    ) : !hasEnoughCreditsForConcat ? (
                      <>
                        <CircleDollarSign size={16} />
                        {t('vision_insufficient_credits').replace('{count}', String(CONCAT_CREDIT_COST))}
                      </>
                    ) : (
                      <>
                        <Layers size={16} />
                        {t('vision_concat_cta')
                          .replace('{seconds}', String(sequenceTotalSeconds))
                          .replace('{cost}', String(CONCAT_CREDIT_COST))}
                      </>
                    )}
                  </button>
                  {concatError && <ErrorInline message={concatError} />}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Componenti di supporto
// ═══════════════════════════════════════════════════════════════════════════

function SectionLabel({ index, label }: { index: number; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-400">
        {index}
      </span>
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
    </div>
  );
}

function ErrorInline({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
      <div>
        {message}
        {children}
      </div>
    </div>
  );
}
