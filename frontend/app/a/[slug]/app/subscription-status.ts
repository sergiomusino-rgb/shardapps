import type { SubscriptionStatus } from '../AppInfoContext';

/** Giorni rimanenti (>= 0) prima della scadenza di `trialEndsAt`. */
export function daysRemaining(trialEndsAt: string): number {
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
}

export type SubscriptionBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export interface SubscriptionStatusInfo {
  label: string;
  variant: SubscriptionBadgeVariant;
}

/** Etichetta + variante badge per lo stato abbonamento reale del tenant. */
export function getSubscriptionStatusInfo(
  status: SubscriptionStatus | null | undefined,
  trialEndsAt: string | null | undefined
): SubscriptionStatusInfo | null {
  if (!status) return null;
  switch (status) {
    case 'active':
      return { label: 'Attivo', variant: 'success' };
    case 'trial': {
      const days = trialEndsAt ? daysRemaining(trialEndsAt) : null;
      return {
        label: days != null ? `Trial · ${days} ${days === 1 ? 'giorno' : 'giorni'}` : 'Trial',
        variant: days != null && days <= 2 ? 'warning' : 'neutral',
      };
    }
    case 'past_due':
      return { label: 'Pagamento in ritardo', variant: 'warning' };
    case 'expired':
      return { label: 'Scaduto', variant: 'danger' };
    case 'canceled':
      return { label: 'Annullato', variant: 'neutral' };
    default:
      return null;
  }
}
