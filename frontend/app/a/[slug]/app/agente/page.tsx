'use client';

// ─── Comandi: pagina Agente sul campo ──────────────────────────────────────
// Interfaccia mobile-first per rappresentanti che raccolgono ordini a voce
// dal cliente (in negozio, in fiera, a domicilio). A differenza della
// console standard (ComandiOperativeConsole, trascrizione Web Speech
// client-side), qui l'audio viene registrato con MediaRecorder e inviato a
// app/api/agent-voice-order, che lo trascrive con Whisper (Groq) e lo
// struttura con lo stesso motore LLM del resto del modulo Comandi — più
// affidabile su dispositivi/browser dove la Web Speech API non è disponibile
// (Firefox, molte versioni di Safari iOS), al costo di un giro server in più.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Menu,
  Mic,
  Package,
  Plus,
  RotateCcw,
  Square,
  User,
  UserCog,
  X,
} from 'lucide-react';
import ComandiHeaderBrand from '@/components/comandi/ComandiHeaderBrand';
import ComandiSidebar from '@/components/comandi/ComandiSidebar';
import HeaderClock from '@/components/HeaderClock';
import LanguageSelector from '@/components/LanguageSelector';
import FullscreenToggle from '@/components/FullscreenToggle';
import { ALL_TABS, AGENT_TABS, TrialNudgeBanner, type Tab } from '@/components/comandi/ComandiInstanceDashboard';
import { useAppInfo } from '../../AppInfoContext';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useComandiRole } from '@/src/lib/useComandiRole';
import { usePwaSetup } from '@/hooks/usePwaSetup';
import { COMANDI_PWA_THEME_COLOR, COMANDI_PWA_APPLE_TOUCH_ICON, COMANDI_PWA_APP_NAME } from '@/src/lib/comandi-pwa';
import InstallAppBanner from '@/components/InstallAppBanner';
import InstallAppCard from '@/components/comandi/InstallAppCard';
import type { Customer, ParsedOrderItem, DiscardedItem } from '@/types/comandi';

interface AgentOrderResult {
  orderId: string;
  transcript: string;
  summary: string;
  confidenceScore: number;
  requiresManualConfirmation: boolean;
  items: ParsedOrderItem[];
  discardedItems: DiscardedItem[];
  totalAmount: number;
  customerName: string | null;
  deliveryDate: string | null;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCurrency(value: number): string {
  return `€ ${value.toFixed(2)}`;
}

export default function ComandiAgentPage() {
  const appInfo = useAppInfo();
  const { t } = useLanguage();
  const router = useRouter();

  // Icona e nome dell'app installabile: quelli scelti dal titolare in Azienda
  // (tenants.logo_url / name), non il brand fisso "Comand AI" — ogni agente
  // che installa l'app sul telefono deve vedere l'identità della propria
  // azienda, non quella del reseller. Fallback sui valori fissi finché il
  // fetch non risolve o se l'azienda non ha ancora caricato un logo/nome.
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabaseBrowser as any)
        .from('tenants')
        .select('name, logo_url')
        .eq('id', appInfo.tenantId)
        .single();
      if (cancelled) return;
      const tenant = data as { name?: string; logo_url?: string } | null;
      setCompanyName(tenant?.name || '');
      setCompanyLogoUrl(tenant?.logo_url || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [appInfo.tenantId]);

