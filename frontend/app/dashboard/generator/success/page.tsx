'use client';

import { useSearchParams } from 'next/navigation';
import { Sparkles, Copy, Check, Key, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const appSlug = searchParams.get('appSlug');
  const projectId = searchParams.get('projectId');
  const title = searchParams.get('title');
  const { t } = useLanguage();

  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<{email?: string, password?: string} | null>(null);
  const [loadingCredentials, setLoadingCredentials] = useState(false);

  // ID interno dell'app (pulito, senza riferimenti a URL esterni)
  const internalAppId = projectId || appSlug || 'N/A';
  
  // URL dell'app generata - verrà sovrascritto dal database se disponibile
  const [appUrl, setAppUrl] = useState<string>('');
  const [loadingUrl, setLoadingUrl] = useState(true);

  // Recupera l'URL di produzione dal database
  useEffect(() => {
    if (!appSlug) {
      setLoadingUrl(false);
      return;
    }
    
    const fetchProductionUrl = async () => {
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        if (!session?.access_token) {
          setAppUrl(`${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appSlug}`);
          setLoadingUrl(false);
          return;
        }
        
        const response = await fetch(`/api/a/${appSlug}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.production_url) {
            setAppUrl(data.production_url);
          } else {
            setAppUrl(`${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appSlug}`);
          }
        } else {
          setAppUrl(`${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appSlug}`);
        }
      } catch (error) {
        console.error('Error fetching production URL:', error);
        setAppUrl(`${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${appSlug}`);
      } finally {
        setLoadingUrl(false);
      }
    };
    
    fetchProductionUrl();
  }, [appSlug]);

  // Recupera le credenziali se abbiamo lo slug
  useEffect(() => {
    if (!appSlug) return;
    
    const fetchCredentials = async () => {
      setLoadingCredentials(true);
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        if (!session?.access_token) return;
        
        const response = await fetch(`/api/a/${appSlug}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          // L'API ritorna i dati dell'app con client_email e client_password
          setCredentials({
            email: data.client_email,
            password: data.client_password
          });
        }
      } catch (error) {
        console.error('Error fetching credentials:', error);
      } finally {
        setLoadingCredentials(false);
      }
    };
    
    fetchCredentials();
  }, [appSlug]);

  // Demo placeholder quando non ci sono app generate
  if (!appSlug) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8 flex items-center justify-center">
        <div className="max-w-2xl mx-auto text-center">
          {/* Header */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <Sparkles className="w-10 h-10 text-violet-400" />
            <h1 className="text-4xl font-bold">{t('success_congrats')}</h1>
            <Sparkles className="w-10 h-10 text-violet-400" />
          </div>
          <p className="text-xl text-gray-300 mb-12">
            {t('success_start_using')}
          </p>

          {/* Demo Placeholder Card */}
          <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">{t('success_demo_app')}</h2>
                <p className="text-gray-400">{t('success_demo_type')} demo</p>
              </div>
              <div className="px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg">
                <span className="text-green-400 font-medium">{t('success_demo_active')}</span>
              </div>
            </div>

            {/* App URL Placeholder */}
            <div className="mb-6 p-4 bg-slate-800/50 rounded-xl">
              <label className="block text-sm font-medium text-gray-400 mb-2">
                {t('success_url_app')}
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-lg text-gray-500 truncate">
                  https://demo.zeusx.app
                </div>
                <button
                  disabled
                  className="p-3 bg-slate-700 rounded-lg opacity-50 cursor-not-allowed"
                >
                  <Copy className="w-5 h-5 text-gray-300" />
                </button>
              </div>
            </div>

            {/* QR Code Placeholder */}
            <div className="mb-6 p-6 bg-slate-800/50 rounded-xl text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-violet-500/20 mb-4">
                <svg className="w-8 h-8 text-violet-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h4v4H3V3zm1 1h2v2H4V4zM3 19h4v4H3v-4zm1 1h2v2H4v-2zM19 3h4v4h-4V3zm1 1h2v2h-2V4zM19 19h4v4h-4v-4zm1 1h2v2h-2v-2zM7 7h2v2H7V7zm1 1h1v1H8V8zM7 15h2v2H7v-2zm1 1h1v1H8v-1z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-3">{t('success_qr_access')}</h3>
              <p className="text-gray-400 text-sm mb-4">
                {t('success_qr_placeholder')}
              </p>
              <div className="inline-block p-4 bg-white rounded-xl">
                <div className="w-48 h-48 flex items-center justify-center text-gray-500">
                  <svg className="w-16 h-16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 3h4v4H3V3zm1 1h2v2H4V4zM3 19h4v4H3v-4zm1 1h2v2H4v-2zM19 3h4v4h-4V3zm1 1h2v2h-2V4zM19 19h4v4h-4v-4zm1 1h2v2h-2v-2zM7 7h2v2H7V7zm1 1h1v1H8V8zM7 15h2v2H7v-2zm1 1h1v1H8v-1z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-12">
            <Sparkles className="w-10 h-10 text-violet-400" />
            <h1 className="text-4xl font-bold">{t('success_congrats')}</h1>
            <Sparkles className="w-10 h-10 text-violet-400" />
          </div>
          <p className="text-xl text-gray-300">
            {t('success_start_using')}
          </p>
        </div>

        {/* App Info Card - Atomic Dark Style */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold">{title || t('success_your_app')}</h2>
              <p className="text-gray-400">ID: {projectId || internalAppId}</p>
            </div>
            <div className="px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg">
              <span className="text-green-400 font-medium">{t('success_demo_active')}</span>
            </div>
          </div>

          {/* App ID - Internal identifier */}
          <div className="mb-6 p-4 bg-slate-800/50 rounded-xl">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              {t('success_app_id_label')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                readOnly
                value={internalAppId}
                className="flex-1 text-lg bg-transparent text-violet-400 truncate focus:outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(internalAppId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="p-3 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-400" />
                ) : (
                  <Copy className="w-5 h-5 text-gray-300" />
                )}
              </button>
            </div>
          </div>

          {/* App URL - with "Go" button */}
          {appUrl && (
            <div className="mb-6 p-4 bg-slate-800/50 rounded-xl">
              <label className="block text-sm font-medium text-gray-400 mb-2">
                {t('success_url_app')}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={appUrl}
                  className="flex-1 text-lg bg-transparent text-emerald-400 truncate focus:outline-none"
                />
                <button
                  onClick={() => window.open(appUrl, '_blank')}
                  className="p-3 bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors"
                  title="Apri l'app"
                >
                  <ExternalLink className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* QR Code for mobile access */}
          {appUrl && (
            <div className="mb-6 p-6 bg-slate-800/50 rounded-xl text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-violet-500/20 mb-4">
                <svg className="w-8 h-8 text-violet-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h4v4H3V3zm1 1h2v2H4V4zM3 19h4v4H3v-4zm1 1h2v2H4v-2zM19 3h4v4h-4V3zm1 1h2v2h-2V4zM19 19h4v4h-4v-4zm1 1h2v2h-2v-2zM7 7h2v2H7V7zm1 1h1v1H8V8zM7 15h2v2H7v-2zm1 1h1v1H8v-1z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold mb-3">{t('success_qr_access')}</h3>
              <p className="text-gray-400 text-sm mb-4">
                {t('success_scan_qr')}
              </p>
              <div className="inline-block p-4 bg-white rounded-xl">
                <QRCodeSVG 
                  value={appUrl} 
                  size={120} 
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>
            </div>
          )}

          {/* Client Credentials - Only show if available */}
          {credentials && (
            <div className="mb-6 p-4 bg-slate-800/50 rounded-xl">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <Key className="w-4 h-4" />
                {t('success_credentials_label')}
              </h3>
              
              {/* Email */}
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">{t('success_email_label')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={credentials.email || ''}
                    className="flex-1 text-sm bg-transparent text-emerald-400 truncate focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (credentials.email) {
                        navigator.clipboard.writeText(credentials.email);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-300" />
                    )}
                  </button>
                </div>
              </div>

              {/* Password - with Copy button */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('success_password_label')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={credentials.password || ''}
                    className="flex-1 text-sm bg-transparent text-amber-400 truncate focus:outline-none font-mono"
                  />
                  <button
                    onClick={() => {
                      if (credentials.password) {
                        navigator.clipboard.writeText(credentials.password);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }
                    }}
                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-300" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadingCredentials && (
            <div className="mb-6 p-4 bg-slate-800/50 rounded-xl">
              <p className="text-sm text-gray-400">{t('success_loading_credentials')}</p>
            </div>
          )}
        </div>

         {/* Action Buttons */}
         <div className="flex gap-4">
           {appSlug && (
             <a
               href={`/dashboard/projects/${appSlug}`}
               className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-4 px-6 rounded-xl font-semibold transition-colors text-center"
             >
               {t('success_button_go_to_app_details') || 'Vai ai dettagli dell\'app'}
             </a>
           )}
           <a
             href="/dashboard/generator"
             className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-4 px-6 rounded-xl font-semibold transition-colors text-center"
           >
             {t('success_button_new_prompt')}
           </a>
         </div>
      </div>
    </div>
  );
}