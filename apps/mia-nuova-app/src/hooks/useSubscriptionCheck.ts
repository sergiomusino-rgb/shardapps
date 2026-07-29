'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AppSubscriptionInfo {
  status: 'trial' | 'active' | 'expired' | 'past_due' | 'canceled';
  trial_end: string | null;
  trial_ends_at: string | null;
  client_price: number;
  stripe_subscription_id: string | null;
  totalum_app_id: string | null;
}

export interface SubscriptionCheckResult {
  info: AppSubscriptionInfo | null;
  loading: boolean;
  error: string | null;
  daysRemaining: number;
  isExpired: boolean;
  isTrialExpiringSoon: boolean;
  isBlocked: boolean;
}

export function useSubscriptionCheck(appId?: string): SubscriptionCheckResult {
  const [info, setInfo] = useState<AppSubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appId) {
      setLoading(false);
      return;
    }

    checkSubscriptionStatus();
  }, [appId]);

  const checkSubscriptionStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      // Recupera i campi status e trial_end dalla tabella apps
      const { data: app, error: appError } = await supabase
        .from('apps')
        .select('status, trial_end, trial_ends_at, client_price, stripe_subscription_id, totalum_app_id')
        .eq('id', appId)
        .single();

      if (appError || !app) {
        console.error('Errore recupero info abbonamento:', appError);
        setError('Impossibile recuperare le informazioni dell\'abbonamento');
        setLoading(false);
        return;
      }

      setInfo({
        status: app.status,
        trial_end: app.trial_end,
        trial_ends_at: app.trial_ends_at,
        client_price: app.client_price || 25.00,
        stripe_subscription_id: app.stripe_subscription_id,
        totalum_app_id: app.totalum_app_id,
      });
    } catch (err) {
      console.error('Errore controllo abbonamento:', err);
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  };

  // Calcola i giorni rimanenti
  const getDaysRemaining = (): number => {
    if (!info?.trial_end && !info?.trial_ends_at) return 0;
    
    const trialEndDate = new Date(info.trial_end || info.trial_ends_at || '');
    const now = new Date();
    const diffTime = trialEndDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  };

  const daysRemaining = getDaysRemaining();
  const isExpired = info?.status === 'trial' && daysRemaining <= 0;
  const isTrialExpiringSoon = info?.status === 'trial' && daysRemaining > 0 && daysRemaining <= 7;
  const isBlocked = isExpired && info?.status !== 'active';

  return {
    info,
    loading,
    error,
    daysRemaining,
    isExpired,
    isTrialExpiringSoon,
    isBlocked,
  };
}