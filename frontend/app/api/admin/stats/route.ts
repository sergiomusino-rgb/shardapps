import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
    if (user.id !== ADMIN_USER_ID) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    const [tenantsRes, appsRes, appRegistryRes, subsRes, transactionsRes] = await Promise.all([
      supabase.from('tenants').select('*'),
      supabase.from('apps').select('*'),
      supabase.from('app_registry').select('id, ownership_status, reseller_id, original_reseller_id, checkout_url'),
      supabase.from('subscriptions').select('*'),
      supabase.from('transactions').select('*'),
    ]);

    if (tenantsRes.error) throw tenantsRes.error;
    if (appsRes.error) throw appsRes.error;
    if (appRegistryRes.error) throw appRegistryRes.error;
    if (subsRes.error) throw subsRes.error;

    const tenants = tenantsRes.data || [];
    const apps = appsRes.data || [];
    const appRegistry = appRegistryRes.data || [];
    const subs = subsRes.data || [];
    const transactions = transactionsRes.data || [];

    // Create a map of app_registry data for quick lookup
    const appRegistryMap = new Map(appRegistry.map((a: any) => [a.id, a]));

    // Merge ownership_status from app_registry into apps
    const appsWithOwnership = apps.map((a: any) => ({
      ...a,
      ownership_status: appRegistryMap.get(a.id)?.ownership_status || 'reseller_owned',
    }));

    const now = new Date();
    // Logica di determinazione stato app:
    // 1. Prima controlla status (trial, active, expired)
    // 2. Poi controlla expires_at o trial_ends_at
    // 3. Infine controlla client_active o is_active come fallback
    const activeApps = appsWithOwnership.filter(a => {
      // Se status è 'active', l'app è attiva
      if (a.status === 'active') return true;
      
      // Se status è 'trial', controlla se la prova è scaduta
      if (a.status === 'trial') {
        // Controlla trial_ends_at o expires_at
        const expiryDate = a.trial_ends_at || a.expires_at;
        if (!expiryDate || new Date(expiryDate) > now) return true;
      }
      
      // Fallback: controlla client_active o is_active
      if (a.client_active === true || a.is_active === true) return true;
      
      return false;
    });
    const expiredApps = appsWithOwnership.filter(a => {
      // Se status è 'expired', l'app è scaduta
      if (a.status === 'expired') return true;
      
      // Se status è 'trial', controlla se la prova è scaduta
      if (a.status === 'trial') {
        const expiryDate = a.trial_ends_at || a.expires_at;
        if (expiryDate && new Date(expiryDate) < now) return true;
      }
      
      // Fallback: controlla client_active o is_active
      if (a.client_active === false || a.is_active === false) return true;
      
      return false;
    });

    const dist: Record<string, number> = {};
    tenants.forEach(t => { const p = t.plan || 'free'; dist[p] = (dist[p] || 0) + 1; });

    // Use total_amount from transactions table instead of amount
    const revenue = transactions.reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);

    const monthly: Record<string, { count: number; revenue: number }> = {};
    transactions.forEach((t: any) => {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { count: 0, revenue: 0 };
      monthly[key].count++;
      monthly[key].revenue += t.total_amount || 0;
    });

    const chartData = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    const recentApps = [...appsWithOwnership].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10);

    return NextResponse.json({
      totals: {
        tenants: tenants.length,
        apps: apps.length,
        activeApps: activeApps.length,
        expiredApps: expiredApps.length,
        activeSubs: subs.filter(s => s.status === 'active').length,
        revenue,
      },
      dist,
      chartData,
      recentApps,
    });
  } catch (error) {
    console.error('[GET /api/admin/stats] error:', error);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}