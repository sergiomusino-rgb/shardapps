'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

function ChatContent() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<{role: string, text: string}[]>([]);
  const [input, setInput] = useState('');
  const initialized = useRef(false);
  const { t } = useLanguage();

  const handleSendMessage = async (messageText?: string) => {
    const text = messageText || input;
    if (text.trim() === '') return;

    const userMessage = text;
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setInput('');

    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: userMessage }] })
      });

      const data = await response.json();
      console.log("Dati ricevuti dal server:", data);

      if (data && data.reply) {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'ai', text: t('chat_error_invalid') }]);
      }
    } catch (err) {
      console.error("Errore fetch:", err);
      setMessages(prev => [...prev, { role: 'ai', text: t('chat_error_connection') }]);
    }
  };

  useEffect(() => {
    if (initialized.current) return;
    const q = searchParams.get('q');
    if (q) {
      initialized.current = true;
      handleSendMessage(q);
      window.history.replaceState({}, '', '/dashboard/chat');
    }
  }, [searchParams]);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">{t('chat_title')}</h1>
      <div className="bg-slate-900 p-4 h-96 overflow-y-auto mb-4 border border-slate-700 rounded-lg">
        {messages.length === 0 && (
          <p className="text-slate-500 text-center mt-20">{t('chat_empty')}</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span className={`inline-block px-4 py-2 rounded-xl max-w-[80%] ${
              m.role === 'user' 
                ? 'bg-indigo-600 text-white' 
                : 'bg-slate-700 text-slate-100'
            }`}>
              {m.text}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          className="flex-1 p-3 bg-slate-800 text-white rounded-lg border border-slate-700 focus:outline-none focus:border-indigo-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder={t('chat_placeholder')}
        />
        <button onClick={() => handleSendMessage()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold transition">{t('chat_button')}</button>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { t } = useLanguage();
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">{t('chat_loading')}</div>}>
      <ChatContent />
    </Suspense>
  );
}