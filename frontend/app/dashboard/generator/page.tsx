'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { MessageSquare, Send, Mic, MicOff, Loader2, AlertTriangle, CreditCard } from 'lucide-react';

// Type declarations for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// Pattern per riconoscere richieste di creazione app
const CREATE_APP_PATTERNS = [
  /crea\s+(?:un'?\s+)?app\s+(?:per\s+)?(.+)/i,
  /genera\s+(?:un'?\s+)?app\s+(?:per\s+)?(.+)/i,
  /fai\s+(?:un'?\s+)?app\s+(?:per\s+)?(.+)/i,
  /create\s+(?:an?\s+)?app\s+(?:for\s+)?(.+)/i,
  /generate\s+(?:an?\s+)?app\s+(?:for\s+)?(.+)/i,
  /make\s+(?:an?\s+)?app\s+(?:for\s+)?(.+)/i,
];

// Messaggi di caricamento dinamici
const LOADING_MESSAGES = [
  "Sto configurando il database...",
  "Generando l'interfaccia con Tailwind...",
  "Ottimizzando le tabelle...",
  "Creando i campi personalizzati...",
  "Impostando i colori ATOMIC DARK...",
  "Finalizzando la tua app..."
];

// Admin user ID - bypassa tutti i limiti
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

export default function GeneratorPage() {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [messages, setMessages] = useState<{role: string, text: string, isAppLink?: boolean, appUrl?: string}[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showSlotsExhaustedModal, setShowSlotsExhaustedModal] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Initialize SpeechRecognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.lang = locale === 'it' ? 'it-IT' : 
                                   locale === 'es' ? 'es-ES' : 
                                   locale === 'de' ? 'de-DE' : 
                                   locale === 'fr' ? 'fr-FR' : 'en-US';
        recognitionRef.current.interimResults = true;
        recognitionRef.current.continuous = false;

        recognitionRef.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result) => result.transcript)
            .join('');
          setInput(transcript);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current.onerror = () => {
          setIsListening(false);
        };
      }
    }
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isProcessing) {
        handleSendMessage();
      }
    }
  };

  // Ottieni l'utente corrente
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (user) {
        setUserId(user.id);
        setIsAdmin(user.id === ADMIN_USER_ID);
      }
    };
    getUser();
  }, [supabaseBrowser]);

  // Gestione messaggi di caricamento rotanti
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (showLoadingOverlay) {
      interval = setInterval(() => {
        setLoadingMessageIndex(prev => (prev + 1) % LOADING_MESSAGES.length);
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [showLoadingOverlay]);

  // Estrae nome attività e tipo dalla richiesta
  const parseAppRequest = (text: string): { activityName: string; activityType: string } | null => {
    const lowerText = text.toLowerCase();
    
    // Riconosci il tipo di attività
    let activityType = 'custom';
    if (lowerText.includes('ecommerce') || lowerText.includes('e-commerce') || lowerText.includes('shop') || lowerText.includes('negozio') || lowerText.includes('store')) {
      activityType = 'ecommerce';
    } else if (lowerText.includes('ristorante') || lowerText.includes('restaurant') || lowerText.includes('cibo') || lowerText.includes('food') || lowerText.includes('pizzeria')) {
      activityType = 'restaurant';
    } else if (lowerText.includes('negozio') || lowerText.includes('retail') || lowerText.includes('shop')) {
      activityType = 'retail';
    } else if (lowerText.includes('servizio') || lowerText.includes('service')) {
      activityType = 'service';
    } else if (lowerText.includes('professionale') || lowerText.includes('professional') || lowerText.includes('studio') || lowerText.includes('office')) {
      activityType = 'professional';
    } else if (lowerText.includes('immobiliare') || lowerText.includes('real estate') || lowerText.includes('property')) {
      activityType = 'realestate';
    } else if (lowerText.includes('palestra') || lowerText.includes('fitness') || lowerText.includes('gym')) {
      activityType = 'fitness';
    } else if (lowerText.includes('hotel') || lowerText.includes('hospitality') || lowerText.includes('albergo')) {
      activityType = 'hospitality';
    } else if (lowerText.includes('associazione') || lowerText.includes('association') || lowerText.includes('organization')) {
      activityType = 'association';
    }

    // Estrai il nome dell'attività
    for (const pattern of CREATE_APP_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return {
          activityName: match[1].trim(),
          activityType
        };
      }
    }

    // Se non c'è pattern ma contiene parole come "app" e un nome
    if (lowerText.includes('app') && !lowerText.includes('ai')) {
      const words = text.split(/\s+/);
      const nameWords = words.filter(w => !['crea', 'genera', 'fai', 'app', 'per', 'create', 'generate', 'make', 'for', 'an', 'a', 'the'].includes(w.toLowerCase()));
      if (nameWords.length > 0) {
        return {
          activityName: nameWords.join(' '),
          activityType
        };
      }
    }

    return null;
  };

  const handleSendMessage = async (messageText?: string) => {
    const text = messageText || input;
    if (text.trim() === '') return;

    const userMessage = text;
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setInput('');
    setIsProcessing(true);

    // Mostra overlay di caricamento Atomic Dark SEMPRE
    setShowLoadingOverlay(true);
    setLoadingMessageIndex(0);

    try {
      // Get auth session for token
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      
      // Verifica che l'utente sia autenticato
      if (!session?.access_token) {
        setShowLoadingOverlay(false);
        setMessages(prev => [...prev, { 
          role: 'ai', 
          text: 'Devi effettuare il login per creare un\'app.'
        }]);
        router.push('/login');
        return;
      }
      
      // Chiama la rotta /api/generate con userPrompt
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          userPrompt: text,
          lang: locale
        })
      });

      const data = await response.json();
      
      // Gestione errore 403 - Slot esauriti (solo per non-admin)
      if (response.status === 403 && data.code === 'SLOTS_EXHAUSTED') {
        setShowLoadingOverlay(false);
        if (!isAdmin) {
          setShowSlotsExhaustedModal(true);
        } else {
          // Admin: mostra errore ma non bloccare con modal upgrade
          setMessages(prev => [...prev, { 
            role: 'ai', 
            text: 'Errore temporaneo del sistema. Riprova.'
          }]);
        }
        return;
      }
      
      if (data.success && data.data) {
        // Redirect alla pagina di attesa con projectId
        router.push(`/dashboard/generator/attesa/${data.data.projectId}`);
      } else {
        setShowLoadingOverlay(false);
        setMessages(prev => [...prev, { 
          role: 'ai', 
          text: data.error || "Errore nella generazione dell'interfaccia"
        }]);
      }
    } catch (err) {
      console.error("Errore generazione app:", err);
      setShowLoadingOverlay(false);
      setMessages(prev => [...prev, { 
        role: 'ai', 
        text: "Errore di connessione. Riprova più tardi."
      }]);
    }
    
    setIsProcessing(false);
  };

  const handleUpgrade = () => {
    setShowSlotsExhaustedModal(false);
    router.push('/pricing');
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-4">{t('generator_title')}</h1>
          <p className="text-gray-400 text-lg">{t('generator_subtitle')}</p>
        </div>

        {/* Main Box */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          {/* Prompt Area */}
          <div className="mb-6 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('generator_placeholder')}
              className="w-full h-32 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-amber-500 resize-none p-4 pr-12"
            />
            {/* Microphone Button */}
            <button
              type="button"
              onClick={toggleListening}
              disabled={isProcessing}
              className={`absolute right-3 top-3 p-2 rounded-lg transition-colors ${
                isListening 
                  ? 'bg-red-500/20 text-red-400 animate-pulse' 
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
              }`}
              title={isListening ? 'Stop listening' : 'Speak to enter text'}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>

          {/* Generate Button */}
          <button
            onClick={() => handleSendMessage()}
            disabled={!input.trim() || isProcessing}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
          {t('generator_generate_button')}
          </button>
        </div>
      </div>

      {/* Loading Overlay - Atomic Dark Style */}
      {showLoadingOverlay && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center z-50">
          <div className="text-center">
            {/* Pulsating violet circle animation */}
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 bg-violet-600/30 rounded-full animate-pulse"></div>
              <div className="absolute inset-2 bg-violet-600/50 rounded-full animate-ping"></div>
              <div className="absolute inset-4 bg-violet-600 rounded-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            </div>
            
            {/* Dynamic loading message */}
            <h2 className="text-2xl font-bold text-white mb-4">
              {LOADING_MESSAGES[loadingMessageIndex]}
            </h2>
            
            <p className="text-gray-400">
              Stiamo generando la tua interfaccia...
            </p>
          </div>
        </div>
      )}

      {/* Slots Exhausted Modal - Atomic Dark Style */}
      {showSlotsExhaustedModal && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4">
            <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-8 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              
              <h2 className="text-2xl font-bold text-white mb-4">
                Slot esauriti
              </h2>
              
              <p className="text-gray-300 text-sm mb-8">
                Hai raggiunto il limite massimo di app generabili per il tuo piano. 
                Aggiorna il tuo piano per creare nuovi gestionali.
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSlotsExhaustedModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
                >
                  Chiudi
                </button>
                <button
                  onClick={handleUpgrade}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  Upgrade
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}