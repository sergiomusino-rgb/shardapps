import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { WorkflowSchema, AdminPanelSchema, type Workflow } from '@/src/lib/site-schema';
import { validateUiScope } from './ui-scope.ts';

// ─── Automation — UI minima (Pre-Beta Hardening, Blocco 5) ─────────────────
// Primo (e unico, oggi) punto di scrittura di apps.config.workflows dal
// prodotto: prima di questa route il motore (backend/lib/workflow-model.js/
// event-router.js/action-dispatcher.js — REALE, testato, invariato) era
// raggiungibile solo scrivendo JSON a mano nel database. Questa route non
// duplica alcuna logica del motore: scrive esattamente lo stesso campo
// (apps.config.workflows) con lo stesso schema che il motore già legge
// (WorkflowSchema, src/lib/site-schema.ts) — un secondo sistema di
// automazione non esiste, solo un'interfaccia per l'unico esistente.
//
// Scope volutamente minimo (task esplicito): trigger limitati a
// record.created/record.updated/state.changed, azioni a update_field/
// send_notification/trigger_webhook, al più UNA condizione semplice. Il
// motore supporta anche altri trigger/azioni (schedule.tick, change_state,
// create_related_record, condizioni AND/OR annidate): restano scrivibili
// solo manualmente, questa UI non li espone, coerente con "non un workflow
// builder completo".
//
// Auth: stesso identico pattern di /api/apps/[id]/route.ts (PATCH) — utente
// verificato via JWT (anon client), tenant risolto da tenant_members, ogni
// lettura/scrittura di apps.config filtrata ESPLICITAMENTE per
// .eq('id', appId).eq('tenant_id', tenantId) tramite il client service role.
// Questo doppio filtro, non la sola RLS, è il confine di isolamento tenant
// reale qui (stesso principio già in uso in quella route, non una scelta ad
// hoc di questo file) — un workflow non può mai essere letto/creato/
// modificato per un'app di un altro tenant.

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

// Estrae/valida i workflow già salvati con lo stesso schema difensivo del
// motore: un workflow malformato viene scartato dalla lista mostrata
// all'utente (mai un errore che blocca l'intera pagina), stesso principio di
// backend/lib/workflow-model.js::loadWorkflows.
function parseWorkflows(config: Record<string, unknown> | null): Workflow[] {
  const raw = Array.isArray(config?.workflows) ? config!.workflows : [];
  const parsed: Workflow[] = [];
  for (const w of raw) {
    const result = WorkflowSchema.safeParse(w);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

// Metadati minimi delle entità dell'app (nome/label/campi) per popolare i
// selettori della UI (entità, campo, stato) — derivati dallo stesso
// adminPanel.entities che il motore/l'editor già usano, nessuna nuova fonte
// di verità.
function extractEntityMeta(config: Record<string, unknown> | null) {
  const adminPanel = AdminPanelSchema.safeParse(config?.adminPanel || {});
  if (!adminPanel.success) return [];
  return adminPanel.data.entities.map((e) => ({
    name: e.name,
    label: e.label,
    fields: e.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, states: f.type === 'state' ? f.states : undefined })),
  }));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantForRequest(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const config = await loadAppConfig(auth.adminClient, id, auth.tenantId);
    if (config === null) {
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    return NextResponse.json({
      workflows: parseWorkflows(config),
      entities: extractEntityMeta(config),
    });
  } catch (err) {
    console.error('[GET /api/apps/:id/workflows] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}

// Scope minimo esplicito della UI (task Blocco 5, esteso Round 2 —
// validateUiScope condivisa con PATCH, vedi ./ui-scope.ts): il motore
// ammette anche altri trigger/condizioni annidate profonde, questa route li
// rifiuta APPOSTA per restare fedele a "non un workflow builder completo" —
// non un limite tecnico del motore, una scelta di prodotto di questa fase.

function generateWorkflowId(existing: Workflow[]): string {
  let n = existing.length + 1;
  let candidate = `workflow_${n}`;
  const usedIds = new Set(existing.map((w) => w.id));
  while (usedIds.has(candidate)) {
    n += 1;
    candidate = `workflow_${n}`;
  }
  return candidate;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantForRequest(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body non valido' }, { status: 400 });
    }

    const scopeError = validateUiScope(body as { trigger?: { event?: unknown }; actions?: Array<{ type?: unknown }> });
    if (scopeError) {
      return NextResponse.json({ error: scopeError, code: 'OUT_OF_SCOPE' }, { status: 400 });
    }

    const config = await loadAppConfig(auth.adminClient, id, auth.tenantId);
    if (config === null) {
      return NextResponse.json({ error: 'App non trovata o non autorizzata' }, { status: 404 });
    }

    const existing = parseWorkflows(config);

    const candidate = { ...(body as Record<string, unknown>) };
    delete candidate.id; // generato qui, mai accettato dal client (evita collisioni/override intenzionali)
    if (candidate.enabled === undefined) candidate.enabled = true;

    const parsed = WorkflowSchema.safeParse(candidate);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Workflow non valido', details: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    }

    const workflow: Workflow = { ...parsed.data, id: generateWorkflowId(existing) };
    const updatedWorkflows = [...existing, workflow];
    const updatedConfig = { ...config, workflows: updatedWorkflows };

    // Cast: stesso motivo di /api/apps/[id]/route.ts (PATCH branding) — bypassa
    // la corrispondenza esatta col tipo Update generato per un valore JSONB
    // costruito dinamicamente.
    const { error: updateError } = await auth.adminClient
      .from('apps')
      .update({ config: updatedConfig } as any)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId);

    if (updateError) {
      console.error('[POST /api/apps/:id/workflows] errore salvataggio:', updateError);
      return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
    }

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/apps/:id/workflows] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
