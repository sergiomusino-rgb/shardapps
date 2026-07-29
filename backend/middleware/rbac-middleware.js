// ============================================================================
// RBAC Middleware per ZeusX
// Controllo accessi in base al ruolo utente
// ============================================================================

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Permessi per ruolo
const ROLE_PERMISSIONS = {
  admin: {
    clienti: { read: true, write: true, delete: true },
    prodotti: { read: true, write: true, delete: true },
    ordini: { read: true, write: true, delete: true },
    magazzino: { read: true, write: true, delete: true },
  },
  agent: {
    ordini: { read: true, write: true, delete: true },
    prodotti: { read: true, write: false, delete: false },
    clienti: { read: true, write: false, delete: false },
    magazzino: { read: false, write: false, delete: false },
  },
  viewer: {
    clienti: { read: true, write: false, delete: false },
    prodotti: { read: true, write: false, delete: false },
    ordini: { read: true, write: false, delete: false },
    magazzino: { read: true, write: false, delete: false },
  },
  editor: {
    clienti: { read: true, write: true, delete: true },
    prodotti: { read: true, write: true, delete: true },
    ordini: { read: true, write: true, delete: true },
    magazzino: { read: true, write: true, delete: true },
  },
};

// Verifica se l'utente ha il permesso di eseguire un'azione su una tabella
function checkTablePermission(tableName, action, role) {
  if (!role) return false;
  const tablePerms = ROLE_PERMISSIONS[role]?.[tableName];
  return tablePerms ? tablePerms[action] === true : false;
}

// Middleware per verificare i permessi su operazioni CRUD
function rbacMiddleware(action) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }

    const password = authHeader.substring(7);
    const { appId } = req.params;
    const { table } = req.query || req.body || {};

    const supabase = getSupabase();

    // Verifica app
    const { data: app, error } = await supabase
      .from('apps')
      .select('id, tenant_id, client_password')
      .eq('id', appId)
      .single();

    if (error || !app) {
      return res.status(404).json({ error: 'App non trovata' });
    }

    // Verifica password
    if (app.client_password !== password) {
      return res.status(401).json({ error: 'Password errata' });
    }

    // Per ora, gli utenti con password hanno ruolo 'agent' di default
    // In futuro si può aggiungere supporto per ruoli specifici
    const userRole = 'agent';

    // Verifica permessi: senza 'table' non c'è nulla da autorizzare, quindi si
    // nega (default-deny) invece di lasciar passare la richiesta — prima
    // bastava omettere 'table' per bypassare completamente il controllo.
    if (!table || !checkTablePermission(table, action, userRole)) {
      return res.status(403).json({
        error: table
          ? `Accesso negato: ruolo '${userRole}' non può ${action} sulla tabella '${table}'`
          : `Accesso negato: parametro 'table' mancante`
      });
    }

    req.tenantId = app.tenant_id;
    req.appId = appId;
    req.userRole = userRole;
    next();
  };
}

// Middleware specifici per ogni azione
const rbacRead = rbacMiddleware('read');
const rbacWrite = rbacMiddleware('write');
const rbacDelete = rbacMiddleware('delete');

module.exports = {
  rbacRead,
  rbacWrite,
  rbacDelete,
  checkTablePermission,
  ROLE_PERMISSIONS,
};