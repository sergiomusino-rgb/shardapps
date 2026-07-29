import webpush from 'web-push';

// ─── Web Push (Fase B) ──────────────────────────────────────────────────────
// Configurazione centralizzata delle VAPID keys per l'invio di notifiche
// push native alle PWA generate. NEXT_PUBLIC_VAPID_PUBLIC_KEY è la stessa
// chiave che il client userà in pushManager.subscribe({applicationServerKey}),
// deve restare identica a VAPID_PRIVATE_KEY (coppia generata una sola volta
// con webpush.generateVAPIDKeys(), non rigenerabile in modo indipendente).

let configured = false;

export class WebPushConfigError extends Error {}

export function getWebPush(): typeof webpush {
  if (configured) return webpush;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@zeusxapps.com';

  if (!publicKey || !privateKey) {
    throw new WebPushConfigError(
      'VAPID keys non configurate: impossibile inviare notifiche push.'
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return webpush;
}
