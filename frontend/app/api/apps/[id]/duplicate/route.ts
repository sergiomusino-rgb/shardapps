// ─── POST /api/apps/[id]/duplicate — Pre-Beta Hardening, Blocco 9 ──────────
// "Crea app da questa app": duplica SOLO la configurazione/progetto
// (config: schema, adminPanel, pages, ui, businessConfig, authConfig,
// workflows, branding) necessaria a far ripartire il Creator con la stessa
// struttura — mai i dati del cliente né alcuna credenziale/riferimento di
// fatturazione. Riusa il MOTORE di creazione già esistente (canCreateApp/
// reserveAppSlot/generateCreatorSlug, src/lib/creator-server.ts — lo stesso
// di /api/creator/publish), non un secondo motore: una app duplicata
// consuma uno slot ed è creata esattamente come una pubblicata da zero,
// solo con `config` preso da un'altra app invece che da una generazione AI.
//
// Costruita per allow-list esplicita, MAI uno spread dell'app sorgente:
// - app_records (dati/record del cliente): mai letta, mai copiata.
// - client_email/client_password/initial_password/client_active/expires_at/
//   client_full_name/client_phone/client_tax_id/client_billing_address/
//   client_notes: mai copiati — la nuova app riceve credenziali proprie,
//   fresche, e l'email di default del CHIAMANTE (non quella del cliente
//   originale, mai nota a questa route).
// - app_credentials/app_rbac_users: mai lette dalla sorgente; la nuova app
//   riceve una password hashata fresca (Blocco 6), un eventuale admin rbac
//   viene ricreato da zero con l'email del chiamante, mai copiato.
// - app_api_keys: mai copiate — la nuova app parte senza alcuna API key.
// - app_action_logs: mai copiati — nessuno storico di audit trasferito.
// - product_id/product_version_id/subscription_status/stripe_*: mai copiati
//   — la nuova app non eredita alcun collegamento di fatturazione/catalogo
//   della sorgente (costruita con un insert ad allow-list, non uno spread).
// - tenant_id: SEMPRE quello del chiamante (mai quello dell'app sorgente,
//   che deve già coincidere — verificato sotto — altrimenti 404): nessun
//   riferimento cross-tenant può mai comparire nella nuova riga.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import type { Database } from '@/types/database';
import { hashPassword } from '@/src/lib/password-hash';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  generateCreatorSlug,
  reserveAppSlot,
  releaseAppSlot,
} from '@/src/lib/creator-server';
import { captureError } from '@/src/lib/error-tracking';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Stessa identica funzione di /api/creator/publish/route.ts (crypto.randomInt,
// non Math.random): è la password reale di primo accesso della nuova app.
function generateClientPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars.charAt(randomInt(chars.length))).join('');
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sourceAppId } = await params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const tenantId = await getOrCreateTenant(supabase, user, token);

    // Isolamento tenant: l'app sorgente DEVE appartenere allo stesso tenant
    // del chiamante — un solo filtro combinato (id + tenant_id), non due
    // query separate, così un id di un'altra agenzia produce sempre lo
    // stesso 404 generico di un id inesistente (mai un 403 che confermi
    // "esiste ma non è tua").
    const { data: sourceApp, error: sourceError } = await supabase
      .from('apps')
      .select('id, tenant_id, name, config, app_type')
      .eq('id', sourceAppId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (sourceError || !sourceApp) {
      return NextResponse.json({ success: false, error: 'App non trovata o non autorizzata', code: 'NOT_FOUND' }, { status: 404 });
    }

    // comandi_ai ha un modello di provisioning strutturalmente diverso (un
    // vero utente Supabase Auth creato ad-hoc, vedi comandi-provisioning.ts):
    // duplicarlo da qui creerebbe un'app orfana senza un account di accesso
    // funzionante. Fuori scope di questa fase, errore chiaro invece di un
    // comportamento silenziosamente rotto.
    if (sourceApp.app_type === 'comandi_ai') {
      return NextResponse.json({ success: false, error: 'Questo tipo di app non supporta la duplicazione', code: 'UNSUPPORTED_APP_TYPE' }, { status: 400 });
    }

    let body: { name?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // Body assente/non JSON: nome di default, non un errore — la
      // duplicazione non richiede alcun input obbligatorio.
    }
    const nameOverride = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null;

    const { allowed, reason, tenant } = await canCreateApp(supabase, tenantId, user.id);
    if (!allowed) {
      if (reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false, error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing', code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      return NextResponse.json({ success: false, error: reason || 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
    }

    // Consumo atomico dello slot — stessa identica RPC di /api/creator/publish:
    // una duplicazione è a tutti gli effetti la creazione di una nuova app,
    // non deve poter aggirare il limite del piano.
    const slotResult = await reserveAppSlot(supabase, tenantId, tenant, user.id);
    if (!slotResult.ok) {
      if (slotResult.reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false, error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing', code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      console.error('[apps/duplicate] reserveAppSlot error:', slotResult.message);
      return NextResponse.json({ success: false, error: 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
    }
    const slotReserved = slotResult.reserved;

    const sourceConfig = (sourceApp.config && typeof sourceApp.config === 'object' ? sourceApp.config : {}) as Record<string, unknown>;
    const newAppName = nameOverride || `${sourceApp.name} (copia)`;
    const sector = typeof sourceConfig.sector === 'string' ? sourceConfig.sector : 'custom';

    // Config duplicata per intero (schema/adminPanel/pages/ui/businessConfig/
    // authConfig/workflows/branding — tutta "progetto", mai dati cliente, che
    // vivono solo in app_records, tabella mai letta qui) con solo il nome
    // aggiornato. authMode sotto legge lo stesso authConfig.enabled già
    // presente in questa config, non un nuovo campo.
    const newConfig: Record<string, unknown> = { ...sourceConfig, appName: newAppName };
    const rawAuthConfig = newConfig.authConfig;
    const authConfig = (rawAuthConfig && typeof rawAuthConfig === 'object' ? rawAuthConfig : {}) as { enabled?: boolean };
    const authMode: 'legacy' | 'rbac' = authConfig.enabled ? 'rbac' : 'legacy';

    const slug = generateCreatorSlug(newAppName, sector);
    const clientPassword = generateClientPassword();
    const hashedClientPassword = await hashPassword(clientPassword);
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    // Email di default del CHIAMANTE (mai quella dell'app sorgente, che è
    // dato del cliente originale e non deve mai comparire sulla nuova app).
    const clientEmail = user.email || `tenant-${user.id.slice(0, 8)}@zeusx.app`;

    const { data: newApp, error: appError } = await supabase
      .from('apps')
      .insert({
        tenant_id: tenantId,
        name: newAppName,
        config: newConfig,
        slug,
        is_active: true,
        status: 'trial',
        trial_ends_at: trialEndsAt,
        client_active: true,
        client_email: clientEmail,
        client_password: hashedClientPassword, // fallback legacy, coerente col resto della piattaforma (Blocco 6)
        auth_mode: authMode,
      } as never)
      .select('id, name, slug')
      .single();

    if (appError || !newApp) {
      console.error('[apps/duplicate] insert error:', appError);
      if (slotReserved) {
        await releaseAppSlot(supabase, tenantId);
      }
      return NextResponse.json({ success: false, error: 'Errore durante la duplicazione: ' + (appError?.message || 'sconosciuto'), code: 'DB_ERROR' }, { status: 500 });
    }

    if (authMode === 'rbac') {
      const { error: rbacError } = await supabase
        .from('app_rbac_users' as any)
        .insert({
          app_id: newApp.id,
          tenant_id: tenantId,
          client_email: clientEmail,
          client_password: hashedClientPassword,
          role: 'admin',
        } as any);
      if (rbacError) {
        console.error('[apps/duplicate] app_rbac_users insert error:', rbacError);
      }
    } else {
      const { error: credError } = await supabase
        .from('app_credentials')
        .upsert({ app_id: newApp.id, client_password: hashedClientPassword }, { onConflict: 'app_id' });
      if (credError) {
        console.error('[apps/duplicate] app_credentials upsert error:', credError);
      }
    }

    return NextResponse.json({
      success: true,
      app: newApp,
      // Unico momento legittimo per restituirla in chiaro (appena generata).
      password: clientPassword,
      clientEmail,
    }, { status: 201 });
  } catch (err) {
    captureError('apps.duplicate', err);
    return NextResponse.json({ success: false, error: 'Errore interno', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