  const pwaAppName = companyName || COMANDI_PWA_APP_NAME;
  usePwaSetup(appInfo.slug, COMANDI_PWA_THEME_COLOR, companyLogoUrl || COMANDI_PWA_APPLE_TOUCH_ICON, pwaAppName);
  // Voci sidebar, come nella Dashboard. Un ruolo 'agent' vede solo Catalogo
  // (in sola lettura nella Dashboard), coerente con l'RBAC definito in
  // ComandiInstanceDashboard (AGENT_TABS).
  const { role, displayName: agentDisplayName } = useComandiRole(appInfo.tenantId);
  const navTabs: Tab[] = role === 'agent' ? AGENT_TABS : ALL_TABS;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await supabaseBrowser.auth.signOut();
    router.push(`/a/${appInfo.slug}`);
  };

  // ── Rubrica clienti ──────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabaseBrowser as any)
        .from('customers')
        .select('*')
        .eq('tenant_id', appInfo.tenantId)
        .order('name');
      if (!cancelled) setCustomers((data || []) as Customer[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [appInfo.tenantId]);

  const handlePickCustomer = useCallback((customer: Customer) => {
    setCustomerName(customer.name);
    setSelectedCustomerId(customer.id);
  }, []);

  const handleCustomerNameChange = useCallback((value: string) => {
    setCustomerName(value);
    setSelectedCustomerId(null);
  }, []);

  // ── Note ──────────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState('');

  // ── Registrazione audio (MediaRecorder) ──────────────────────────────────
  const [isSupported, setIsSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentOrderResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm');

  useEffect(() => {
    const hasMediaDevices = !!navigator.mediaDevices?.getUserMedia;
    setIsSupported(hasMediaDevices && typeof MediaRecorder !== 'undefined');
  }, []);

  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => cleanupRecording, [cleanupRecording]);

  const submitRecording = useCallback(
    async (blob: Blob) => {
      setIsProcessing(true);
      setRecordError(null);
      try {
        const {
          data: { session },
        } = await supabaseBrowser.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setRecordError(t('comandi_agent_error_session'));
          return;
        }

        const form = new FormData();
        form.append('audio', blob, `order.${extensionForMimeType(mimeTypeRef.current)}`);
        if (customerName.trim()) form.append('customerName', customerName.trim());
        if (selectedCustomerId) form.append('customerId', selectedCustomerId);
        if (notes.trim()) form.append('notes', notes.trim());

        const res = await fetch('/api/agent-voice-order', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        const json = await res.json().catch(() => ({ success: false, error: t('comandi_agent_error_network') }));

        if (!res.ok || !json.success) {
          setRecordError(json.error || t('comandi_agent_error_network'));
          return;
        }

        setResult(json.data as AgentOrderResult);
      } catch (err) {
        console.error('[ComandiAgentPage] Errore invio ordine vocale:', err);
        setRecordError(t('comandi_agent_error_network'));
      } finally {
        setIsProcessing(false);
      }
    },
    [customerName, selectedCustomerId, notes, t]
  );

  const startRecording = useCallback(async () => {
    setRecordError(null);
    setResult(null);
    audioChunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[ComandiAgentPage] getUserMedia error:', err);
      setRecordError(t('comandi_agent_error_mic_denied'));
      return;
    }
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
    mimeTypeRef.current = mimeType || 'audio/webm';

    const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      cleanupRecording();
      if (audioChunksRef.current.length === 0) {
        setRecordError(t('comandi_agent_error_empty_recording'));
        return;
      }
      const blob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
      void submitRecording(blob);
    };

    mediaRecorder.start();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
    setIsRecording(true);
  }, [cleanupRecording, submitRecording, t]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleToggleRecording = () => {
    if (isProcessing) return;
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  };

  const handleNewOrder = useCallback(() => {
    setResult(null);
    setRecordError(null);
    setCustomerName('');
    setSelectedCustomerId(null);
    setNotes('');
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-white">
      <div className="hidden md:block">
        <ComandiSidebar
          tenantId={appInfo.tenantId}
          visibleTabs={navTabs}
          tabLabel={(key) => t(`comandi_dashboard_tab_${key}`)}
          activeTab={null}
          dashboardHref={`/a/${appInfo.slug}/dashboard`}
          agentHref={`/a/${appInfo.slug}/app/agente`}
          agentLabel={t('comandi_dashboard_go_to_console')}
          showAgentEntry={navTabs.length > 0}
          isOnAgentPage
          onLogout={handleLogout}
          logoutLabel={t('comandi_dashboard_logout')}
        />
      </div>

      <div className="md:hidden">
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-200 ${
            mobileMenuOpen ? 'bg-black/60 backdrop-blur-sm opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <div
          className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ComandiSidebar
            tenantId={appInfo.tenantId}
            visibleTabs={navTabs}
            tabLabel={(key) => t(`comandi_dashboard_tab_${key}`)}
            activeTab={null}
            dashboardHref={`/a/${appInfo.slug}/dashboard`}
            agentHref={`/a/${appInfo.slug}/app/agente`}
            agentLabel={t('comandi_dashboard_go_to_console')}
            showAgentEntry={navTabs.length > 0}
            isOnAgentPage
            onLogout={handleLogout}
            logoutLabel={t('comandi_dashboard_logout')}
            onClose={() => setMobileMenuOpen(false)}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <TrialNudgeBanner slug={appInfo.slug} />
        <header className="flex h-16 items-center justify-between gap-3 border-b border-gray-800 bg-gray-900/60 px-4 md:justify-end md:px-6">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white md:hidden"
            aria-label="Apri menu"
          >
            <Menu size={22} />
          </button>
          <div className="md:hidden">
            <ComandiHeaderBrand />
          </div>
          <div className="flex items-center gap-3">
            <HeaderClock textColor="#e5e7eb" mutedColor="#6b7280" />
            <LanguageSelector />
            <FullscreenToggle color="#e5e7eb" hoverBackground="rgba(107,114,128,0.2)" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t('comandi_agent_page_title')}</h1>
        </div>

        {/* Punto di riferimento stabile per installare l'app sul telefono:
            a differenza del banner flottante (dismissabile e temporaneo),
            questa resta sempre visibile — l'agente sul campo non ha accesso
            alla tab Azienda dove sta la stessa card per il ruolo pieno. */}
        <InstallAppCard appName={pwaAppName} />

        {result ? (
          <ResultCard result={result} t={t} onNewOrder={handleNewOrder} />
        ) : (
          <>
            {/* Agente collegato: sola lettura, deriva dalla sessione (vedi
                AgentsTab) — non un campo libero, altrimenti orders.agent_id
                (impostato server-side dal token di sessione in
                confirmOrderAction) non corrisponderebbe più a quanto mostrato qui. */}
            {agentDisplayName && (
              <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  <UserCog className="w-3.5 h-3.5" />
                  {t('comandi_agent_agent_label')}
                </p>
                <p className="text-sm text-white truncate">{agentDisplayName}</p>
              </section>
            )}

            {/* Selettore cliente */}
            <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <User className="w-3.5 h-3.5" />
                {t('comandi_agent_customer_label')}
              </label>
              <input
                value={customerName}
                onChange={(e) => handleCustomerNameChange(e.target.value)}
                placeholder={t('comandi_agent_customer_placeholder')}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder:text-gray-500"
              />

              {customers.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {customers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handlePickCustomer(customer)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedCustomerId === customer.id
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600'
                      }`}
                    >
                      {customer.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Apre il form "Nuovo Cliente" della pagina Clienti (Dashboard),
                  invece di un form ridotto duplicato qui: un solo punto dove
                  si creano i clienti, con tutti i campi anagrafici. */}
              <Link
                href={`/a/${appInfo.slug}/dashboard?tab=customers&new=1`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('comandi_agent_customer_new_button')}
              </Link>
            </section>

            {/* Registrazione vocale */}
            <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 flex flex-col items-center gap-4">
              {!isSupported && (
                <div className="w-full flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{t('comandi_agent_error_unsupported')}</span>
                </div>
              )}
              {recordError && (
                <div className="w-full flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="flex-1">{recordError}</span>
                  <button type="button" onClick={() => setRecordError(null)} className="shrink-0 text-red-300/70 hover:text-red-200">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-30 animate-ping" />
                )}
                <button
                  type="button"
                  onClick={handleToggleRecording}
                  disabled={!isSupported || isProcessing}
                  aria-pressed={isRecording}
                  aria-label={isRecording ? t('comandi_agent_record_stop_aria') : t('comandi_agent_record_start_aria')}
                  className={`relative z-10 flex items-center justify-center w-24 h-24 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isRecording ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-9 h-9 animate-spin" />
                  ) : isRecording ? (
                    <Square className="w-8 h-8" fill="currentColor" />
                  ) : (
                    <Mic className="w-9 h-9" />
                  )}
                </button>
              </div>

              <div className="text-center">
                {isProcessing ? (
                  <p role="status" className="text-sm font-medium text-amber-400">
                    {t('comandi_agent_processing_status')}
                  </p>
                ) : isRecording ? (
                  <p className="text-lg font-mono font-semibold text-white tabular-nums">{formatDuration(elapsedSeconds)}</p>
                ) : (
                  <p className="text-sm text-gray-400">{t('comandi_agent_record_idle_prompt')}</p>
                )}
              </div>
            </section>

            {/* Note */}
            <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 block">
                  {t('comandi_agent_notes_label')}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('comandi_agent_notes_placeholder')}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder:text-gray-500"
                />
              </div>
            </section>
          </>
        )}
      </main>
      </div>

      <InstallAppBanner
        appName={pwaAppName}
        slug={appInfo.slug}
        primaryColor={COMANDI_PWA_THEME_COLOR}
        textColor="#ffffff"
        surfaceColor="#111827"
        borderColor="#1f2937"
      />
    </div>
  );
}

