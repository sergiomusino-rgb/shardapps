'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Mic, Square, X } from 'lucide-react';
import { extractVoiceOrderAction } from '@/app/actions/comandi-voice';
import type { VoiceOrderExtraction } from '@/types/comandi';
import { useLanguage } from '@/src/lib/LanguageContext';

// Stesso pattern di dichiarazione usato in dashboard/creator/page.tsx e
// dashboard/generator/page.tsx: Web Speech API non è ancora in TS lib.dom.
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const WAVEFORM_BARS = 24;
const SPEECH_LANG_BY_LOCALE: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
};

export interface VoiceInputWidgetProps {
  /** Riceve il JSON strutturato validato restituito dalla Server Action. */
  onOrderParsed: (data: VoiceOrderExtraction) => void;
  /**
   * Riceve anche il blob audio grezzo registrato via MediaRecorder, per usi
   * futuri (upload/allegato) indipendenti dalla trascrizione locale già
   * usata per invocare extractVoiceOrderAction.
   */
  onAudioRecorded?: (blob: Blob) => void;
  /** Notifica errori di registrazione/permessi/parsing anche al chiamante (es. toast globale). */
  onError?: (message: string) => void;
  className?: string;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function VoiceInputWidget({
  onOrderParsed,
  onAudioRecorded,
  onError,
  className = '',
}: VoiceInputWidgetProps) {
  const { locale, t } = useLanguage();

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  // Refs di stato "live" per evitare closure stantie dentro i callback
  // asincroni della Web Speech API (onresult/onend possono arrivare dopo
  // che il componente ha già re-renderizzato più volte).
  const isRecordingRef = useRef(false);
  const manualStopRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasMediaDevices = !!navigator.mediaDevices?.getUserMedia;
    setIsSupported(!!SpeechRecognitionCtor && hasMediaDevices && typeof MediaRecorder !== 'undefined');
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    barRefs.current.forEach((bar) => {
      if (bar) bar.style.height = '15%';
    });
  }, []);

  const runWaveformLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const step = Math.max(1, Math.floor(data.length / WAVEFORM_BARS));
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const value = data[i * step] || 0;
      const heightPct = Math.max(15, Math.min(100, (value / 255) * 100));
      const bar = barRefs.current[i];
      if (bar) bar.style.height = `${heightPct}%`;
    }

    animationFrameRef.current = requestAnimationFrame(runWaveformLoop);
  }, []);

  const cleanupRecordingResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopAudioAnalysis();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, [stopAudioAnalysis]);

  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError]
  );

  const submitTranscript = useCallback(
    async (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) {
        reportError(t('comandi_voice_no_speech'));
        return;
      }

      setIsProcessing(true);
      setError(null);
      try {
        const result = await extractVoiceOrderAction({ audioTranscript: trimmed });
        if (!result.success || !result.data) {
          reportError(result.error || t('comandi_voice_error_ai_processing'));
          return;
        }
        onOrderParsed(result.data);
      } catch (err) {
        console.error('[VoiceInputWidget] Errore invocazione extractVoiceOrderAction:', err);
        reportError(t('comandi_voice_error_server_communication'));
      } finally {
        setIsProcessing(false);
      }
    },
    [onOrderParsed, reportError, t]
  );

  // Chiamata quando la Web Speech API ha davvero terminato (dopo uno stop
  // manuale): a questo punto tutti i risultati "isFinal" pendenti sono già
  // stati consegnati da onresult, quindi il transcript nei ref è completo.
  const finalizeRecording = useCallback(() => {
    cleanupRecordingResources();
    recognitionRef.current = null;
    const transcript = `${finalTranscriptRef.current} ${interimTranscriptRef.current}`.trim();
    void submitTranscript(transcript);
  }, [cleanupRecordingResources, submitTranscript]);

  // Cleanup se il componente viene smontato mentre si sta registrando
  useEffect(() => {
    return () => {
      manualStopRef.current = false;
      isRecordingRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const startRecording = useCallback(async () => {
    setError(null);
    setInterimTranscript('');
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    audioChunksRef.current = [];

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      reportError(t('comandi_voice_error_unsupported_browser'));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[VoiceInputWidget] getUserMedia error:', err);
      reportError(t('comandi_voice_error_mic_denied'));
      return;
    }
    streamRef.current = stream;

    // Registrazione audio nativa (MediaRecorder) — il blob viene esposto via
    // onAudioRecorded per usi futuri, indipendentemente dalla trascrizione
    // locale usata per l'estrazione AI.
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
          onAudioRecorded?.(blob);
        }
      };
      mediaRecorder.start();
    } catch (err) {
      console.error('[VoiceInputWidget] MediaRecorder error:', err);
      // Non bloccante: la trascrizione vocale funziona comunque senza registrazione del blob
    }

    // Analisi audio in tempo reale per l'onda sonora visiva
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      animationFrameRef.current = requestAnimationFrame(runWaveformLoop);
    } catch (err) {
      console.error('[VoiceInputWidget] AudioContext error:', err);
    }

    // Trascrizione vocale locale (Web Speech API)
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = SPEECH_LANG_BY_LOCALE[locale] || 'it-IT';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) {
          finalTranscriptRef.current += `${text} `;
        } else {
          interim += text;
        }
      }
      interimTranscriptRef.current = interim;
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      console.error('[VoiceInputWidget] SpeechRecognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        reportError(t('comandi_voice_error_transcription_denied'));
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        reportError(t('comandi_voice_error_recognition_generic'));
      }
    };

    recognition.onend = () => {
      if (manualStopRef.current) {
        manualStopRef.current = false;
        finalizeRecording();
        return;
      }
      // 'continuous' può interrompersi da solo dopo pause lunghe su alcuni
      // browser: se l'utente non ha premuto stop, riavvia l'ascolto.
      if (isRecordingRef.current) {
        try {
          recognition.start();
        } catch {
          // già avviato o non riavviabile: ignora
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();

    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    isRecordingRef.current = true;
    setIsRecording(true);
  }, [finalizeRecording, locale, onAudioRecorded, reportError, runWaveformLoop, t]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    manualStopRef.current = true;
    setIsRecording(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // Il resto della pulizia e l'invio alla Server Action avvengono in
    // finalizeRecording, invocato da recognition.onend: solo lì siamo
    // certi che l'ultimo risultato "isFinal" sia già arrivato.
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    } else {
      finalizeRecording();
    }
  }, [finalizeRecording]);

  const handleToggle = () => {
    if (isProcessing) return;
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  };

  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-col items-center gap-4 ${className}`}>
      {!isSupported && (
        <div className="w-full flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('comandi_voice_error_unsupported_banner')}</span>
        </div>
      )}

      {error && (
        <div className="w-full flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-red-300/70 hover:text-red-200"
            aria-label={t('comandi_voice_close_error_aria')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Onda sonora */}
      <div className="flex items-end justify-center gap-1 h-16 w-full">
        {Array.from({ length: WAVEFORM_BARS }).map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            className={`w-1.5 rounded-full transition-[height] duration-75 ${
              isRecording ? 'bg-red-400' : 'bg-gray-600'
            }`}
            style={{ height: '15%' }}
          />
        ))}
      </div>

      {/* Tasto Start/Stop */}
      <div className="relative flex items-center justify-center">
        {isRecording && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-30 animate-ping" />
        )}
        <button
          type="button"
          onClick={handleToggle}
          disabled={!isSupported || isProcessing}
          aria-pressed={isRecording}
          aria-label={isRecording ? t('comandi_voice_stop_aria') : t('comandi_voice_start_aria')}
          className={`relative z-10 flex items-center justify-center w-20 h-20 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isRecording
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-amber-600 hover:bg-amber-500 text-white'
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : isRecording ? (
            <Square className="w-7 h-7" fill="currentColor" />
          ) : (
            <Mic className="w-8 h-8" />
          )}
        </button>
      </div>

      {/* Timer + stato */}
      <div className="text-center">
        {isProcessing ? (
          <p role="status" className="text-sm font-medium text-amber-400">
            {t('comandi_voice_processing_status')}
          </p>
        ) : isRecording ? (
          <p className="text-lg font-mono font-semibold text-white tabular-nums">{formatDuration(elapsedSeconds)}</p>
        ) : (
          <p className="text-sm text-gray-400">{t('comandi_voice_idle_prompt')}</p>
        )}
      </div>

      {/* Trascrizione live */}
      {isRecording && (finalTranscriptRef.current || interimTranscript) && (
        <p className="w-full text-sm text-gray-300 bg-gray-900/60 rounded-lg p-3 max-h-24 overflow-y-auto">
          {finalTranscriptRef.current}
          <span className="text-gray-500">{interimTranscript}</span>
        </p>
      )}
    </div>
  );
}
