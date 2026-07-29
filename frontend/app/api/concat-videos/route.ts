// ─── Vision Studio: Concat Videos API Route (Next.js App Router) ──────────────
// Unisce in sequenza più clip generate in Vision Studio in un unico spot
// video continuo, usando FFmpeg in modalità "concat demuxer"
// (-f concat -safe 0 -c copy): stream copy, senza ricodifica, quindi rapido
// e senza perdita di qualità. Stesso schema di sicurezza crediti già usato
// in generate-video/route.ts: addebito atomico PRIMA di processare (RPC
// deduct_credits) e rimborso automatico se il download, FFmpeg o l'upload
// del risultato falliscono (RPC refund_credits) — "paracadute finanziario",
// l'utente non paga mai per un'unione non consegnata.
//
// Nota di sicurezza: le clip in input DEVONO provenire dal bucket
// 'vision-uploads/{user_id}/...' dell'utente autenticato (vedi validateBody
// sotto e persistGeneratedClip in generate-video/route.ts, che salva lì ogni
// clip generata). Questa route gira con service role (bypassa le RLS), quindi
// il controllo di ownership va fatto esplicitamente qui: senza, chiunque
// potrebbe far scaricare ed elaborare al nostro server qualunque URL esterno,
// anche di un altro utente.
//
// Nota su FFmpeg: niente ffmpeg di sistema in produzione (Vercel/serverless
// non lo garantisce) — si usa il binario bundlato da 'ffmpeg-static'. Il
// processo viene lanciato con child_process.execFile (argv array, non una
// stringa di shell): stesso risultato del comando richiesto in spec, ma
// senza esporre superficie a command injection.

import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { supabaseUrl, VisionConfigError, getServiceSupabase, getUserFromRequest } from '@/src/lib/vision-server';

const execFileAsync = promisify(execFile);

// Il download delle clip + FFmpeg (stream copy) sono rapidi, ma restiamo
// generosi come generate-video: su Vercel maxDuration > 60s richiede piano
// Pro o superiore, senza il quale la richiesta verrebbe comunque troncata a
// monte indipendentemente da questo valore.
export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

const MIN_CLIPS = 2;
const MAX_CLIPS = 12;
// Costo fisso indipendente dal numero di clip: copre il costo di calcolo
// dell'operazione (CPU per il download/FFmpeg) e scoraggia l'abuso
// dell'endpoint; le clip stesse sono già state pagate alla generazione.
const CONCAT_CREDIT_COST = 2;

class ConcatError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

// ─── Validazione input ──────────────────────────────────────────────────────

interface ConcatBody {
  videoUrls: string[];
}

function validateBody(body: unknown, userId: string): { data?: ConcatBody; error?: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Richiesta non valida.' };
  }
  const { videoUrls } = body as Record<string, unknown>;

  if (!Array.isArray(videoUrls) || videoUrls.length === 0 || videoUrls.some((u) => typeof u !== 'string')) {
    return { error: 'videoUrls deve essere un array non vuoto di URL.' };
  }
  if (videoUrls.length < MIN_CLIPS) {
    return { error: `Servono almeno ${MIN_CLIPS} clip per creare uno spot continuo.` };
  }
  if (videoUrls.length > MAX_CLIPS) {
    return { error: `Puoi unire al massimo ${MAX_CLIPS} clip per volta.` };
  }

  // Ogni clip deve provenire dalla cartella dell'utente autenticato nel
  // bucket 'vision-uploads' (stessa convenzione "{user_id}/..." delle policy
  // RLS su storage.objects, vedi supabase/migrations/20260802000000).
  const ownPrefix = `${supabaseUrl}/storage/v1/object/public/vision-uploads/${userId}/`;
  const urls = videoUrls as string[];
  const invalidUrl = urls.find((u) => !u.startsWith(ownPrefix));
  if (invalidUrl) {
    return { error: 'Una o più clip non appartengono al tuo spazio Vision: solo clip generate dal tuo account possono essere unite.' };
  }

  return { data: { videoUrls: urls } };
}

// ─── FFmpeg ─────────────────────────────────────────────────────────────────

async function downloadClip(url: string, destPath: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new ConcatError(`Download clip fallito: ${url}`, err);
  }
  if (!res.ok) {
    throw new ConcatError(`Download clip fallito (HTTP ${res.status}): ${url}`);
  }
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

async function runFfmpegConcat(listPath: string, outputPath: string, reencode: boolean): Promise<void> {
  if (!ffmpegPath) {
    throw new VisionConfigError('Binario ffmpeg non disponibile per questa piattaforma: impossibile unire i video.');
  }
  const args = reencode
    ? ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', outputPath]
    : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];

  try {
    await execFileAsync(ffmpegPath, args);
  } catch (err) {
    throw new ConcatError('FFmpeg ha fallito l\'unione dei video.', err);
  }
}

