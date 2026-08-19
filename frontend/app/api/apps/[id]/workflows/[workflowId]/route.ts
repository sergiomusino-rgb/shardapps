import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { WorkflowSchema, type Workflow } from '@/src/lib/site-schema';
import { validateUiScope } from '../ui-scope.ts';

// ─── Automation — UI minima (Pre-Beta Hardening, Blocco 5 + Round 2) ───────
// PATCH: due modalità, distinte dalla forma del body —
// - { enabled: boolean } SOLO: toggle rapido (comportamento originale,
//   invariato — usato dal pulsante Attiva/Disattiva della lista).
// - body con "trigger" e/o "actions": modifica completa (Round 2 — prima
//   l'unico modo per cambiare un workflow era eliminarlo e ricrearlo).
//   Stessa validazione di scope/schema di POST (validateUiScope +
//   WorkflowSchema, condivisa via ../ui-scope.ts): un workflow modificato non
//   può mai uscire dal vocabolario ammesso da questa UI, esattamente come uno
//   creato da zero.
// DELETE: rimuove un workflow.
// Stesso identico pattern di autenticazione/isolamento tenant di
// ../route.ts (GET/POST) — duplicato qui invece che condiviso in un modulo a
// parte per restare coerente con lo stile già in uso nelle altre route
// /api/apps/[id]/* di questo repo (ognuna con la propria copia locale del
// pattern auth, vedi anche /api/apps/[id]/route.ts).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function resolveTenantForRequest(req: NextRequest): Promise<
  | { ok: true; tenantId: string; adminClient: ReturnType<typeof createClient<Database>> }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get('authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return { ok: false, status: 401, error: 'Non autorizzato' };
  }

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return { ok: false, status: 401, error: 'Non autorizzato' };
  }

  const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: memberships } = await adminClient
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1);

  const tenantId = memberships?.[0]?.tenant_id;
  if (!tenantId) {
    return { ok: false, status: 404, error: 'Tenant non trovato' };
  }

  return { ok: true, tenantId, adminClient };
}

async function loadAppConfig(adminClient: ReturnType<typeof createClient<Database>>, appId: string, tenantId: string) {
  const { data } = await adminClient
    .from('apps')
    .select('config')
    .eq('id', appId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data?.config as Record<string, unknown> | null) || null;
}

function parseWorkflows(config: Record<string, unknown> | null): Workflow[] {
  const raw = Array.isArray(config?.workflows) ? config!.workflows : [];
  const parsed: Workflow[] = [];
  for (const w of raw) {
    const result = WorkflowSchema.safeParse(w);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

async function saveWorkflows(
  adminClient: ReturnType<typeof createClient<Database>>,
  appId: string,
  tenantId: string,
  config: Record<string, unknown>,
  workflows: Workflow[]
) {
  const updatedConfig = { ...config, workflows };
  // Cast: stesso motivo di /api/apps/[id]/route.ts (PATCH branding).
  return adminClient
    .from('apps')
    .update({ config: updatedConfig } as any)
    .eq('id', appId)
    .eq('tenant_id', tenantId);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; workflowId: string }> }
) {
  try {
    const auth = await resolveTenantForRequest(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id, workflowId } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body non valido' }, { status: 400 });
    }

    const config = await loadAppConfig(auth.adminClient, id, auth.tenantId);
    if (config === null) {
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    const existing = parseWorkflows(config);
    const target = existing.find((w) => w.id === workflowId);
    if (!target) {
      return NextResponse.json({ error: 'Workflow non trovato' }, { status: 404 });
    }

    const bodyObj = body as Record<string, unknown>;
    const isFullEdit = 'trigger' in bodyObj || 'actions' in bodyObj;

    let updatedWorkflow: Workflow;
    if (!isFullEdit) {
      // Toggle rapido: unico campo ammesso in questa modalità è "enabled".
      const enabled = bodyObj.enabled;
      if (typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'Campo "enabled" (boolean) richiesto per il toggle rapido, oppure invia "trigger"/"actions" per una modifica completa' }, { status: 400 });
      }
      updatedWorkflow = { ...target, enabled };
    } else {
      // Modifica completa (Round 2): stessa identica validazione di POST —
      // un workflow modificato resta nello stesso vocabolario di uno creato
      // da zero, mai un modo per aggirare lo scope della UI passando per PATCH.
      const scopeError = validateUiScope(bodyObj as { trigger?: { event?: unknown }; actions?: Array<{ type?: unknown }> });
      if (scopeError) {
        return NextResponse.json({ error: scopeError, code: 'OUT_OF_SCOPE' }, { status: 400 });
      }
      const candidate: Record<string, unknown> = { ...bodyObj, id: workflowId };
      if (candidate.enabled === undefined) candidate.enabled = target.enabled;
      const parsed = WorkflowSchema.safeParse(candidate);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Workflow non valido', details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
      }
      updatedWorkflow = parsed.data;
    }

    const updated = existing.map((w) => (w.id === workflowId ? updatedWorkflow : w));
    const { error: updateError } = await saveWorkflows(auth.adminClient, id, auth.tenantId, config, updated);
    if (updateError) {
      console.error('[PATCH /api/apps/:id/workflows/:workflowId] errore salvataggio:', updateError);
      return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
    }

    return NextResponse.json({ workflow: updatedWorkflow });
  } catch (err) {
    console.error('[PATCH /api/apps/:id/workflows/:workflowId] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; workflowId: string }> }
) {
  try {
    const auth = await resolveTenantForRequest(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id, workflowId } = await params;

    const config = await loadAppConfig(auth.adminClient, id, auth.tenantId);
    if (config === null) {
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    const existing = parseWorkflows(config);
    if (!existing.some((w) => w.id === workflowId)) {
      return NextResponse.json({ error: 'Workflow non trovato' }, { status: 404 });
    }

    const updated = existing.filter((w) => w.id !== workflowId);
    const { error: updateError } = await saveWorkflows(auth.adminClient, id, auth.tenantId, config, updated);
    if (updateError) {
      console.error('[DELETE /api/apps/:id/workflows/:workflowId] errore salvataggio:', updateError);
      return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/apps/:id/workflows/:workflowId] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
