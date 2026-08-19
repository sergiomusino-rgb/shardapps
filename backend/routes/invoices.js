const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { verifyPassword, hashPassword } = require('../lib/password-hash');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Verifica che il Bearer token (password client in chiaro, stesso schema di
// routes/client-app.js e routes/custom-tables.js) corrisponda a un'app del
// tenant indicato. Usato dalle route sotto che operano su tenant_id/fattura_id
// senza uno slug in URL, per evitare che chiunque possa leggere/scrivere le
// fatture di un tenant arbitrario.
// Pre-Beta Hardening, Blocco 6: verifyPassword riconosce sia un hash bcrypt
// reale sia un valore ancora in chiaro (account legacy) — vedi
// lib/password-hash.js. Un match su un valore in chiaro innesca un rehash
// immediato in app_credentials (stessa tabella preferita da
// getClientCredentials/client-auth.js), mai una migrazione bulk forzata.
async function verifyTenantPassword(supabase, tenantId, token) {
  if (!token) return false;
  const { data: apps } = await supabase
    .from('apps')
    .select('id, client_password')
    .eq('tenant_id', tenantId);
  if (!apps?.length) return false;

  // Vedi backend/routes/client-app.js::getClientCredentials — le password
  // vive ora in app_credentials, con apps.client_password come fallback.
  const { data: creds } = await supabase
    .from('app_credentials')
    .select('app_id, client_password')
    .in('app_id', apps.map((a) => a.id));
  const credsByAppId = new Map((creds || []).map((c) => [c.app_id, c.client_password]));

  for (const app of apps) {
    const stored = credsByAppId.get(app.id) ?? app.client_password;
    const result = await verifyPassword(token, stored);
    if (result.match) {
      if (result.needsRehash) {
        try {
          const hash = await hashPassword(token);
          await supabase.from('app_credentials').upsert({ app_id: app.id, client_password: hash }, { onConflict: 'app_id' });
        } catch (err) {
          console.error('[invoices] rehash tenant password fallito (accesso comunque consentito):', err);
        }
      }
      return true;
    }
  }
  return false;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

// GET /a/:slug/invoices - Recupera tutte le fatture per un tenant
router.get('/a/:slug/invoices', async (req, res) => {
  try {
    const { slug } = req.params;
    const supabase = getSupabase();

    // Find app by slug
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, tenant_id, client_password, client_active, expires_at')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    if (app.client_active === false) {
      return res.status(403).json({ error: 'App bloccata' });
    }

    if (app.expires_at && new Date(app.expires_at) < new Date()) {
      return res.status(403).json({ error: 'App scaduta' });
    }

    const token = getBearerToken(req);
    const verified = await verifyPassword(token, app.client_password);
    if (!verified.match) {
      return res.status(401).json({ error: 'Password errata' });
    }
    if (verified.needsRehash) {
      try {
        const hash = await hashPassword(token);
        await supabase.from('apps').update({ client_password: hash }).eq('id', app.id);
      } catch (err) {
        console.error('[invoices] rehash fallito (accesso comunque consentito):', err);
      }
    }

    // Load invoices from database
    const { data: fatture, error: fattureError } = await supabase
      .from('fatture')
      .select('*')
      .eq('tenant_id', app.tenant_id)
      .order('created_at', { ascending: false });

    if (fattureError) {
      console.error('Errore caricamento fatture:', fattureError);
      return res.status(500).json({ error: 'Errore nel caricamento delle fatture' });
    }

    return res.json({
      fatture: fatture || [],
    });
  } catch (err) {
    console.error('GET /a/:slug/invoices error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /invoices - Crea una nuova fattura con le sue righe
router.post('/invoices', async (req, res) => {
  try {
    const {
      tenant_id,
      anno: annoInput,
      data_emissione,
      cliente_nome,
      cliente_piva,
      cliente_indirizzo,
      stato,
      metodo_pagamento,
      righe,
      tipo_documento,
    } = req.body;

    const tipoDocumento = tipo_documento === 'ricevuta' ? 'ricevuta' : 'fattura';
    const anno = annoInput || new Date().getFullYear();

    if (!tenant_id || !data_emissione || !cliente_nome || !righe || !Array.isArray(righe) || righe.length === 0) {
      return res.status(400).json({ error: 'Campi obbligatori mancanti o righe non valide' });
    }
    // La ricevuta non richiede la P.IVA del cliente (spesso un privato); la
    // fattura sì, per restare un documento fiscale valido.
    if (tipoDocumento === 'fattura' && !cliente_piva) {
      return res.status(400).json({ error: 'La P.IVA/Codice Fiscale del cliente è obbligatoria per una fattura' });
    }

    const supabase = getSupabase();

    if (!(await verifyTenantPassword(supabase, tenant_id, getBearerToken(req)))) {
      return res.status(401).json({ error: 'Password errata' });
    }

    // Numero progressivo reale (mai fidarsi di un numero_fattura passato dal
    // client): conta i documenti dello stesso tenant+tipo+anno e assegna il
    // prossimo, zero-padded. Stessa logica della route Next.js gemella
    // (frontend/app/a/[slug]/api/invoices/route.ts) usata dal form.
    const { count: countEsistenti, error: countError } = await supabase
      .from('fatture')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant_id)
      .eq('tipo_documento', tipoDocumento)
      .eq('anno', anno);

    if (countError) {
      console.error('Errore conteggio fatture per numerazione:', countError);
      return res.status(500).json({ error: 'Errore nella generazione del numero documento' });
    }

    const numeroFattura = String((countEsistenti || 0) + 1).padStart(4, '0');

    // Inserisci la fattura
    const { data: fattura, error: fatturaError } = await supabase
      .from('fatture')
      .insert({
        tenant_id,
        numero_fattura: numeroFattura,
        anno,
        data_emissione,
        cliente_nome,
        cliente_piva,
        cliente_indirizzo,
        stato: stato || 'bozza',
        metodo_pagamento: metodo_pagamento || null,
        tipo_documento: tipoDocumento,
      })
      .select()
      .single();

    if (fatturaError || !fattura) {
      console.error('Errore inserimento fattura:', fatturaError);
      return res.status(500).json({ error: fatturaError?.message || 'Errore creazione fattura' });
    }

    // Inserisci le righe collegate
    const righeDaInserire = righe.map((r) => ({
      fattura_id: fattura.id,
      descrizione: r.descrizione,
      quantita: r.quantita,
      prezzo_unitario: r.prezzo_unitario,
      aliquota_iva: r.aliquota_iva || 22,
    }));

    const { data: righeInserite, error: righeError } = await supabase
      .from('righe_fattura')
      .insert(righeDaInserire)
      .select();

    if (righeError) {
      console.error('Errore inserimento righe fattura:', righeError);
      // Opzionale: elimina la fattura se le righe falliscono
      await supabase.from('fatture').delete().eq('id', fattura.id);
      return res.status(500).json({ error: righeError?.message || 'Errore salvataggio righe' });
    }

    return res.status(201).json({
      success: true,
      fattura,
      righe: righeInserite,
    });
  } catch (err) {
    console.error('POST /api/invoices error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PATCH /invoices/:id - Aggiorna stato fattura
router.patch('/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stato } = req.body;

    if (!stato || !['bozza', 'emessa', 'pagata', 'annullata'].includes(stato)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }

    const supabase = getSupabase();

    const { data: existing, error: existingError } = await supabase
      .from('fatture')
      .select('tenant_id')
      .eq('id', id)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Fattura non trovata' });
    }

    if (!(await verifyTenantPassword(supabase, existing.tenant_id, getBearerToken(req)))) {
      return res.status(401).json({ error: 'Password errata' });
    }

    const { data: fattura, error: fatturaError } = await supabase
      .from('fatture')
      .update({ stato, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (fatturaError || !fattura) {
      console.error('Errore aggiornamento stato fattura:', fatturaError);
      return res.status(500).json({ error: 'Errore aggiornamento stato' });
    }

    return res.json({ success: true, fattura });
  } catch (err) {
    console.error('PATCH /invoices/:id error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /invoices/:id - Recupera fattura con righe
router.get('/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabase();

    const { data: fattura, error: fatturaError } = await supabase
      .from('fatture')
      .select('*')
      .eq('id', id)
      .single();

    if (fatturaError || !fattura) {
      return res.status(404).json({ error: 'Fattura non trovata' });
    }

    if (!(await verifyTenantPassword(supabase, fattura.tenant_id, getBearerToken(req)))) {
      return res.status(401).json({ error: 'Password errata' });
    }

    const { data: righe, error: righeError } = await supabase
      .from('righe_fattura')
      .select('*')
      .eq('fattura_id', id)
      .order('id', { ascending: true });

    if (righeError) {
      console.error('Errore caricamento righe fattura:', righeError);
      return res.status(500).json({ error: righeError?.message || 'Errore caricamento righe' });
    }

    return res.json({
      success: true,
      fattura,
      righe: righe || [],
    });
  } catch (err) {
    console.error('GET /api/invoices/:id error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

module.exports = router;