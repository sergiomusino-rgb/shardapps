// ─── Totalum Generate API Route (Express) ──────────────────────────────────────────
// Genera interfacce dinamiche tramite l'API di Totalum con stile ATOMIC DARK
// CON CONTROLLO SLOTS

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { randomBytes } = require('crypto');
const { getDesignSystemForSector } = require('../utils/designSystemLoader');

// Configurazione Totalum
const TOTALUM_API_URL = process.env.TOTALUM_API_URL || 'https://api-accounts.totalum.app';
const TOTALUM_API_KEY = process.env.TOTALUM_API_KEY;

// Configurazione Supabase (Service Role per bypassare RLS)
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

// Log dell'URL per debug
console.log('[Totalum] API URL:', TOTALUM_API_URL);
console.log('[Totalum] API Key presente:', !!TOTALUM_API_KEY);

// ─── Helper: Get user from auth token ───────────────────────────────────────────────
async function getUserFromToken(token) {
  if (!supabase) {
    throw new Error('Supabase non configurato');
  }
  const { data: { user } } = await supabase.auth.getUser(token);
  return user;
}

// ─── Helper: Get tenant for user (as owner or member) ───────────────────────────────
async function getUserTenant(userId) {
  if (!supabase) {
    return null;
  }
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

  if (!membership) return null;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, plan, app_limit, total_apps_created')
    .eq('id', membership.tenant_id)
    .single();

  return tenant;
}

