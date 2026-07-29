// ─── Vision Studio: Generate Video API Route (Next.js App Router) ─────────────
// Generatore ibrido: accetta come sorgente SIA un'immagine (mode
// "image-to-video", foto -> spot animato) SIA un video esistente (mode
// "video-to-video", remix/restyle mantenendo il movimento originale) e
// instrada la chiamata al modello Fal.ai corretto per la modalità. Il costo
// in crediti viene scalato ATOMICAMENTE e PRIMA della chiamata a Fal.ai (RPC
// deduct_credits), per evitare che una richiesta abortita a metà o richieste
// concorrenti dello stesso utente permettano di generare più video di quelli
// pagati. Se Fal.ai fallisce dopo l'addebito, i crediti vengono rimborsati
// automaticamente (RPC refund_credits): è il "paracadute finanziario"
// richiesto, l'utente non paga mai per una generazione non consegnata.
//
// Nota sui modelli: lo slug fornito in spec per l'image-to-video
// ("fal-ai/wan-2-5/image-to-video") non esiste sul catalogo Fal.ai — lo slug
// reale è "fal-ai/wan-25-preview/image-to-video" (Wan 2.5). Per il remix
// video resto nella stessa famiglia Wan per coerenza di qualità/costo:
// "fal-ai/wan/v2.2-a14b/video-to-video" (verificato sulla documentazione
// ufficiale Fal.ai). Se Fal.ai promuove questi modelli fuori da "preview" o
// ne rilascia versioni successive, aggiornare solo FAL_MODELS qui sotto.
//
// Nota sui crediti: costi reali Fal.ai a risoluzione 720p (fonte:
// documentazione ufficiale dei due modelli) — image-to-video $0.10/s
// (5s≈$0.50, 10s≈$1.00), video-to-video $0.08/s (~5s di default≈$0.40). La
// scala 5/10/10 crediti richiesta è quindi già sopra costo per tutti i casi,
// con margine maggiore sul remix (operazione più pesante e più soggetta a
// fallimento, da qui il prezzo pari al piano da 10s invece che a metà).

