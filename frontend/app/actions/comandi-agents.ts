'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Gestione agenti (ruolo 'agent', accesso ridotto: Modalità Agente,
// Catalogo, Clienti) ────────────────────────────────────────────────────────
// Ogni agente è un vero account Supabase Auth (email + password generata),
// non un accesso "senza password": il QR personale (vedi AgentsSection) è
// solo una scorciatoia che precompila l'email nella pagina di login,
// coerente con la scelta di non introdurre un meccanismo di autenticazione
// parallelo — riusa lo stesso login page/flow di owner/admin/member.

function getServiceSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveOwnerOrAdmin(accessToken: string): Promise<{ userId: string; tenantId: string } | { error: string }> {
  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  const supabaseAdmin = getServiceSupabase();

  let userId: string | undefined;
  try {
    const userResult = await supabaseAuth.auth.getUser(accessToken);
    userId = userResult.data.user?.id || undefined;
  } catch (err) {
    console.error('[comandi-agents] Auth error:', err);
  }
  if (!userId) return { error: 'Devi effettuare il login.' };

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = (membership as { tenant_id?: string } | null)?.tenant_id;
  const role = (membership as { role?: string } | null)?.role;
  if (!tenantId) return { error: 'Nessun tenant associato all\'utente.' };
  if (role !== 'owner' && role !== 'admin') {
    return { error: 'Solo il titolare o un amministratore può gestire gli agenti.' };
  }
  return { userId, tenantId };
}

// Password generata lato server, mai scelta dal titolare: mostrata una sola
// volta dopo la creazione/rigenerazione (stesso pattern già in uso per le
// credenziali POS in comandi-provisioning.ts).
function generatePassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16) + 'Aa1!';
}

// ─── Elenco agenti ──────────────────────────────────────────────────────────

const ListAgentsInputSchema = z.object({ accessToken: z.string().min(1) });
export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;

export interface AgentRecord {
  userId: string;
  displayName: string | null;
  email: string;
  createdAt: string;
}

export interface ListAgentsResult {
  success: boolean;
  agents?: AgentRecord[];
  error?: string;
}

export async function listAgentsAction(input: ListAgentsInput): Promise<ListAgentsResult> {
  const validation = ListAgentsInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };

  const resolved = await resolveOwnerOrAdmin(validation.data.accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  // Cast necessario: 'display_name' non è ancora nel tipo Database generato
  // (vedi commento in createAgentAction più sotto).
  const { data: members, error: membersError } = await (supabaseAdmin as any)
    .from('tenant_members')
    .select('user_id, display_name, created_at')
    .eq('tenant_id', resolved.tenantId)
    .eq('role', 'agent')
    .order('created_at', { ascending: false });

  if (membersError) {
    console.error('[listAgentsAction] Errore lettura tenant_members:', membersError);
    return { success: false, error: 'Errore nel caricamento degli agenti' };
  }

  const rows = (members || []) as { user_id: string; display_name: string | null; created_at: string }[];

  // auth.users non è esposta via PostgREST/RLS al client: le email vanno
  // risolte una per una con l'Admin API (service role), non c'è un modo di
  // fare un JOIN diretto da qui.
  const agents: AgentRecord[] = [];
  for (const row of rows) {
    const { data: userResult } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    agents.push({
      userId: row.user_id,
      displayName: row.display_name,
      email: userResult?.user?.email || '(email non disponibile)',
      createdAt: row.created_at,
    });
  }

  return { success: true, agents };
}

// ─── Creazione agente ───────────────────────────────────────────────────────

const CreateAgentInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Il nome è obbligatorio'),
  email: z.string().trim().email('Email non valida'),
  accessToken: z.string().min(1),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export interface CreateAgentResult {
  success: boolean;
  email?: string;
  password?: string;
  error?: string;
}

