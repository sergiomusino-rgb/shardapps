'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTheme } from '@/src/lib/ThemeContext';

interface CompanySettings {
  companyName: string;
  logoUrl: string;
  slogan: string;
  accentColor: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  zipCode: string;
  city: string;
  province: string;
  vatNumber: string;
  fiscalCode: string;
  headerText: string;
  footerNotes: string;
}

export default function AdminSettingsPage() {
  const params = useParams();
  const slug = params.slug as string;
  
  // Usa il tema dal context globale
  const { theme } = useTheme();

  const [settings, setSettings] = useState<CompanySettings>({
    companyName: '',
    logoUrl: '',
    slogan: '',
    accentColor: '#6366f1',
    phone: '',
    email: '',
    website: '',
    address: '',
    zipCode: '',
    city: '',
    province: '',
    vatNumber: '',
    fiscalCode: '',
    headerText: '',
    footerNotes: '',
  });

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Recupera la password dalla sessione
  const getPassword = (): string | null => {
    if (typeof window === 'undefined') return null;
    const sessionKey = `app_session_${slug}`;
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed.password || null;
    } catch {
      return null;
    }
  };

  // Carica le impostazioni esistenti
  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      const password = getPassword();
      
      if (!password) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/a/${slug}`, {
          headers: {
            Authorization: `Bearer ${password}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          const appInfo = data.appInfo || data;
          const branding = appInfo?.branding || {};
          
          setSettings({
            companyName: branding.company_name || appInfo?.appName || appInfo?.name || '',
            logoUrl: branding.logo_url || appInfo?.logo || '',
            slogan: branding.slogan || '',
            accentColor: branding.primary_color || '#6366f1',
            phone: branding.phone || '',
            email: branding.email || '',
            website: branding.website || '',
            address: branding.address || '',
            zipCode: branding.zip_code || '',
            city: branding.city || '',
            province: branding.province || '',
            vatNumber: branding.vat_number || '',
            fiscalCode: branding.fiscal_code || '',
            headerText: branding.header_text || '',
            footerNotes: branding.footer_notes || '',
          });
        }
      } catch (error) {
        console.error('Errore caricamento impostazioni:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [slug]);

  const handleChange = (field: keyof CompanySettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setSaveMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);

    const password = getPassword();
    if (!password) {
      setSaveMessage({ type: 'error', text: 'Password mancante. Effettua nuovamente il login.' });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/a/${slug}/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify({
          branding: {
            company_name: settings.companyName,
            logo_url: settings.logoUrl,
            slogan: settings.slogan,
            primary_color: settings.accentColor,
            phone: settings.phone,
            email: settings.email,
            website: settings.website,
            address: settings.address,
            zip_code: settings.zipCode,
            city: settings.city,
            province: settings.province,
            vat_number: settings.vatNumber,
            fiscal_code: settings.fiscalCode,
            header_text: settings.headerText,
            footer_notes: settings.footerNotes,
          },
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || 'Errore nel salvataggio');
      }

      setSaveMessage({ type: 'success', text: 'Impostazioni salvate con successo!' });
      
      // Aggiorna la sessione con i nuovi dati
      const sessionKey = `app_session_${slug}`;
      const raw = localStorage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.appInfo = {
          ...parsed.appInfo,
          branding: {
            company_name: settings.companyName,
            logo_url: settings.logoUrl,
            primary_color: settings.accentColor,
          },
        };
        localStorage.setItem(sessionKey, JSON.stringify(parsed));
      }
    } catch (error) {
      console.error('Errore salvataggio:', error);
      setSaveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Errore nel salvataggio' });
    } finally {
      setSaving(false);
    }
  };

  // Colori in base al tema
  const isDark = theme === 'dark';
  const bgColor = isDark ? 'bg-slate-950' : 'bg-slate-100';
  const cardBg = isDark ? 'bg-slate-900' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-slate-900';
  const textSecondary = isDark ? 'text-slate-400' : 'text-slate-600';
  const textMuted = isDark ? 'text-slate-500' : 'text-slate-400';
  const border = isDark ? 'border-slate-800' : 'border-slate-200';
  const inputBg = isDark ? 'bg-slate-900' : 'bg-white';

  if (loading) {
    return (
      <div className={`min-h-screen ${bgColor} flex items-center justify-center`}>
        <div className={textSecondary}>Caricamento impostazioni...</div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgColor} transition-colors duration-300`}>
      <div className="max-w-7xl mx-auto space-y-6 p-6">
        {/* Header */}
        <div>
          <h1 className={`text-3xl font-bold tracking-tight ${textPrimary}`}>Configurazione Aziendale</h1>
          <p className={`${textSecondary} mt-1`}>Gestisci le informazioni della tua azienda, i contatti e i documenti</p>
        </div>

        {/* Messaggio di feedback */}
        {saveMessage && (
          <div
            className={`p-4 rounded-xl border ${
              saveMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {saveMessage.text}
          </div>
        )}

        {/* Layout a due colonne */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* COLONNA SINISTRA */}
          <div className="space-y-6">
            {/* Card: Logo e Identità */}
            <div className={`${cardBg} border ${border} rounded-2xl p-6 space-y-4`}>
              <h3 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'} border-b ${border}/60 pb-2`}>
                Logo e Identità
              </h3>

              <div className="space-y-4">
                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Logo Aziendale
                  </label>
                  {settings.logoUrl && (
                    <div className="mb-3">
                      <img
                        src={settings.logoUrl}
                        alt="Logo preview"
                        className="h-20 w-auto rounded-lg border border-slate-800 bg-slate-950 p-2"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              handleChange('logoUrl', ev.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="hidden"
                      />
                      <div className={`flex items-center justify-center gap-2 rounded-xl ${inputBg} border ${border} ${textSecondary} px-4 py-2.5 text-sm hover:bg-slate-800 transition`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9l5-4a4 4 0 014.42 0l5 4a4 4 0 01.88 7.9M15 11l3-3m0 0l3 3m-3-3v8" />
                        </svg>
                        {settings.logoUrl ? 'Cambia Logo' : 'Carica Logo'}
                      </div>
                    </label>
                    {settings.logoUrl && (
                      <button
                        type="button"
                        onClick={() => handleChange('logoUrl', '')}
                        className="px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition"
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Nome Azienda
                  </label>
                  <input
                    type="text"
                    value={settings.companyName}
                    onChange={(e) => handleChange('companyName', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Slogan
                  </label>
                  <input
                    type="text"
                    value={settings.slogan}
                    onChange={(e) => handleChange('slogan', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Colore Accent
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings.accentColor}
                      onChange={(e) => handleChange('accentColor', e.target.value)}
                      className="h-10 w-20 rounded-lg cursor-pointer border border-slate-800 bg-slate-950"
                    />
                    <input
                      type="text"
                      value={settings.accentColor}
                      onChange={(e) => handleChange('accentColor', e.target.value)}
                      className={`flex-1 ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Contatti */}
            <div className={`${cardBg} border ${border} rounded-2xl p-6 space-y-4`}>
              <h3 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'} border-b ${border}/60 pb-2`}>
                Contatti
              </h3>

              <div className="space-y-4">
                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Telefono
                  </label>
                  <input
                    type="tel"
                    value={settings.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={settings.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Sito Web
                  </label>
                  <input
                    type="url"
                    value={settings.website}
                    onChange={(e) => handleChange('website', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* COLONNA DESTRA */}
          <div className="space-y-6">
            {/* Card: Dati Aziendali */}
            <div className={`${cardBg} border ${border} rounded-2xl p-6 space-y-4`}>
              <h3 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'} border-b ${border}/60 pb-2`}>
                Dati Aziendali
              </h3>

              <div className="space-y-4">
                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Indirizzo
                  </label>
                  <input
                    type="text"
                    value={settings.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                      CAP
                    </label>
                    <input
                      type="text"
                      value={settings.zipCode}
                      onChange={(e) => handleChange('zipCode', e.target.value)}
                      className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                      Città
                    </label>
                    <input
                      type="text"
                      value={settings.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Provincia
                  </label>
                  <input
                    type="text"
                    value={settings.province}
                    onChange={(e) => handleChange('province', e.target.value)}
                    maxLength={2}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition uppercase`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                      P.IVA
                    </label>
                    <input
                      type="text"
                      value={settings.vatNumber}
                      onChange={(e) => handleChange('vatNumber', e.target.value)}
                      className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                      C.F.
                    </label>
                    <input
                      type="text"
                      value={settings.fiscalCode}
                      onChange={(e) => handleChange('fiscalCode', e.target.value)}
                      className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card: Documenti */}
            <div className={`${cardBg} border ${border} rounded-2xl p-6 space-y-4`}>
              <h3 className={`text-base font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'} border-b ${border}/60 pb-2`}>
                Documenti
              </h3>

              <div className="space-y-4">
                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Testo Intestazione
                  </label>
                  <textarea
                    value={settings.headerText}
                    onChange={(e) => handleChange('headerText', e.target.value)}
                    rows={3}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition resize-none`}
                  />
                  <p className={`text-xs ${textMuted} mt-1`}>
                    Questo testo apparirà nell&apos;intestazione dei documenti generati
                  </p>
                </div>

                <div>
                  <label className={`block text-xs ${textSecondary} uppercase tracking-wider font-semibold mb-2`}>
                    Note a Piè di Pagina
                  </label>
                  <textarea
                    value={settings.footerNotes}
                    onChange={(e) => handleChange('footerNotes', e.target.value)}
                    rows={4}
                    className={`w-full ${inputBg} border ${border} ${textPrimary} rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition resize-none`}
                  />
                  <p className={`text-xs ${textMuted} mt-1`}>
                    Usa {'{{date}'} per inserire la data corrente automaticamente
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pulsante Salva in basso a destra */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white px-8 py-3 rounded-xl font-medium text-sm transition flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Salvataggio...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Salva modifiche
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}