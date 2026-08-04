// ─── paymentSettings ────────────────────────────────────────────────────────
// Forma condivisa del modulo pagamenti opzionale Plug & Play (apps.config.
// paymentSettings): un solo posto da cui leggerla, usato sia dal pannello di
// impostazioni (PaymentSettings.tsx) sia da qualunque schermata che deve
// decidere se mostrare "Paga Ora" (PaymentCTA.tsx). Nessuna migration: vive
// dentro la colonna apps.config JSONB già esistente, già letta da anon per
// le pagine pubbliche (vedi backend/routes/client-app.js).

export interface PaymentSettings {
  /** Interruttore attivato dal tenant: se false, l'app mostra sempre i
   * metodi tradizionali anche se stripeLink è già stato compilato in passato. */
  enabled: boolean;
  /** Stripe Payment Link del tenant (https://buy.stripe.com/... o
   * checkout.stripe.com/...). ZeusX non genera né gestisce mai questo link:
   * il tenant lo crea nel proprio dashboard Stripe. */
  stripeLink: string;
  /** Publishable key (pk_...) del tenant, salvata per un futuro checkout
   * embedded (Stripe Elements). Non usata dal redirect a Payment Link
   * odierno: mai una secret key, quindi innocua da tenere in config
   * leggibile da anon. */
  stripePublicKey: string;
}

export const EMPTY_PAYMENT_SETTINGS: PaymentSettings = {
  enabled: false,
  stripeLink: '',
  stripePublicKey: '',
};

/** Estrae paymentSettings da apps.config con fallback sicuro: nessun record
 * esistente ce l'ha finché il tenant non attiva il modulo dalle Impostazioni. */
export function getPaymentSettings(config: Record<string, unknown> | null | undefined): PaymentSettings {
  const raw = (config as { paymentSettings?: Partial<PaymentSettings> } | null | undefined)?.paymentSettings;
  return {
    enabled: !!raw?.enabled,
    stripeLink: raw?.stripeLink || '',
    stripePublicKey: raw?.stripePublicKey || '',
  };
}

/** Vero solo se i pagamenti online sono attivi E c'è un link valido da cui
 * far ripartire il cliente finale: stessa condizione usata sia lato
 * PaymentCTA sia per eventuali controlli futuri. */
export function isOnlinePaymentActive(settings: PaymentSettings): boolean {
  return settings.enabled && settings.stripeLink.trim().length > 0;
}
