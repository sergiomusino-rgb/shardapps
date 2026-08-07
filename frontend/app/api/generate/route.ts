// ─── Totalum Generate API Route (Next.js App Router) ───────────────────────────────
// Genera interfacce dinamiche tramite l'API di Totalum con stile ATOMIC DARK
// CON CONTROLlo SLOTS

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Configurazione Totalum
const TOTALUM_API_URL = process.env.TOTALUM_API_URL || 'https://api-accounts.totalum.app';
const TOTALUM_API_KEY = process.env.TOTALUM_API_KEY;

// Configurazione Supabase (Service Role per bypassare RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Log per debug
console.log('[Totalum Next.js] API URL:', TOTALUM_API_URL);
console.log('[Totalum Next.js] API Key presente:', !!TOTALUM_API_KEY);

// ─── Helper: Get user from auth token ───────────────────────────────────────────────
async function getUserFromToken(token: string) {
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

// ─── Helper: Get or create tenant for user (as owner or member) ─────────────────────
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

async function getUserTenant(userId: string) {
  // Prima controlla se è owner
  const { data: ownedTenant } = await supabase
    .from('tenants')
    .select('id, plan, app_limit, total_apps_created')
    .eq('owner_id', userId)
    .single();

  if (ownedTenant) return ownedTenant;

  // Se non è owner, controlla la membership
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (membership) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, plan, app_limit, total_apps_created')
      .eq('id', membership.tenant_id)
      .single();
    return tenant;
  }

  // Se l'utente non ha un tenant, creane uno con 0 slot (deve acquistare un piano)
  // Nota: non possiamo ottenere l'email qui, useremo un valore di default
  const { data: newTenant } = await supabase
    .from('tenants')
    .insert({
      owner_id: userId,
      name: 'Tenant personale',
      slug: `tenant-${userId.slice(0, 8)}`,
      plan: 'free',
      app_limit: 0,
      total_apps_created: 0,
    })
    .select('id, plan, app_limit, total_apps_created')
    .single();

  // Crea la membership
  if (newTenant) {
    await supabase.from('tenant_members').insert({
      tenant_id: newTenant.id,
      user_id: userId,
      role: 'owner',
    });
  }

  return newTenant;
}

// ─── Helper: Check and decrement slots ─────────────────────────────────────────────
async function checkAndDecrementSlots(tenantId: string) {
  // Usa una transazione per evitare race condition
  const { data: tenant, error: fetchError } = await supabase
    .from('tenants')
    .select('app_limit, total_apps_created')
    .eq('id', tenantId)
    .single();

  if (fetchError || !tenant) {
    return { success: false, error: 'Tenant non trovato' };
  }

  const slotsAvailable = tenant.app_limit - tenant.total_apps_created;

  // Controllo slot
  if (slotsAvailable <= 0) {
    return { success: false, error: 'Slot esauriti. Aggiorna il tuo piano per creare nuovi gestionali.' };
  }

  // Decrementa gli slot
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ total_apps_created: tenant.total_apps_created + 1 })
    .eq('id', tenantId);

  if (updateError) {
    return { success: false, error: 'Errore nell\'aggiornamento degli slot' };
  }

  return { success: true };
}

