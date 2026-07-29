// ============================================================================
// ZeusX - RBAC Types
// ============================================================================

export type AppUserRole = 'admin' | 'agent' | 'viewer' | 'editor' | 'reseller';

export interface AppUser {
  id: string;
  user_id: string;
  app_id: string;
  email: string;
  full_name?: string;
  role: AppUserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Profilo utente con ruolo globale
export interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  full_name?: string;
  role: 'admin' | 'reseller' | 'viewer' | 'editor';
  subscription_plan?: 'free' | 'starter' | 'pro' | 'business';
  created_at: string;
  updated_at: string;
}

// Permessi granulari per tabelle specifiche
export interface TablePermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
}

// Configurazione permessi per ruolo
export interface RolePermissions {
  [tableName: string]: TablePermissions;
}

// Default permissions per ruolo
export const DEFAULT_ROLE_PERMISSIONS: Record<AppUserRole, RolePermissions> = {
  admin: {
    // Admin ha accesso a tutto
    clienti: { read: true, write: true, delete: true },
    prodotti: { read: true, write: true, delete: true },
    ordini: { read: true, write: true, delete: true },
    magazzino: { read: true, write: true, delete: true },
  },
  agent: {
    // Agent può vedere e modificare ordini, vedere prodotti in sola lettura
    ordini: { read: true, write: true, delete: true },
    prodotti: { read: true, write: false, delete: false },
    clienti: { read: true, write: false, delete: false },
    magazzino: { read: false, write: false, delete: false },
  },
  viewer: {
    // Viewer può solo vedere
    clienti: { read: true, write: false, delete: false },
    prodotti: { read: true, write: false, delete: false },
    ordini: { read: true, write: false, delete: false },
    magazzino: { read: true, write: false, delete: false },
  },
  editor: {
    // Editor può modificare dati ma non accedere a impostazioni
    clienti: { read: true, write: true, delete: true },
    prodotti: { read: true, write: true, delete: true },
    ordini: { read: true, write: true, delete: true },
    magazzino: { read: true, write: true, delete: true },
  },
  reseller: {
    // Reseller può gestire le proprie app e visualizzare dati
    clienti: { read: true, write: true, delete: false },
    prodotti: { read: true, write: true, delete: false },
    ordini: { read: true, write: true, delete: false },
    magazzino: { read: true, write: false, delete: false },
  },
};

// Route che richiedono permessi specifici
export const PROTECTED_ROUTES: Record<string, AppUserRole[]> = {
  '/dashboard': ['admin', 'agent', 'viewer', 'editor', 'reseller'],
  '/dashboard/settings': ['admin', 'editor'],
  '/admin': ['admin'],
  '/dashboard/generator': ['admin'],
  '/pricing': ['admin', 'reseller'],
  '/management': ['reseller'],
};

// Verifica se un utente può accedere a una route
export function canAccessRoute(route: string, role: AppUserRole | null): boolean {
  if (!role) return false;
  
  // Route pubbliche
  if (route.startsWith('/a/')) return true;
  
  // Route protette
  const allowedRoles = PROTECTED_ROUTES[route];
  if (allowedRoles) {
    return allowedRoles.includes(role);
  }
  
  // Default: accesso negato
  return false;
}

// Verifica se un utente può eseguire un'azione su una tabella
export function canPerformAction(
  tableName: string,
  action: 'read' | 'write' | 'delete',
  role: AppUserRole | null
): boolean {
  if (!role) return false;
  
  const permissions = DEFAULT_ROLE_PERMISSIONS[role];
  const tablePerms = permissions[tableName];
  
  if (!tablePerms) return false;
  
  return tablePerms[action] === true;
}

// ============================================================================
// Access Control Helper
// ============================================================================

/**
 * Verifica accesso ibrido: ruolo + piano abbonamento
 * @param userRole - Ruolo dell'utente (admin, reseller, etc.)
 * @param userPlan - Piano di abbonamento (free, starter, pro, business)
 * @param requiredRole - Ruolo richiesto per accedere
 * @param requiredPlan - Piano minimo richiesto (opzionale)
 */
export function checkAccess(
  userRole: AppUserRole | null,
  userPlan: string | null,
  requiredRole: AppUserRole | null,
  requiredPlan?: 'pro' | 'business'
): boolean {
  // Se è richiesto un ruolo specifico, verificalo
  if (requiredRole && userRole !== requiredRole) {
    return false;
  }
  
  // Se è richiesto un piano specifico, verificalo
  if (requiredPlan && userPlan) {
    const planHierarchy: Record<string, number> = {
      free: 0,
      starter: 1,
      pro: 2,
      business: 3,
    };
    
    if ((planHierarchy[userPlan] || 0) < planHierarchy[requiredPlan]) {
      return false;
    }
  }
  
  return true;
}