// ─── POST /api/concat-videos ─────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let supabase: ReturnType<typeof getServiceSupabase>;

  try {
    supabase = getServiceSupabase();
  } catch (err) {
    if (err instanceof VisionConfigError) {
      console.error('[concat-videos] config error:', err.message);
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
  const { data: input, error: validationError } = validateBody(body, user.id);
  if (!input) {
    return NextResponse.json(
      { success: false, error: validationError, code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  // ── 1. Addebito crediti ATOMICO, PRIMA di processare ────────────────────
  const { data: deductRows, error: deductError } = await supabase.rpc('deduct_credits', {
    p_user_id: user.id,
    p_amount: CONCAT_CREDIT_COST,
    p_type: 'generation',
    p_description: `Unione sequenza Vision (${input.videoUrls.length} clip)`,
    p_metadata: { clips: input.videoUrls.length, video_urls: input.videoUrls },
  });

  if (deductError) {
    console.error('[concat-videos] deduct_credits error:', deductError);
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
        error: `Crediti insufficienti: servono ${CONCAT_CREDIT_COST} crediti, ne hai ${profile?.credits ?? 0}.`,
        code: 'INSUFFICIENT_CREDITS',
        creditsRequired: CONCAT_CREDIT_COST,
        creditsAvailable: profile?.credits ?? 0,
      },
      { status: 402 }
    );
  }

  const { new_balance: balanceAfterDeduct, transaction_id: transactionId } = deductResult;

  // ── 2. Download clip, unione FFmpeg, upload risultato ───────────────────
  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'zeusx-concat-'));

    const clipPaths = input.videoUrls.map((_, i) => path.join(tmpDir as string, `clip_${i}.mp4`));
    await Promise.all(input.videoUrls.map((url, i) => downloadClip(url, clipPaths[i])));

    // Il concat demuxer richiede un file di lista con una riga "file '...'"
    // per clip e path assoluti. I nostri filename (clip_N.mp4) sono generati
    // da noi e non contengono apici o altri caratteri speciali: nessun
    // escaping aggiuntivo necessario.
    const listPath = path.join(tmpDir, 'list.txt');
    const listContent = clipPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await writeFile(listPath, listContent, 'utf-8');

    const outputPath = path.join(tmpDir, 'output.mp4');
    try {
      // Stream copy: veloce e senza perdita, ma richiede che tutte le clip
      // condividano codec/risoluzione/timebase — vero nel caso comune, dato
      // che tutte le clip Vision escono dagli stessi modelli Fal.ai a 720p.
      await runFfmpegConcat(listPath, outputPath, false);
    } catch (copyErr) {
      // Fallback: clip con parametri non perfettamente compatibili (es. mix
      // di modalità diverse) fanno fallire lo stream copy. Un retry con
      // ricodifica risolve la maggior parte dei casi, a costo di qualche
      // secondo extra.
      console.warn('[concat-videos] stream copy fallito, retry con ricodifica:', copyErr);
      await runFfmpegConcat(listPath, outputPath, true);
    }

    const outputBytes = await readFile(outputPath);
    const outputStoragePath = `${user.id}/generated/spot_completo_${Date.now()}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from('vision-uploads')
      .upload(outputStoragePath, outputBytes, { contentType: 'video/mp4', upsert: false });

    if (uploadError) {
      throw new ConcatError('Upload del video unito fallito.', uploadError);
    }

    const { data: publicUrlData } = supabase.storage.from('vision-uploads').getPublicUrl(outputStoragePath);

    // Arricchisce la transazione già registrata con l'esito reale
    // (best-effort, come in generate-video: se fallisce non blocca la
    // risposta, il credito è comunque corretto).
    const { error: updateTxError } = await supabase
      .from('credit_transactions')
      .update({ metadata: { clips: input.videoUrls.length, video_urls: input.videoUrls, video_url: publicUrlData.publicUrl } })
      .eq('id', transactionId);

    if (updateTxError) {
      console.error('[concat-videos] non-fatal: update transaction metadata failed:', updateTxError);
    }

    return NextResponse.json({
      success: true,
      data: {
        videoUrl: publicUrlData.publicUrl,
        clipsUsed: input.videoUrls.length,
        creditsUsed: CONCAT_CREDIT_COST,
        creditsRemaining: balanceAfterDeduct,
      },
    });
  } catch (err) {
    // ── 3. PARACADUTE FINANZIARIO: rimborso automatico ──────────────────
    console.error('[concat-videos] errore, rimborso crediti:', err);

    const { data: refundRows, error: refundError } = await supabase.rpc('refund_credits', {
      p_user_id: user.id,
      p_amount: CONCAT_CREDIT_COST,
      p_description: 'Rimborso automatico: unione sequenza fallita',
      p_reference_id: transactionId,
      p_metadata: { reason: err instanceof Error ? err.message : String(err) },
    });

    const refunded = !refundError && Boolean(refundRows?.[0]);
    if (refundError) {
      console.error('[concat-videos] CRITICAL: refund_credits failed after error. user:', user.id, 'transactionId:', transactionId, refundError);
    }

    return NextResponse.json(
      {
        success: false,
        error: refunded
          ? 'L\'unione dei video non è riuscita. I crediti sono stati rimborsati automaticamente: riprova.'
          : 'L\'unione dei video non è riuscita e il rimborso automatico non è andato a buon fine. Il nostro team è stato notificato: contatta il supporto citando questo riferimento.',
        code: 'CONCAT_ERROR',
        creditsRefunded: refunded,
        reference: transactionId,
      },
      { status: 502 }
    );
  } finally {
    // Pulizia file temporanei: sempre, sia su successo che su errore.
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch((cleanupErr) => {
        console.error('[concat-videos] non-fatal: cleanup tmp dir fallito:', cleanupErr);
      });
    }
  }
}
