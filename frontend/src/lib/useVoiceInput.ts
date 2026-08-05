'use client';

// ─── useVoiceInput ("Comandi AI") ───────────────────────────────────────────
// Dettatura vocale del prompt/chat via Web Speech API del browser. Stesso
// pattern già in uso in dashboard/generator/page.tsx e dashboard/creator-v1
// (SpeechRecognition nativo, nessuna chiamata server, nessuna registrazione
// audio): estratto qui in hook condiviso per riusarlo su più input di
// Creator AI (ProjectWizard + chat di AppEditorView) senza duplicare la
// gestione del ciclo di vita. Per il widget più ricco con MediaRecorder,
// analisi onda sonora ed estrazione AI lato server, vedi invece
// components/comandi/VoiceInputWidget.tsx: modulo diverso, per il prodotto
// "Comandi" di presa ordini, non per la dettatura di prompt.

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const SPEECH_LANG_BY_LOCALE: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
};

/**
 * @param locale lingua corrente (it/en/es/de/fr) per la trascrizione.
 * @param onTranscript chiamato ad ogni risultato (anche interinale) con il
 *   testo riconosciuto finora nella sessione di ascolto corrente: il
 *   chiamante decide se sostituire o accodare al contenuto esistente.
 */
export function useVoiceInput(locale: string, onTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Ref per evitare di ricreare la SpeechRecognition ad ogni render quando
  // cambia solo l'identità della callback (es. componente che re-renderizza
  // ad ogni keystroke): la logica di trascrizione resta stabile, cambia
  // solo dove finisce il testo.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionCtor);
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = SPEECH_LANG_BY_LOCALE[locale] || 'it-IT';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join('');
      onTranscriptRef.current(transcript);
    };

    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.stop();
      recognitionRef.current = null;
    };
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

  return { isListening, isSupported, toggleListening };
}