// ─── Helper: Check and decrement slots ─────────────────────────────────────────────
async function checkAndDecrementSlots(tenantId) {
  if (!supabase) {
    return { success: false, error: 'Supabase non configurato' };
  }
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

router.post('/generate', async (req, res) => {
  try {
    const { userPrompt, appName, sector, lang } = req.body;

    // Validazione input
    if (!userPrompt && !sector) {
      return res.status(400).json({
        success: false,
        error: 'userPrompt o sector è richiesto',
        code: 'MISSING_INPUT'
      });
    }

    // Verifica autenticazione
    const authHeader = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      console.error('[AUTH] Header Authorization mancante o non in formato Bearer');
      return res.status(401).json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'UNAUTHORIZED'
      });
    }

    const token = authHeader.slice(7);
    console.log('[AUTH] Token estratto (primi 20 caratteri):', token.substring(0, 20) + '...');

    // Bug di scope preesistente (segnalato in Fase 5B): "user" era
    // dichiarato con "const" dentro questo blocco try, quindi non
    // raggiungibile dal resto della funzione (getUserTenant(user.id) poco
    // sotto lanciava ReferenceError -> 500 su ogni chiamata reale).
    // Dichiarato qui fuori scope, nessun'altra modifica alla logica.
    let user;
    try {
      user = await getUserFromToken(token);

      if (!user) {
        console.error('[AUTH] Utente non autenticato - token non valido o scaduto');
        return res.status(401).json({
          success: false,
          error: 'Utente non autenticato',
          code: 'UNAUTHORIZED'
        });
      }
      
      console.log('[AUTH] Utente autenticato con successo:', user.id);
    } catch (error) {
      console.error('[AUTH] Errore validazione token:', error.message);
      console.error('[AUTH] Stack trace:', error.stack);
      return res.status(401).json({
        success: false,
        error: 'Errore nella validazione del token',
        code: 'TOKEN_VALIDATION_ERROR',
      });
    }

    // Verifica API Key
    if (!TOTALUM_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'API Key di Totalum non configurata',
        code: 'API_KEY_NOT_CONFIGURED'
      });
    }

    // ─── CONTROLLO SLOTS (solo verifica, non decrementa ancora) ───────────────────────
    const tenant = await getUserTenant(user.id);
    
    if (!tenant) {
      return res.status(403).json({
        success: false,
        error: 'Nessun tenant associato all\'utente',
        code: 'NO_TENANT'
      });
    }

    // Verifica slot disponibili (senza decrementare)
    const slotsAvailable = tenant.app_limit - tenant.total_apps_created;
    if (slotsAvailable <= 0) {
      return res.status(403).json({
        success: false,
        error: 'Slot esauriti. Aggiorna il tuo piano per creare nuovi gestionali.',
        code: 'SLOTS_EXHAUSTED'
      });
    }

    // ─── GENERAZIONE PROGETTO ───────────────────────────────────────────────────────
    // Genera projectId univoco (max 35 caratteri per API Totalum). Suffisso
    // da crypto.randomBytes (Fase 5B, audit Fase 5A): Math.random() non è
    // pensato per essere imprevedibile, e il projectId resta parte
    // dell'URL pubblico della pagina di attesa lato frontend — non deve
    // essere facilmente indovinabile da chi non lo possiede già.
    const ts = Date.now().toString(36).slice(-4);
    const rnd = randomBytes(4).toString('hex');
    const sectorValue = sector || 'app';
    const appNameValue = appName || 'Gestionale';
    const base = `zeusx-${sectorValue}-${ts}${rnd}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // Assicura che il projectId inizi con una lettera (requisito Totalum)
    const validProjectId = base.replace(/^[^a-z]/, 'z');
    const projectId = validProjectId.slice(0, 35).replace(/-$/, '');

    // ─── CARICA DESIGN SYSTEM PER SETTORE ─────────────────────────────────────────
    console.log(`[ShardApps] Caricamento design system per settore: ${sectorValue}`);
    const designSystem = getDesignSystemForSector(sectorValue);
    
    console.log(`[ShardApps] Design system caricato:`, {
      hasDesignContent: !!designSystem.designContent,
      hasDesignTokens: !!designSystem.designTokens,
      primaryColor: designSystem.designTokens?.colors?.primary,
      headlineFont: designSystem.designTokens?.typography?.headline
    });

    // Costruisci il prompt completo con design system iniettato
    const basePrompt = userPrompt || `Genera un'interfaccia per: ${sectorValue}`;
    const fullPrompt = `${basePrompt}\n\nSettore: ${sectorValue}\n\nNome app: ${appNameValue}\n\n${designSystem.systemPrompt}`;

    // Step 1: Crea il progetto su Totalum
    console.log('[Totalum] Creazione progetto:', projectId);

    const createProjectResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': TOTALUM_API_KEY,
      },
      body: JSON.stringify({
        projectId: projectId,
        description: `App generata da ShardApps: ${appNameValue}`
      }),
    });

    if (!createProjectResponse.ok) {
      const createProjectError = await createProjectResponse.text();
      console.error('[Totalum] Create project error:', createProjectError);

      let errorData;
      try {
        errorData = JSON.parse(createProjectError);
      } catch {
        errorData = { errors: { errorMessage: createProjectError } };
      }

      const status = createProjectResponse.status;
      const errorMessage = errorData?.errors?.errorMessage || `Errore nella creazione del progetto (${status})`;
      const errorCode = errorData?.errors?.errorCode || 'CREATE_PROJECT_ERROR';

      if (status === 401) {
        return res.status(401).json({
          success: false,
          error: 'Chiave API non valida',
          message: errorMessage,
          code: 'INVALID_API_KEY',
          details: errorData
        });
      }
      if (status === 409 && errorCode === 'PROJECT_ALREADY_EXISTS') {
        console.log('[Totalum] Progetto già esistente, procedo con l\'avvio agente');
      } else {
        return res.status(status).json({
          success: false,
          error: errorMessage,
          code: errorCode,
          details: errorData
        });
      }
    }

    // Registra SUBITO l'ownership del progetto (Fase 5B, audit Fase 5A):
    // frontend/app/api/generate/status e /project (i due proxy server-side
    // usati per il polling dalla pagina di attesa) devono poter verificare
    // che il projectId richiesto appartenga a chi lo interroga — vedi
    // supabase/migrations/20260810000000_totalum_generation_requests.sql.
    // Best-effort: un fallimento qui non deve bloccare una generazione già
    // avviata (e già a pagamento) su Totalum, ma senza questa riga il
    // polling risponderà 404.
    if (supabase) {
      const { error: ownershipError } = await supabase
        .from('totalum_generation_requests')
        .insert({ project_id: projectId, user_id: user.id, tenant_id: tenant.id });
      if (ownershipError) {
        console.error('[Totalum] Errore registrazione ownership progetto:', ownershipError);
      }
    }

    // Step 2: Avvia l'agente su Totalum (con retry per BRIDGE_ERROR)
    console.log('[Totalum] Avvio agente per progetto:', projectId);
    console.log('[Totalum] URL completo:', `${TOTALUM_API_URL}/api/v1/vcaas/projects/${projectId}/agent/start`);

    // ─── AVVIO AGENTE TOTALUM CON PROMPT MIGLIORATO ───────────────────────────────
    console.log('[ShardApps] Invio prompt a Totalum con design system iniettato');
    console.log('[ShardApps] Lunghezza prompt:', fullPrompt.length, 'caratteri');
    
    const startAgentResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects/${projectId}/agent/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': TOTALUM_API_KEY,
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        metadata: {
          sector: sectorValue,
          appName: appNameValue,
          designSystem: designSystem.designContent ? 'loaded' : 'default',
          primaryColor: designSystem.designTokens?.colors?.primary || '#6366f1',
          headlineFont: designSystem.designTokens?.typography?.headline || 'Inter'
        }
      }),
    });

    console.log('[Totalum] Start agent status:', startAgentResponse.status);
    console.log('[Totalum] Start agent headers:', Object.fromEntries(startAgentResponse.headers.entries()));

    if (!startAgentResponse.ok) {
      const startAgentError = await startAgentResponse.text();
      console.error('[Totalum] Start agent error body:', startAgentError);

      let errorData;
      try {
        errorData = JSON.parse(startAgentError);
      } catch {
        errorData = { errors: { errorMessage: startAgentError } };
      }

      const status = startAgentResponse.status;
      const errorMessage = errorData?.errors?.errorMessage || `Errore nell'avvio dell'agente (${status})`;
      const errorCode = errorData?.errors?.errorCode || 'START_AGENT_ERROR';
      
      // Se è un errore 401 BRIDGE_ERROR, ritenta una volta dopo 3 secondi
      if (status === 401) {
        console.log('[Totalum] BRIDGE_ERROR rilevato, attesa 3 secondi e riprovo...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const retryResponse = await fetch(`${TOTALUM_API_URL}/api/v1/vcaas/projects/${projectId}/agent/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': TOTALUM_API_KEY,
          },
          body: JSON.stringify({
            prompt: fullPrompt
          }),
        });
        
        const retryText = await retryResponse.text();
        console.log('[Totalum] Retry start agent response:', retryText);
        
        if (retryResponse.ok) {
          // Successo al secondo tentativo, continua con il flusso normale
          console.log('[Totalum] Agente avviato con successo al secondo tentativo');
        } else {
          let retryErrorData;
          try {
            retryErrorData = JSON.parse(retryText);
          } catch {
            retryErrorData = { errors: { errorMessage: retryText } };
          }
          
          const retryStatus = retryResponse.status;
          const retryErrorMessage = retryErrorData?.errors?.errorMessage || `Errore nell'avvio dell'agente (${retryStatus})`;
          const retryErrorCode = retryErrorData?.errors?.errorCode || 'START_AGENT_ERROR';

          return res.status(retryStatus).json({
            success: false,
            error: retryErrorMessage,
            code: retryErrorCode,
            details: retryErrorData
          });
        }
      } else {
        return res.status(status).json({
          success: false,
          error: errorMessage,
          code: errorCode,
          details: errorData
        });
      }
    }

    // Step 3: Decrementa gli slot (dopo conferma API)
    if (supabase) {
      const { error: updateError } = await supabase
        .from('tenants')
        .update({ total_apps_created: tenant.total_apps_created + 1 })
        .eq('id', tenant.id);

      if (updateError) {
        console.error('[Totalum] Errore aggiornamento slot dopo successo API:', updateError);
        // Non bloccare la risposta, ma loggiamo l'errore
      } else {
        console.log(`[Totalum] Slot aggiornato: ${tenant.total_apps_created} -> ${tenant.total_apps_created + 1}`);
      }
    }

    // Step 4: Restituisci URL di reindirizzamento con info design system
    const projectUrl = `https://www.totalum.app/projects/${projectId}`;

    return res.json({
      success: true,
      data: {
        projectId: projectId,
        projectUrl: projectUrl,
        message: 'Progetto creato con successo. L\'agente sta generando l\'interfaccia.',
        designSystem: {
          loaded: !!designSystem.designContent,
          primaryColor: designSystem.designTokens?.colors?.primary || '#6366f1',
          headlineFont: designSystem.designTokens?.typography?.headline || 'Inter'
        }
      }
    });

  } catch (err) {
    console.error('[generate] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      error: 'Errore interno del server',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;