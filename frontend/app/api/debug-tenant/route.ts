import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function GET(req: NextRequest) {
  const steps: Record<string, unknown> = {};

  try {
    steps.supabaseUrl = supabaseUrl ? 'SET' : 'MISSING';
    steps.anonKey = anonKey ? 'SET' : 'MISSING';
    steps.serviceRoleKey = serviceRoleKey ? 'SET' : 'MISSING';

    // 1. Test auth con anon key
    const authClient = createClient<Database>(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const authHeader = req.headers.get('authorization');
    steps.hasAuthHeader = !!authHeader;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: { user }, error } = await authClient.auth.getUser(token);
      steps.authSuccess = !error;
      steps.authError = error?.message || null;
      steps.userId = user?.id || null;
      steps.userEmail = user?.email || null;

      if (user) {
        // 2. Test query tenants con anon key
        const { data: tenants, error: tErr } = await authClient
          .from('tenants')
          .select('id, owner_id, name, plan')
          .eq('owner_id', user.id)
          .limit(5);
        steps.anonQueryTenants = { data: tenants, error: tErr?.message };

        // 3. Test query tenants con service role key
        if (serviceRoleKey) {
          const dbClient = createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data: srTenants, error: srErr } = await dbClient
            .from('tenants')
            .select('id, owner_id, name, plan')
            .eq('owner_id', user.id)
            .limit(5);
          steps.serviceRoleQueryTenants = { data: srTenants, error: srErr?.message };
        }

        // 4. Test query membership
        const { data: memberships, error: mErr } = await authClient
          .from('tenant_members')
          .select('*')
          .eq('user_id', user.id)
          .limit(5);
        steps.memberships = { data: memberships, error: mErr?.message };

        // 5. ALL tenants
        const { data: allTenants, error: allErr } = await authClient
          .from('tenants')
          .select('id, owner_id, name, plan')
          .limit(10);
        steps.allTenants = { data: allTenants, error: allErr?.message };
      }
    }

    return NextResponse.json(steps);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message, steps });
  }
}
