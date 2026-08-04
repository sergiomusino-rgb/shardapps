'use client';

// ─── PaymentSettings ────────────────────────────────────────────────────────
// Modulo pagamenti online OPZIONALE e "Plug & Play": il tenant decide se
// attivarlo e collega il proprio Stripe Payment Link. ZeusX non vede né
// gestisce mai le transazioni — nessuna chiave segreta lato server, solo un
// link pubblico salvato in apps.config.paymentSettings (stesso pattern
// read-merge-write di BusinessConfigSettings.tsx, vedi
// backend/routes/client-app.js::PUT /client/apps/:appId/payment-settings).
//
// Componente autosufficiente (come PushNotificationSection.tsx): riceve solo
// appId + token di sessione e gestisce da sé stato, salvataggio e feedback.
// Il toggle salva subito al click; link e chiave pubblica hanno un salvataggio
// esplicito per non scrivere un URL a metà a ogni tasto premuto.

import { useState } from 'react';
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { EMPTY_PAYMENT_SETTINGS, type PaymentSettings } from '@/src/lib/payment-settings';

interface PaymentSettingsProps {
  appId: string;
  /** Token da inoltrare come Authorization: Bearer — password legacy o JWT
   * Supabase a seconda di auth_mode, vedi session-helpers.ts::getAuthToken. */
  authToken: string;
  initial?: PaymentSettings;
}

export default function PaymentSettings({ appId, authToken, initial }: PaymentSettingsProps) {
  const [settings, setSettings] = useState<PaymentSettings>(initial ?? EMPTY_PAYMENT_SETTINGS);
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const save = async (patch: Partial<PaymentSettings>) => {
    const res = await fetch(`/api/client/apps/${appId}/payment-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Errore durante il salvataggio');
    }
    return data.paymentSettings as PaymentSettings;
  };

  const handleToggle = async (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled })); // ottimistico: switch reattivo subito
    setSavingToggle(true);
    setMessage(null);
    try {
      const updated = await save({ enabled });
      setSettings((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      setSettings((prev) => ({ ...prev, enabled: !enabled })); // rollback
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Errore di connessione' });
    } finally {
      setSavingToggle(false);
    }
  };

  const handleSaveLink = async () => {
    setSavingLink(true);
    setMessage(null);
    try {
      const updated = await save({
        stripeLink: settings.stripeLink.trim(),
        stripePublicKey: settings.stripePublicKey.trim(),
      });
      setSettings((prev) => ({ ...prev, ...updated }));
      setMessage({ type: 'success', text: 'Configurazione pagamenti salvata.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Errore di connessione' });
    } finally {
      setSavingLink(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toggle principale */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <CreditCard size={18} className="text-tenant-primary" />
          <div>
            <div className="text-sm font-semibold text-tenant-text">Attiva Pagamenti Online</div>
            <p className="mt-0.5 text-xs text-tenant-text-secondary">
              Mostra &quot;Paga Ora&quot; nelle fatture e nei documenti, con reindirizzo al tuo Stripe Payment Link.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          disabled={savingToggle}
          onClick={() => handleToggle(!settings.enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            settings.enabled ? 'bg-tenant-primary' : 'bg-tenant-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              settings.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* Configurazione Stripe: visibile solo a toggle attivo */}
      {settings.enabled && (
        <div className="flex flex-col gap-3 rounded-lg border border-tenant-border bg-tenant-card p-3.5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">
              Stripe Payment Link
            </label>
            <input
              type="url"
              value={settings.stripeLink}
              onChange={(e) => setSettings((prev) => ({ ...prev, stripeLink: e.target.value }))}
              placeholder="https://buy.stripe.com/xxxxxxxx"
              className="w-full rounded-lg border border-tenant-border bg-tenant-card-alt px-3 py-2 text-sm text-tenant-text outline-none placeholder:text-tenant-text-secondary focus:border-tenant-primary"
            />
            <p className="mt-1 text-xs text-tenant-text-secondary">
              Crealo da Stripe Dashboard → Payment Links. ZeusX non gestisce le tue transazioni: i pagamenti vanno direttamente al tuo account Stripe.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tenant-text-secondary">
              Chiave Pubblica Stripe <span className="normal-case font-normal">(opzionale)</span>
            </label>
            <input
              type="text"
              value={settings.stripePublicKey}
              onChange={(e) => setSettings((prev) => ({ ...prev, stripePublicKey: e.target.value }))}
              placeholder="pk_live_..."
              className="w-full rounded-lg border border-tenant-border bg-tenant-card-alt px-3 py-2 text-sm text-tenant-text outline-none placeholder:text-tenant-text-secondary focus:border-tenant-primary"
            />
            <p className="mt-1 text-xs text-tenant-text-secondary">
              Riservata a integrazioni future (checkout incorporato). Mai la chiave segreta: quella resta solo nel tuo dashboard Stripe.
            </p>
          </div>

          {message && (
            <div
              className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                message.type === 'success'
                  ? 'bg-tenant-success/10 text-tenant-success'
                  : 'bg-tenant-danger/10 text-tenant-danger'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
              )}
              {message.text}
            </div>
          )}

          <button
            type="button"
            disabled={savingLink || !settings.stripeLink.trim()}
            onClick={handleSaveLink}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-tenant-primary px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
          >
            {savingLink ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {savingLink ? 'Salvataggio...' : 'Salva Configurazione'}
          </button>
        </div>
      )}
    </div>
  );
}