// ─── Riepilogo ordine registrato ────────────────────────────────────────────

function ResultCard({
  result,
  t,
  onNewOrder,
}: {
  result: AgentOrderResult;
  t: (key: string) => string;
  onNewOrder: () => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <div className="rounded-xl border border-green-700/50 bg-gray-900/60 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15 border border-green-700/50">
          <Check className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <p className="font-semibold text-white">{t('comandi_agent_result_title')}</p>
          <p className="text-xs text-amber-400">{t('comandi_agent_result_status_pending')}</p>
        </div>
      </div>

      {result.customerName && (
        <p className="text-sm text-gray-300">
          <span className="text-gray-500">{t('comandi_agent_customer_label')}:</span> {result.customerName}
        </p>
      )}

      {result.items.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            <Package className="w-3.5 h-3.5" />
            {t('comandi_agent_result_items_label')}
          </p>
          <div className="flex flex-col gap-1.5">
            {result.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm rounded-lg bg-gray-800/60 px-3 py-2">
                <span className="text-white">{item.quantity} {item.unit} × {item.matched_name}</span>
                <span className="text-gray-400">{formatCurrency(item.unit_price * item.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.discardedItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {t('comandi_agent_result_discarded_label')}
          </p>
          <div className="flex flex-col gap-1">
            {result.discardedItems.map((d, i) => (
              <p key={i} className="text-xs text-gray-500">&ldquo;{d.original_spoken_text}&rdquo; — {d.reason}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-800 pt-3">
        <span className="text-xs uppercase tracking-wide text-gray-500">{t('comandi_agent_result_total_label')}</span>
        <span className="text-lg font-bold text-white">{formatCurrency(result.totalAmount)}</span>
      </div>

      <button
        type="button"
        onClick={() => setShowTranscript((v) => !v)}
        className="flex items-center justify-between text-xs text-gray-500 hover:text-gray-300"
      >
        {t('comandi_agent_result_transcript_label')}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTranscript ? 'rotate-180' : ''}`} />
      </button>
      {showTranscript && (
        <p className="text-xs text-gray-400 bg-gray-950/60 rounded-lg p-3">{result.transcript}</p>
      )}

      <button
        type="button"
        onClick={onNewOrder}
        className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        {t('comandi_agent_new_order_button')}
      </button>
    </div>
  );
}