import { NextRequest, NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';
import { callAiRouter, AiRouterError, AiRouterConfigError } from '@/src/lib/ai-router';
import { supabaseUrl, VisionConfigError, getServiceSupabase, getUserFromRequest } from '@/src/lib/vision-server';

// La generazione video può richiedere diversi minuti (coda + inferenza, il
// remix video-to-video in particolare): forza runtime Node (il client Fal.ai
// non gira su Edge) e alza il tetto di durata della funzione. Su Vercel,
// maxDuration > 60s richiede piano Pro o superiore: senza il piano adeguato
// la richiesta verrebbe comunque troncata a monte, indipendentemente da
// questo valore.
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type Mode = 'image-to-video' | 'video-to-video';
type Duration = '5' | '10';
type AspectRatio = '9:16' | '16:9' | '1:1';
type TargetLanguage = 'it' | 'en' | 'es' | 'fr' | 'de';

const ASPECT_RATIOS: readonly AspectRatio[] = ['9:16', '16:9', '1:1'];
const TARGET_LANGUAGES: readonly TargetLanguage[] = ['it', 'en', 'es', 'fr', 'de'];
const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16';
const DEFAULT_TARGET_LANGUAGE: TargetLanguage = 'it';

const LANGUAGE_NAMES: Record<TargetLanguage, string> = {
  it: 'Italian',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

const FAL_MODELS: Record<Mode, string> = {
  'image-to-video': 'fal-ai/wan-25-preview/image-to-video',
  'video-to-video': 'fal-ai/wan/v2.2-a14b/video-to-video',
};

// image-to-video: costo proporzionale alla durata scelta (i costi reali Fal
// raddoppiano da 5s a 10s, vedi nota in testa al file). video-to-video: costo
// fisso, nessuna durata selezionabile dall'utente (il remix mantiene la
// lunghezza/i default del modello).
function getCreditCost(mode: Mode, duration: Duration | null): number {
  if (mode === 'video-to-video') return 10;
  return duration === '10' ? 10 : 5;
}

const MAX_PROMPT_LENGTH = 1500;

// ─── Prompt Enhancer ────────────────────────────────────────────────────────
// L'utente scrive solo un'idea breve in italiano (max 20-30 parole, vedi
// vision/page.tsx): qui viene tradotta ed espansa in un prompt professionale
// in inglese, con dettagli cinematografici (illuminazione, risoluzione,
// movimento di camera) prima di essere passata a Fal.ai. Non deve mai lanciare
// un'eccezione: se l'AI router non è configurato o fallisce, si ripiega su
// un'espansione locale a template piuttosto che bloccare la generazione o
// far scattare inutilmente il rimborso pensato per gli errori di Fal.ai.

// Prompt di default per modalità + lingua di destinazione: nessuna chiamata
// LLM quando l'utente lascia il campo vuoto (vedi enhancePrompt), quindi
// vanno scritti a mano per ciascuna lingua invece di tradotti al volo.
const DEFAULT_ENHANCED_PROMPT: Record<Mode, Record<TargetLanguage, string>> = {
  'image-to-video': {
    en: 'A beautifully lit subject with a slow, smooth cinematic camera push-in, subtle parallax and natural depth of field, photorealistic 4k detail, studio-quality lighting, professional color grading, fluid and organic motion.',
    it: 'Un soggetto splendidamente illuminato con una lenta e fluida zoomata cinematografica in avvicinamento, leggero effetto parallasse e profondità di campo naturale, dettaglio fotorealistico in 4k, illuminazione da studio, color grading professionale, movimento fluido e organico.',
    es: 'Un sujeto bellamente iluminado con un lento y fluido acercamiento de cámara cinematográfico, sutil efecto de paralaje y profundidad de campo natural, detalle fotorrealista en 4k, iluminación de estudio, gradación de color profesional, movimiento fluido y orgánico.',
    fr: 'Un sujet magnifiquement éclairé avec un lent travelling avant cinématographique et fluide, léger effet de parallaxe et profondeur de champ naturelle, détail photoréaliste en 4k, éclairage de studio, étalonnage colorimétrique professionnel, mouvement fluide et organique.',
    de: 'Ein wunderschön beleuchtetes Motiv mit einem langsamen, fließenden kinematografischen Kamera-Zoom, dezentem Parallaxeneffekt und natürlicher Tiefenschärfe, fotorealistischem 4K-Detail, Studiobeleuchtung, professionellem Color Grading und fließender, organischer Bewegung.',
  },
  'video-to-video': {
    en: 'A cinematic restyle that preserves the original motion and choreography exactly, coherent and consistent art style throughout, studio-quality lighting, photorealistic 4k detail, smooth fluid camera movement, professional color grading.',
    it: 'Un restyling cinematografico che preserva esattamente il movimento e la coreografia originali, uno stile artistico coerente e costante dall\'inizio alla fine, illuminazione da studio, dettaglio fotorealistico in 4k, movimento di camera fluido, color grading professionale.',
    es: 'Un reestilizado cinematográfico que preserva exactamente el movimiento y la coreografía originales, un estilo artístico coherente y constante en todo momento, iluminación de estudio, detalle fotorrealista en 4k, movimiento de cámara fluido, gradación de color profesional.',
    fr: 'Une restylisation cinématographique qui préserve exactement le mouvement et la chorégraphie d\'origine, un style artistique cohérent et constant du début à la fin, éclairage de studio, détail photoréaliste en 4k, mouvement de caméra fluide, étalonnage colorimétrique professionnel.',
    de: 'Ein filmisches Restyling, das die ursprüngliche Bewegung und Choreografie exakt beibehält, mit durchgehend kohärentem und konsistentem Kunststil, Studiobeleuchtung, fotorealistischem 4K-Detail, fließender Kamerabewegung und professionellem Color Grading.',
  },
};

// L'istruzione al modello resta in inglese (più affidabile per i modelli
// generalisti), ma richiede esplicitamente l'output nella lingua target,
// "adattato" al mercato invece che tradotto parola per parola.
function buildEnhancerSystemPrompt(mode: Mode, targetLanguage: TargetLanguage): string {
  const languageName = LANGUAGE_NAMES[targetLanguage];
  const base =
    mode === 'image-to-video'
      ? 'You are a prompt engineer for an AI image-to-video generation model. The user gives you a short idea describing a scene or animation for a still photo. Rewrite it as a single professional prompt optimized for cinematic video generation: describe a smooth, fitting camera movement, studio-quality lighting, photorealistic 4k detail (or a coherent cartoon/anime style if the idea implies one), and natural, fluid motion.'
      : 'You are a prompt engineer for an AI video restyling model. The user gives you a short idea describing the new visual style to apply to an existing video (the original motion must stay untouched). Rewrite it as a single professional prompt optimized for video restyling: describe the target art style coherently and consistently, studio-quality lighting, photorealistic 4k detail (or a coherent cartoon/anime look if implied), and explicitly preserve the original camera movement and motion.';

  return `${base} Write the final prompt in ${languageName}, naturally adapted for a ${languageName}-speaking audience/market (not a literal word-for-word translation) — imagery, tone and cultural references should feel native to that market. Reply with ONLY the rewritten prompt as plain text in ${languageName}, under 80 words, no quotes, labels, or explanation.`;
}

// Fallback offline (AI router non disponibile): non può tradurre il testo
// dell'utente senza un LLM, quindi si limita ad aggiungere i descrittori
// cinematografici in inglese al testo originale così com'è digitato — una
// localizzazione parziale accettabile per un percorso di degrado, non per il
// caso comune (gestito sopra da buildEnhancerSystemPrompt via AI router).
function templateEnhance(rawPrompt: string, mode: Mode): string {
  const cinematicSuffix = mode === 'image-to-video'
    ? 'smooth cinematic camera movement, studio-quality lighting, photorealistic 4k detail, shallow depth of field, professional color grading'
    : 'original motion and choreography preserved exactly, coherent consistent art style, studio-quality lighting, photorealistic 4k detail, professional color grading';
  return `${rawPrompt}, ${cinematicSuffix}`;
}

async function enhancePrompt(rawPrompt: string, mode: Mode, targetLanguage: TargetLanguage): Promise<string> {
  const trimmed = rawPrompt.trim();
  if (!trimmed) return DEFAULT_ENHANCED_PROMPT[mode][targetLanguage];

  try {
    const result = await callAiRouter({
      task: 'text-edit',
      messages: [
        { role: 'system', content: buildEnhancerSystemPrompt(mode, targetLanguage) },
        { role: 'user', content: trimmed },
      ],
      maxTokens: 220,
      temperature: 0.7,
    });
    const enhanced = result.content.trim().replace(/^["']|["']$/g, '');
    return enhanced || templateEnhance(trimmed, mode);
  } catch (err) {
    if (err instanceof AiRouterConfigError || err instanceof AiRouterError) {
      console.warn('[generate-video] enhancePrompt: AI router non disponibile, uso fallback a template:', err.message);
    } else {
      console.error('[generate-video] enhancePrompt: errore inatteso, uso fallback a template:', err);
    }
    return templateEnhance(trimmed, mode);
  }
}

// ─── Errori tipizzati ───────────────────────────────────────────────────────
// Distinguere config/auth/crediti/provider permette alla route di scegliere
// lo status HTTP e il messaggio giusti invece di collassare tutto su 500.
// VisionConfigError è condivisa da src/lib/vision-server.ts.

class FalGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

// ─── Fal.ai client config ──────────────────────────────────────────────────
// @fal-ai/client legge FAL_KEY dall'ambiente automaticamente, ma lo
// configuriamo esplicitamente per fallire subito con un errore leggibile
// invece di un 401 opaco da Fal.ai a metà generazione.
function ensureFalConfigured() {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new VisionConfigError('FAL_KEY non configurata: impossibile generare video.');
  }
  fal.config({ credentials: key });
}

// ─── Persistenza clip generata su Supabase Storage ─────────────────────────
// Fal.ai restituisce un URL sul proprio CDN, valido ma non garantito a vita
// (e non riconducibile a un utente). Lo ri-carichiamo nel bucket
// 'vision-uploads/{user_id}/generated/...' per due motivi: (1) rende l'URL
// stabile a lungo termine, (2) è il prerequisito di sicurezza per
// app/api/concat-videos/route.ts, che accetta in input solo clip del bucket
// che appartengono alla cartella dell'utente autenticato (stessa convenzione
// di ownership già usata dalle policy RLS su storage.objects) — accettare
// direttamente URL Fal.ai lì permetterebbe a chiunque di far concatenare al
// nostro server qualunque file esterno, senza alcuna verifica di possesso.
// Best-effort: se il re-upload fallisce, la generazione resta comunque
// valida (l'utente ha già pagato e ottiene il video), semplicemente quella
// clip non potrà essere aggiunta alla Sequenza/Storyboard.
async function persistGeneratedClip(
  supabase: ReturnType<typeof getServiceSupabase>,
  falVideoUrl: string,
  userId: string,
  mode: Mode
): Promise<string | null> {
  try {
    const res = await fetch(falVideoUrl);
    if (!res.ok) {
      throw new Error(`download da Fal.ai fallito: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const path = `${userId}/generated/${Date.now()}-${mode}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from('vision-uploads')
      .upload(path, bytes, { contentType: 'video/mp4', upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('vision-uploads').getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error('[generate-video] persistGeneratedClip: fallback a URL Fal.ai transitorio:', err);
    return null;
  }
}

// ─── Validazione input ──────────────────────────────────────────────────────

interface GenerateVideoBody {
  sourceUrl: string;
  prompt: string;
  mode: Mode;
  duration: Duration | null;
  aspectRatio: AspectRatio;
  targetLanguage: TargetLanguage;
}

// Forma dell'output condivisa da entrambi i modelli Wan usati (documentazione
// ufficiale Fal.ai): "video" + "seed" sono comuni a image-to-video e
// video-to-video, "actual_prompt" esiste solo sul primo. Il pacchetto
// @fal-ai/client non fornisce tipi per-modello, quindi la dichiariamo qui
// invece di propagare `any` nel resto della route.
interface WanVideoOutput {
  video: {
    url: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
    num_frames?: number;
  };
  seed: number;
  actual_prompt?: string;
  prompt?: string;
}

function validateBody(body: unknown): { data?: GenerateVideoBody; error?: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Richiesta non valida.' };
  }
  const { sourceUrl, prompt, mode, duration, aspectRatio: aspectRatioRaw, targetLanguage: targetLanguageRaw } =
    body as Record<string, unknown>;

  if (mode !== 'image-to-video' && mode !== 'video-to-video') {
    return { error: 'mode deve essere "image-to-video" o "video-to-video".' };
  }

  // aspectRatio/targetLanguage sono opzionali: se omessi si applicano i
  // default di prodotto (9:16, italiano). Se presenti, però, devono essere
  // uno dei valori ammessi — niente coercizione silenziosa di input malformato.
  let aspectRatio: AspectRatio = DEFAULT_ASPECT_RATIO;
  if (aspectRatioRaw !== undefined) {
    if (typeof aspectRatioRaw !== 'string' || !ASPECT_RATIOS.includes(aspectRatioRaw as AspectRatio)) {
      return { error: `aspectRatio deve essere uno tra: ${ASPECT_RATIOS.join(', ')}.` };
    }
    aspectRatio = aspectRatioRaw as AspectRatio;
  }

  let targetLanguage: TargetLanguage = DEFAULT_TARGET_LANGUAGE;
  if (targetLanguageRaw !== undefined) {
    if (typeof targetLanguageRaw !== 'string' || !TARGET_LANGUAGES.includes(targetLanguageRaw as TargetLanguage)) {
      return { error: `targetLanguage deve essere uno tra: ${TARGET_LANGUAGES.join(', ')}.` };
    }
    targetLanguage = targetLanguageRaw as TargetLanguage;
  }

  if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
    return { error: 'sourceUrl mancante o non valido: serve un URL pubblico http/https.' };
  }
  // Difesa aggiuntiva: il file sorgente (immagine o video) deve provenire dal
  // nostro bucket Supabase ('vision-uploads'), non da un URL arbitrario
  // passato dal client — evita che la route diventi un proxy gratuito verso
  // qualunque file esterno.
  if (!sourceUrl.startsWith(supabaseUrl)) {
    return { error: 'sourceUrl deve puntare a un file caricato su Supabase Storage (bucket vision-uploads).' };
  }

  // Il prompt è opzionale: se l'utente lo lascia vuoto, enhancePrompt applica
  // un prompt di default ottimizzato (vedi sotto), invece di bloccare qui la
  // richiesta.
  if (typeof prompt !== 'string') {
    return { error: 'Il prompt deve essere una stringa.' };
  }
  if (prompt.trim().length > MAX_PROMPT_LENGTH) {
    return { error: `Il prompt non può superare ${MAX_PROMPT_LENGTH} caratteri.` };
  }

  // duration è rilevante solo per image-to-video: video-to-video ha un costo
  // e una durata fissi (vedi getCreditCost), quindi qui è ignorata anche se
  // il client la invia.
  if (mode === 'image-to-video') {
    if (duration !== '5' && duration !== '10') {
      return { error: 'duration deve essere "5" o "10" per la modalità image-to-video.' };
    }
    return { data: { sourceUrl, prompt: prompt.trim(), mode, duration, aspectRatio, targetLanguage } };
  }

  return { data: { sourceUrl, prompt: prompt.trim(), mode, duration: null, aspectRatio, targetLanguage } };
}

// ─── POST /api/generate-video ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let supabase: ReturnType<typeof getServiceSupabase>;

  try {
    supabase = getServiceSupabase();
    ensureFalConfigured();
  } catch (err) {
    if (err instanceof VisionConfigError) {
      console.error('[generate-video] config error:', err.message);
      return NextResponse.json(
        { success: false, error: 'Servizio Vision non configurato correttamente. Contatta il supporto.', code: 'CONFIG_ERROR' },
        { status: 500 }
      );
    }
    throw err;
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Autenticazione richiesta.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  // ── Validazione input ────────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  const { data: input, error: validationError } = validateBody(body);
  if (!input) {
    return NextResponse.json(
      { success: false, error: validationError, code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  const cost = getCreditCost(input.mode, input.duration);
  const falModelId = FAL_MODELS[input.mode];
  const durationLabel = input.mode === 'image-to-video' ? `${input.duration}s` : 'remix';

  // ── 1. Addebito crediti ATOMICO, PRIMA di chiamare Fal.ai ──────────────
  const { data: deductRows, error: deductError } = await supabase.rpc('deduct_credits', {
    p_user_id: user.id,
    p_amount: cost,
    p_type: 'generation',
    p_description: `Generazione video Vision (${input.mode}, ${durationLabel})`,
    p_metadata: {
      mode: input.mode,
      duration: input.duration,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      target_language: input.targetLanguage,
    },
  });

  if (deductError) {
    console.error('[generate-video] deduct_credits error:', deductError);
    return NextResponse.json(
      { success: false, error: 'Errore durante il controllo dei crediti. Riprova.', code: 'CREDITS_CHECK_ERROR' },
      { status: 500 }
    );
  }

  const deductResult = deductRows?.[0];
  if (!deductResult) {
    // Nessuna riga restituita dalla RPC = saldo insufficiente (nessun addebito avvenuto).
    const { data: profile } = await supabase
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    return NextResponse.json(
      {
        success: false,
        error: `Crediti insufficienti: servono ${cost} crediti, ne hai ${profile?.credits ?? 0}.`,
        code: 'INSUFFICIENT_CREDITS',
        creditsRequired: cost,
        creditsAvailable: profile?.credits ?? 0,
      },
      { status: 402 }
    );
  }

  const { new_balance: balanceAfterDeduct, transaction_id: transactionId } = deductResult;

  // ── 2. Chiamata Fal.ai (modello dipendente dalla modalità) ──────────────
  try {
    // Espande l'idea grezza dell'utente in un prompt professionale, scritto e
    // contestualizzato nella lingua/mercato scelti, prima di passarlo a
    // Fal.ai (vedi enhancePrompt sopra).
    const enhancedPrompt = await enhancePrompt(input.prompt, input.mode, input.targetLanguage);

    const falInput =
      input.mode === 'image-to-video'
        ? {
            prompt: enhancedPrompt,
            image_url: input.sourceUrl,
            duration: input.duration,
            resolution: '720p' as const,
            // Formato dello spot generato da zero: qui ha senso, a differenza
            // del remix video-to-video sotto (che eredita le proporzioni del
            // video sorgente e non espone un parametro di aspect ratio).
            aspect_ratio: input.aspectRatio,
          }
        : {
            prompt: enhancedPrompt,
            video_url: input.sourceUrl,
            resolution: '720p' as const,
          };

    const result = await fal.subscribe(falModelId, {
      input: falInput,
      logs: false,
    });

    const output = result.data as WanVideoOutput;
    const videoUrl = output?.video?.url;
    const falRequestId = result.requestId as string | undefined;

    if (!videoUrl) {
      throw new FalGenerationError('Fal.ai ha risposto senza un video valido.');
    }

    // Durata reale della clip, per la Sequenza/Storyboard lato frontend
    // (somma delle durate = durata totale dello spot unito). Fal.ai la
    // riporta in output.video.duration; se assente (video-to-video non
    // sempre la espone) si ricade sulla durata richiesta per image-to-video,
    // o su 5s per video-to-video — coerente con la nota in testa al file
    // sul default del modello di remix ("~5s di default").
    const clipDurationSeconds = output?.video?.duration
      ?? (input.mode === 'image-to-video' ? Number(input.duration) : 5);

    // Ri-carica la clip nel nostro bucket (best-effort, vedi commento su
    // persistGeneratedClip). Se fallisce, si ripiega sull'URL Fal.ai
    // transitorio e la clip risulta non aggiungibile alla Sequenza.
    const persistedUrl = await persistGeneratedClip(supabase, videoUrl, user.id, input.mode);
    const finalVideoUrl = persistedUrl ?? videoUrl;

    // Arricchisce la transazione già registrata con l'esito reale (best-effort:
    // se questa update fallisce non blocca la risposta, il credito è comunque
    // corretto e la transazione resta comunque tracciata come "generation").
    const { error: updateTxError } = await supabase
      .from('credit_transactions')
      .update({
        reference_id: falRequestId ?? null,
        metadata: {
          mode: input.mode,
          duration: input.duration,
          prompt: input.prompt,
          enhanced_prompt: enhancedPrompt,
          aspect_ratio: input.aspectRatio,
          target_language: input.targetLanguage,
          video_url: finalVideoUrl,
          fal_video_url: videoUrl,
        },
      })
      .eq('id', transactionId);

    if (updateTxError) {
      console.error('[generate-video] non-fatal: update transaction metadata failed:', updateTxError);
    }

    return NextResponse.json({
      success: true,
      data: {
        videoUrl: finalVideoUrl,
        requestId: falRequestId,
        mode: input.mode,
        durationSeconds: clipDurationSeconds,
        aspectRatio: input.aspectRatio,
        targetLanguage: input.targetLanguage,
        creditsUsed: cost,
        creditsRemaining: balanceAfterDeduct,
        // false quando il re-upload su Supabase Storage è fallito: in quel
        // caso videoUrl è l'URL transitorio di Fal.ai e il frontend non deve
        // proporre "Aggiungi alla Sequenza" per questa clip (concat-videos
        // accetta solo clip del nostro bucket, vedi persistGeneratedClip).
        persisted: persistedUrl !== null,
      },
    });
  } catch (falErr) {
    // ── 3. PARACADUTE FINANZIARIO: rimborso automatico ──────────────────
    console.error('[generate-video] Fal.ai error, refunding credits:', falErr);

    const { data: refundRows, error: refundError } = await supabase.rpc('refund_credits', {
      p_user_id: user.id,
      p_amount: cost,
      p_description: 'Rimborso automatico: generazione video fallita',
      p_reference_id: transactionId,
      p_metadata: { mode: input.mode, reason: falErr instanceof Error ? falErr.message : String(falErr) },
    });

    const refunded = !refundError && Boolean(refundRows?.[0]);
    if (refundError) {
      // Fallimento del rimborso: incidente da monitorare manualmente, il saldo
      // dell'utente è temporaneamente scorretto. Log esplicito per l'allarme.
      console.error('[generate-video] CRITICAL: refund_credits failed after Fal.ai error. user:', user.id, 'transactionId:', transactionId, refundError);
    }

    return NextResponse.json(
      {
        success: false,
        error: refunded
          ? 'La generazione del video non è riuscita. I crediti sono stati rimborsati automaticamente: riprova.'
          : 'La generazione del video non è riuscita e il rimborso automatico non è andato a buon fine. Il nostro team è stato notificato: contatta il supporto citando questo riferimento.',
        code: 'FAL_GENERATION_ERROR',
        creditsRefunded: refunded,
        reference: transactionId,
      },
      { status: 502 }
    );
  }
}