export async function createAgentAction(input: CreateAgentInput): Promise<CreateAgentResult> {
  const validation = CreateAgentInputSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
  }
  const { displayName, email, accessToken } = validation.data;

  const resolved = await resolveOwnerOrAdmin(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();
  const password = generatePassword();

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !newUser?.user) {
    console.error('[createAgentAction] Errore creazione utente:', createError);
    const message = createError?.message?.includes('already been registered')
      ? 'Esiste già un account con questa email.'
      : 'Errore nella creazione dell\'account agente.';
    return { success: false, error: message };
  }

  // Cast necessario: 'display_name' (migrazione 20260808000008) non è
  // ancora presente nel tipo Database generato (stesso scostamento già
  // visto per altre colonne recenti nel modulo, es. catalog_items.category).
  const { error: memberError } = await (supabaseAdmin as any).from('tenant_members').insert({
    tenant_id: resolved.tenantId,
    user_id: newUser.user.id,
    role: 'agent',
    display_name: displayName,
  });

  if (memberError) {
    console.error('[createAgentAction] Errore creazione membership:', memberError);
    // Rollback: non lasciare un account Auth orfano senza alcuna membership.
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
    return { success: false, error: 'Errore nel collegamento dell\'agente al tenant.' };
  }

  return { success: true, email, password };
}

// ─── Rigenerazione password ─────────────────────────────────────────────────
// Utile se l'agente ha dimenticato la password o se il QR (che precompila
// solo l'email, non la password) è stato smarrito/fotografato da altri: il
// titolare può invalidare la vecchia password in qualsiasi momento.

const RegeneratePasswordInputSchema = z.object({
  agentUserId: z.uuid(),
  accessToken: z.string().min(1),
});
export type RegeneratePasswordInput = z.infer<typeof RegeneratePasswordInputSchema>;

export interface RegeneratePasswordResult {
  success: boolean;
  password?: string;
  error?: string;
}

export async function regenerateAgentPasswordAction(input: RegeneratePasswordInput): Promise<RegeneratePasswordResult> {
  const validation = RegeneratePasswordInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };
  const { agentUserId, accessToken } = validation.data;

  const resolved = await resolveOwnerOrAdmin(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  // Verifica che l'agente appartenga davvero al tenant del chiamante, non ci
  // si fida ciecamente dell'agentUserId ricevuto dal client.
  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', resolved.tenantId)
    .eq('user_id', agentUserId)
    .eq('role', 'agent')
    .maybeSingle();

  if (!membership) {
    return { success: false, error: 'Agente non trovato in questo tenant.' };
  }

  const password = generatePassword();
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(agentUserId, { password });

  if (updateError) {
    console.error('[regenerateAgentPasswordAction] Errore aggiornamento password:', updateError);
    return { success: false, error: 'Errore nella rigenerazione della password.' };
  }

  return { success: true, password };
}

// ─── Rimozione agente ───────────────────────────────────────────────────────
// Elimina sia la membership sia l'account Supabase Auth: una revoca completa
// invece di lasciare un account orfano riutilizzabile, dato che ogni agente
// ha un account dedicato creato apposta (non condiviso con altri usi).

const DeleteAgentInputSchema = z.object({
  agentUserId: z.uuid(),
  accessToken: z.string().min(1),
});
export type DeleteAgentInput = z.infer<typeof DeleteAgentInputSchema>;

export interface DeleteAgentResult {
  success: boolean;
  error?: string;
}

export async function deleteAgentAction(input: DeleteAgentInput): Promise<DeleteAgentResult> {
  const validation = DeleteAgentInputSchema.safeParse(input);
  if (!validation.success) return { success: false, error: 'Dati non validi' };
  const { agentUserId, accessToken } = validation.data;

  const resolved = await resolveOwnerOrAdmin(accessToken);
  if ('error' in resolved) return { success: false, error: resolved.error };

  const supabaseAdmin = getServiceSupabase();

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', resolved.tenantId)
    .eq('user_id', agentUserId)
    .eq('role', 'agent')
    .maybeSingle();

  if (!membership) {
    return { success: false, error: 'Agente non trovato in questo tenant.' };
  }

  const { error: deleteMemberError } = await supabaseAdmin
    .from('tenant_members')
    .delete()
    .eq('tenant_id', resolved.tenantId)
    .eq('user_id', agentUserId);

  if (deleteMemberError) {
    console.error('[deleteAgentAction] Errore rimozione membership:', deleteMemberError);
    return { success: false, error: 'Errore nella rimozione dell\'agente.' };
  }

  const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(agentUserId);
  if (deleteUserError) {
    // La membership è già rimossa (l'accesso al tenant è comunque revocato):
    // l'account Auth orfano non è un problema di sicurezza, solo di
    // pulizia — non blocca l'operazione, solo la loggiamo.
    console.error('[deleteAgentAction] Errore rimozione account Auth (membership già rimossa):', deleteUserError);
  }

  return { success: true };
}
