// API routes per App Registry - Management Console
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Middleware per autenticazione
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token di autorizzazione richiesto' });
  }
  next();
}

// GET /api/app-registry - Lista app del rivenditore con totale ZEUSX
router.get('/app-registry', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    
    // Verifica l'utente
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const resellerId = user.id;

    // Chiama la funzione SQL per ottenere app con totale
    const { data, error } = await supabase.rpc('get_reseller_apps_with_total', {
      p_reseller_id: resellerId
    });

    if (error) {
      console.error('get_reseller_apps_with_total error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    // Estrai il totale dalla prima riga (è lo stesso per tutte)
    const totalZeusxDue = data && data.length > 0 ? data[0].total_zeusx_due : 0;

    return res.json({
      apps: data || [],
      total_zeusx_due: totalZeusxDue
    });
  } catch (err) {
    console.error('/api/app-registry error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/app-registry/:id - Dettaglio singola app
router.get('/app-registry/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from('app_registry')
      .select('*')
      .eq('id', id)
      .eq('reseller_id', user.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    return res.json({ app: data });
  } catch (err) {
    console.error('/api/app-registry/:id error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/app-registry - Registra nuova app
router.post('/app-registry', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const { app_name, app_url, monthly_fee, zeusx_share, status = 'active' } = req.body;

    // Validazione
    if (!app_name || !app_url) {
      return res.status(400).json({ error: 'app_name e app_url sono obbligatori' });
    }

    const { data, error } = await supabase
      .from('app_registry')
      .insert({
        reseller_id: user.id,
        app_name,
        app_url,
        monthly_fee: monthly_fee || 0,
        zeusx_share: zeusx_share || 0,
        status
      })
      .select()
      .single();

    if (error) {
      console.error('app_registry insert error:', error);
      return res.status(500).json({ error: 'Errore interno' });
    }

    return res.status(201).json({ app: data });
  } catch (err) {
    console.error('/api/app-registry POST error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// PATCH /api/app-registry/:id - Aggiorna app
router.patch('/app-registry/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const { id } = req.params;
    const { app_name, app_url, monthly_fee, zeusx_share, status } = req.body;

    const { data, error } = await supabase
      .from('app_registry')
      .update({
        app_name,
        app_url,
        monthly_fee,
        zeusx_share,
        status
      })
      .eq('id', id)
      .eq('reseller_id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Errore interno' });
    }

    return res.json({ app: data });
  } catch (err) {
    console.error('/api/app-registry PATCH error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// DELETE /api/app-registry/:id - Rimuovi app
router.delete('/app-registry/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const token = authHeader.replace('Bearer ', '');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Utente non autenticato' });
    }

    const { id } = req.params;

    const { error } = await supabase
      .from('app_registry')
      .delete()
      .eq('id', id)
      .eq('reseller_id', user.id);

    if (error) {
      return res.status(500).json({ error: 'Errore interno' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('/api/app-registry DELETE error:', err);
    res.status(500).json({ error: 'Errore interno' });
  }
});

module.exports = router;