'use client';

import { createContext, useContext, ReactNode } from 'react';

export type AuthMode = 'legacy' | 'supabase';
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'past_due' | 'canceled';

export interface AppInfoContextValue {
  appId: string;
  slug: string;
  authMode: AuthMode;
  appName: string;
  config: Record<string, unknown> | null;
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
  stripeSubscriptionId: string | null;
  /** Prezzo mensile (€) che il cliente finale paga per questa app: deciso dal
   * reseller in Management, non fisso — vedi lib/pricing.ts. */
  clientPrice: number;
  /** NULL per le app a schema generato da AI. 'comandi_ai' per il modulo
   * Comandi provisionato da slot: instrada verso la console operativa
   * dedicata invece del motore a tabelle dinamiche (app/a/[slug]/app). */
  appType: string | null;
}

const AppInfoContext = createContext<AppInfoContextValue | undefined>(undefined);

export function AppInfoProvider({ value, children }: { value: AppInfoContextValue; children: ReactNode }) {
  return <AppInfoContext.Provider value={value}>{children}</AppInfoContext.Provider>;
}

export function useAppInfo() {
  const context = useContext(AppInfoContext);
  if (!context) {
    throw new Error('useAppInfo must be used within AppInfoProvider');
  }
  return context;
}
