import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

function getServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Supabase service role env vars missing');
  }
  return createClient<Database>(url, key);
}

export interface Subscription {
  id: string;
  tenant_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

export async function getSubscription(tenantId: string): Promise<Subscription | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('getSubscription error:', error);
    throw new Error('Errore nel recupero della subscription');
  }

  return data as Subscription;
}

export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return subscription.status === 'active' || subscription.status === 'trialing';
}

export async function hasActiveSubscription(tenantId: string): Promise<boolean> {
  const sub = await getSubscription(tenantId);
  return isSubscriptionActive(sub);
}