// ─── POST /api/generate ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { userPrompt, appName, sector, lang } = body;
    
    // Validazione input
    if (!userPrompt && !sector) {
      return NextResponse.json({
        success: false,
        error: 'userPrompt o sector è richiesto',
        code: 'MISSING_INPUT'
      }, { status: 400 });
    }
    
    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const user = await getUserFromToken(token);

    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'Utente non autenticato',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    // Verifica API Key
    if (!TOTALUM_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'API Key di Totalum non configurata',
        code: 'API_KEY_NOT_CONFIGURED'
      }, { status: 503 });
    }

    // ─── CONTROLLO SLOTS (solo verifica, non decrementa ancora) ───────────────────────
    // Admin: salta il controllo degli slot
    let tenant = null;
    if (user.id === ADMIN_USER_ID) {
      console.log('[generate] Admin user, skipping slot check');
    } else {
      tenant = await getUserTenant(user.id);
      
      if (!tenant) {
        return NextResponse.json({
          success: false,
          error: 'Nessun tenant associato all\'utente',
          code: 'NO_TENANT'
        }, { status: 403 });
      }

      // Verifica slot disponibili (senza decrementare)
      const slotsAvailable = tenant.app_limit - tenant.total_apps_created;
      if (slotsAvailable <= 0) {
        return NextResponse.json({
          success: false,
          error: 'Slot esauriti. Aggiorna il tuo piano per creare nuovi gestionali.',
          code: 'SLOTS_EXHAUSTED'
        }, { status: 403 });
      }
    }

    // ─── GENERAZIONE PROGETTO ───────────────────────────────────────────────────────
    // Genera projectId univoco
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const projectId = `zeusx-${appName || sector || 'app'}-${timestamp}-${random}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    // Assicura che il projectId inizi con una lettera (requisito Totalum)
    const validProjectId = projectId.replace(/^[^a-z]/, 'z');
    
    // Limita a 35 caratteri
    const finalProjectId = validProjectId.slice(0, 35).replace(/-$/, '');

    // ─── COSTRUZIONE PROMPT MULTILINGUA DINAMICO ────────────────────────────
    const sectorValue = sector || 'gestione aziendale';
    const appNameValue = appName || 'Gestionale';
    
    // Mappa dei nomi lingua per il prompt
    const LANG_NAMES: Record<string, string> = {
      it: 'italiano',
      en: 'inglese',
      fr: 'francese',
      de: 'tedesco',
      es: 'spagnolo',
    };
    
    // Determina la lingua da usare: lang passato dalla UI (selettore), altrimenti 'it'
    const selectedLang = lang && ['it', 'en', 'fr', 'de', 'es'].includes(lang) ? lang : 'it';
    const languageName = LANG_NAMES[selectedLang] || 'italiano';
    
    // Costruisci il System Prompt con la lingua dinamica
    const basePrompt = userPrompt 
      ? `${userPrompt}\n\nSettore: ${sectorValue}\n\nNome app: ${appNameValue}`
      : `Genera un'interfaccia per: ${sectorValue}\n\nNome app: ${appNameValue}`;
    
    const languageDirective = `\n\n⚠️ DIRETTIVA LINGUA OBBLIGATORIA:\nL'intera interfaccia utente dell'applicazione (menu, tabelle, pulsanti, messaggi di errore e dati dimostrativi iniziali) deve essere generata rigorosamente nella lingua associata al codice: "${selectedLang}" (${languageName}). Se il codice è 'de', l'app deve essere in tedesco; se è 'it', in italiano, e così via.`;

    // ─── DIRETTIVA IMPOSTAZIONI AZIENDA DINAMICHE ──────────────────────────
    const companySettingsDirective = `\n\n⚠️ DIRETTIVA IMPOSTAZIONI AZIENDA (VIETATO HARDCODING):\nNon inserire nomi, testi o dati aziendali fissi direttamente nel codice dei componenti. Ogni blueprint deve includere obbligatoriamente una tabella di database globale chiamata 'company_settings' e una pagina 'Impostazioni' (tradotta nella lingua selezionata) nell'app del cliente. Questa pagina deve permettere al cliente finale di modificare liberamente i valori di default: Nome Azienda/Ditta, Logo, Intestazione, Partita IVA e Indirizzo. Tutti i componenti del layout devono leggere questi dati in modo dinamico dal database 'company_settings'.`;

    // ─── DIRETTIVA BRANDING WHITE LABEL ZEUSX ──────────────────────────────
    const brandingDirective = `\n\n⚠️ DIRETTIVA BRANDING WHITE LABEL:\nAssicurati che nel layout dell'applicazione venga inserito correttamente il logo e il branding di ShardApps (nel footer o nella barra laterale con la dicitura "Powered by ShardApps"), verificando che i percorsi degli asset siano validi e vengano renderizzati senza errori.`;

    // Combina il prompt completo
    const fullPrompt = `${basePrompt}${languageDirective}${companySettingsDirective}${brandingDirective}`;

    // Log della lingua selezionata per debug
    console.log('[Totalum] Lingua selezionata per la generazione:', selectedLang, languageName);
    console.log('[Totalum] Prompt completo con direttive:', fullPrompt.substring(0, 200) + '...');

    // Step 1: Crea il progetto su Totalum
    console.log('[Totalum] Creazione progetto:', finalProjectId);

    const createProjectResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': TOTALUM_API_KEY,
      },
      body: JSON.stringify({
        projectId: finalProjectId,
        description: `App generata da ShardApps: ${appNameValue}`
      }),
    });

    const createProjectText = await createProjectResponse.text();
    console.log('[Totalum] Create project response:', createProjectText);

    if (!createProjectResponse.ok) {
      let errorData;
      try {
        errorData = JSON.parse(createProjectText);
      } catch {
        errorData = { errors: { errorMessage: createProjectText } };
      }
      
      return NextResponse.json({
        success: false,
        error: errorData?.errors?.errorMessage || 'Errore nella creazione del progetto',
        code: errorData?.errors?.errorCode || 'CREATE_PROJECT_ERROR',
        details: errorData
      }, { status: createProjectResponse.status });
    }

    // Step 2: Avvia l'agente su Totalum (con retry per BRIDGE_ERROR)
    console.log('[Totalum] Avvio agente per progetto:', finalProjectId);

    let startAgentResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects/${finalProjectId}/agent/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': TOTALUM_API_KEY,
      },
      body: JSON.stringify({
        prompt: fullPrompt
      }),
    });

    let startAgentText = await startAgentResponse.text();
    console.log('[Totalum] Start agent response:', startAgentText);

    // Se è un errore 401 BRIDGE_ERROR, ritenta una volta dopo 3 secondi
    if (!startAgentResponse.ok && startAgentResponse.status === 401) {
      console.log('[Totalum] BRIDGE_ERROR rilevato, attesa 3 secondi e riprovo...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      startAgentResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects/${finalProjectId}/agent/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': TOTALUM_API_KEY,
        },
        body: JSON.stringify({
          prompt: fullPrompt
        }),
      });
      
      startAgentText = await startAgentResponse.text();
      console.log('[Totalum] Retry start agent response:', startAgentText);
    }

    if (!startAgentResponse.ok) {
      let errorData;
      try {
        errorData = JSON.parse(startAgentText);
      } catch {
        errorData = { errors: { errorMessage: startAgentText } };
      }
      
      return NextResponse.json({
        success: false,
        error: errorData?.errors?.errorMessage || "Errore nell'avvio dell'agente",
        code: errorData?.errors?.errorCode || 'START_AGENT_ERROR',
        details: errorData
      }, { status: startAgentResponse.status });
    }

    // Step 3: Decrementa gli slot (dopo conferma API)
    if (tenant && supabase) {
      const { error: updateError } = await supabase
        .from('tenants')
        .update({ total_apps_created: tenant.total_apps_created + 1 })
        .eq('id', tenant.id);

      if (updateError) {
        console.error('[Totalum] Errore aggiornamento slot dopo successo API:', updateError);
      } else {
        console.log(`[Totalum] Slot aggiornato: ${tenant.total_apps_created} -> ${tenant.total_apps_created + 1}`);
      }
    }

    // Step 4: Restituisci URL di reindirizzamento
    const projectUrl = `https://www.totalum.app/projects/${finalProjectId}`;

    return NextResponse.json({
      success: true,
      data: {
        projectId: finalProjectId,
        projectUrl: projectUrl,
        message: 'Progetto creato con successo. L\'agente sta generando l\'interfaccia.'
      }
    });
    
  } catch (err) {
    console.error('[generate] Unexpected error:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}
