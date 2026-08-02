// ─── Vision Studio: split lato client di video sorgente oversize ──────────
// Il bucket Supabase 'vision-uploads' ha un limite fisico di 100MB per file
// (vedi supabase/migrations/20260802000002_vision_uploads_allow_video.sql):
// un video sopra quella soglia non può essere caricato affatto, quindi lo
// split deve avvenire PRIMA dell'upload, nel browser — non esiste un modo
// per farlo lato server senza prima ricevere il file intero, che è
// esattamente ciò che il limite del bucket impedisce.
//
// Usa @ffmpeg/ffmpeg (WebAssembly, variante single-thread: nessun requisito
// di header COOP/COEP a livello di sito, a differenza della variante
// multi-thread). Il core WASM (~30MB) NON è bundlato nell'app: viene
// scaricato da CDN al volo solo quando un utente carica davvero un video
// sopra soglia, così non pesa sul bundle né sul caricamento delle altre pagine.
//
// Taglio veloce via stream copy (-c copy, "-ss" prima di "-i"): nessuna
// ricodifica, quindi rapido anche per file grossi e sostenibile per un
// runtime WASM nel browser. Il taglio si allinea al keyframe più vicino
// (non frame-perfect), accettabile qui: i pezzi servono da input al remix
// AI, non a un montaggio di precisione.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FFMPEG_CORE_VERSION = '0.12.10';
const FFMPEG_CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

// Stesso tetto di app/api/concat-videos/route.ts (MAX_CLIPS): i pezzi
// remixati vengono uniti da quella route, che non ne accetta più di 12.
export const SPLIT_MAX_PARTS = 12;
// Limite realmente applicato dagli upload verso 'vision-uploads': non il
// file_size_limit del bucket (100MB, vedi migrazione dedicata), ma il tetto
// GLOBALE di progetto di Supabase Storage — un'impostazione a livello di
// piano, cambiabile solo dalla Dashboard (Settings → Storage), che qui è
// più restrittivo del bucket e quindi vince. Va tenuto allineato a
// MAX_VIDEO_SIZE_MB/SPLIT_TARGET_CHUNK_MB in app/vision/page.tsx.
export const SPLIT_HARD_LIMIT_MB = 50;

export class VideoSplitError extends Error {}

function getVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new VideoSplitError('Impossibile leggere la durata del video.'));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new VideoSplitError('File video non leggibile o formato non supportato dal browser.'));
    };
    video.src = url;
  });
}

// Istanza riusata tra chiamate successive nella stessa sessione di pagina:
// il caricamento del core WASM (~30MB da CDN) è il passo più lento, non ha
// senso ripeterlo se l'utente spezza più di un video nella stessa visita.
let ffmpegInstance: FFmpeg | null = null;
async function loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface SplitProgress {
  stage: 'loading' | 'splitting';
  current: number;
  total: number;
}

/**
 * Spezza `file` in un numero di segmenti proporzionato alla sua dimensione
 * (min 2, max SPLIT_MAX_PARTS), tagliati per tempo. Lancia VideoSplitError
 * se anche dopo lo split ogni pezzo supererebbe comunque il limite fisico
 * del bucket (video troppo grande in assoluto per questo percorso).
 */
export async function splitVideoBySize(
  file: File,
  targetChunkMB: number,
  onProgress?: (progress: SplitProgress) => void
): Promise<Blob[]> {
  const targetBytes = targetChunkMB * 1024 * 1024;
  const numParts = Math.min(SPLIT_MAX_PARTS, Math.max(2, Math.ceil(file.size / targetBytes)));

  const estimatedBytesPerPart = file.size / numParts;
  if (estimatedBytesPerPart > SPLIT_HARD_LIMIT_MB * 1024 * 1024) {
    throw new VideoSplitError(
      `Il video è troppo grande anche dopo la suddivisione in ${SPLIT_MAX_PARTS} parti: prova con un file più piccolo o compresso.`
    );
  }

  onProgress?.({ stage: 'loading', current: 0, total: numParts });
  const [ffmpeg, duration] = await Promise.all([loadFfmpeg(), getVideoDurationSeconds(file)]);
  const segmentSeconds = duration / numParts;

  const inputName = 'input.mp4';
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const chunks: Blob[] = [];
  try {
    for (let i = 0; i < numParts; i++) {
      onProgress?.({ stage: 'splitting', current: i, total: numParts });
      const outputName = `part_${i}.mp4`;
      // L'ultimo segmento non riceve "-t": arriva fino a fine file, evitando
      // di perdere l'ultima frazione di secondo per arrotondamento.
      const args = [
        '-ss', String(i * segmentSeconds),
        '-i', inputName,
        ...(i < numParts - 1 ? ['-t', String(segmentSeconds)] : []),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outputName,
      ];
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      // Copia in un Uint8Array backed da un ArrayBuffer "normale": il tipo
      // restituito da readFile è generico su ArrayBufferLike (include
      // SharedArrayBuffer), che il costruttore di Blob non accetta.
      chunks.push(new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' }));
      await ffmpeg.deleteFile(outputName);
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
  }

  onProgress?.({ stage: 'splitting', current: numParts, total: numParts });
  return chunks;
}
