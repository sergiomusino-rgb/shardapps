import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Comandi AI è un'app omaggio inclusa di default per ogni tenant (non
// consuma slot, vedi comandi-provisioning.ts), fatturata comunque 25€/mese
// dopo 30gg di trial tramite lo stesso paywall standard delle altre app.
// Best-effort: se il provisioning fallisce non deve mai far fallire la
// creazione/lookup del tenant, che resta il compito primario di questa
// route. provisionComandiAppAction è idempotente (verifica prima se il
// tenant ha già un'istanza comandi_ai), quindi richiamarla ad ogni accesso
// è sicuro — serve anche a "retro-attivare" Comandi per i tenant esistenti.
async function ensureComandiProvisioned(accessToken: string) {
  try {
    const result = await provisionComandiAppAction({ accessToken });
    if (!result.success) {
      console.error('[API tenants/create] Provisioning Comandi AI non riuscito:', result.error);
    }
  } catch (err) {
    console.error('[API tenants/create] Errore provisioning Comandi AI:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const { data: { user } } = await supabase.auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    const { name, slug } = await req.json();

    if (!name || !slug) {
      return NextResponse.json({ error: 'Nome e slug sono obbligatori' }, { status: 400 });
    }

// Verifica che l'utente abbia già un tenant (tramite owner_id o membership)
    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('owner_id', user.id)
      .single();

    // Se non ha un tenant come owner, controlla la membership
    let existingTenantFromMembership = null;
    if (!existingTenant) {
      const { data: membership } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      
      if (membership) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id, name, slug, plan, app_limit, total_apps_created')
          .eq('id', membership.tenant_id)
          .single();
        existingTenantFromMembership = tenant;
      }
    }

    // Crea il profilo utente se non esiste (anche se ha già un tenant)
    // Usa il service role per bypassare le policy RLS
    const { data: existingProfile, error: profileCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileCheckError && profileCheckError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is expected if profile doesn't exist
      console.error('[API tenants/create] Errore controllo profilo:', profileCheckError);
    }

    if (!existingProfile) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0],
          role: 'admin',
          subscription_plan: 'free',
        });

      if (profileError) {
        console.error('[API tenants/create] Errore creazione profilo:', profileError);
      }
    }

    // Se l'utente ha già un tenant (come owner o tramite membership), ritorna quello
    if (existingTenant) {
      console.log('[API tenants/create] Found existing tenant as owner');
      await ensureComandiProvisioned(token);
      return NextResponse.json({ tenant: existingTenant }, { status: 200 });
    }

    if (existingTenantFromMembership) {
      console.log('[API tenants/create] Found existing tenant via membership');
      await ensureComandiProvisioned(token);
      return NextResponse.json({ tenant: existingTenantFromMembership }, { status: 200 });
    }

    // Crea il tenant con piano free (0 slot di base, l'utente deve acquistare un piano)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        owner_id: user.id,
        name,
        slug,
        plan: 'free',
        app_limit: 0,
        total_apps_created: 0,
      })
      .select()
      .single();

    if (tenantError) {
      console.error('[API tenants/create] Errore creazione tenant:', tenantError);
      return NextResponse.json({ error: 'Impossibile creare il tenant' }, { status: 500 });
    }

    // Crea la membership
    const { error: memberError } = await supabase
      .from('tenant_members')
      .insert({
        tenant_id: tenant.id,
        user_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      console.error('[API tenants/create] Errore creazione membership:', memberError);
    }

    console.log('[API tenants/create] Created new tenant:', tenant.id);
    await ensureComandiProvisioned(token);
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.error('[API tenants/create] Errore:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}