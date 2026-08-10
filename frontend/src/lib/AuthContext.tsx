'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AppUser, AppUserRole } from '@/types/rbac';

// ============================================================================
// Supabase Client
// ============================================================================

import { supabaseBrowser } from './supabase-browser';
const supabase = supabaseBrowser;

// Avvia (se non già impostato) il trial di 30 giorni sulla fee di 25€/mese
// dell'owner per questa app — vedi api/a/[slug]/mark-first-login/route.ts.
// Fire-and-forget: un fallimento qui non deve mai bloccare il login.
//
// Fix Finding #7 (audit Fase 4B): la route ora richiede il token della
// sessione Supabase per verificare owner/admin del tenant proprietario —
// va inoltrato come Authorization: Bearer, non basta più lo slug.
function markFirstLogin(slug: string, accessToken: string) {
  fetch(`/api/a/${slug}/mark-first-login`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

// ============================================================================
// Types
// ============================================================================

interface AuthContextType {
  user: AppUser | null;
  role: AppUserRole | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, appId: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

export function AuthProvider({ 
  children, 
  appId,
  slug 
}: { 
  children: React.ReactNode;
  appId?: string;
  slug?: string;
}) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<AppUserRole | null>(null);
  const [loading, setLoading] = useState(true);

  // Inizializza l'utente all'avvio
  useEffect(() => {
    initializeUser();
  }, [appId, slug]);

  const initializeUser = useCallback(async () => {
    setLoading(true);
    
    // Prima controlla se c'è una sessione Supabase
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.user && appId) {
      // Utente Supabase autenticato - carica i suoi dati app_user
      // Cast mirato: frontend/types/database.ts non copre app_users, quindi
      // il client tipizzato risolverebbe qui a `never` come altrove nel
      // progetto (vedi audit tsc).
      const { data: appUserRaw, error } = await supabase
        .from('app_users' as any)
        .select('*')
        .eq('user_id', session.user.id)
        .eq('app_id', appId)
        .eq('is_active', true)
        .single();
      const appUser = appUserRaw as AppUser | null;

      if (!error && appUser) {
        setUser(appUser);
        setRole(appUser.role);
        if (slug) markFirstLogin(slug, session.access_token);
      }
    } else {
      // Controlla la sessione locale (per accesso con password)
      if (slug) {
        const sessionData = localStorage.getItem(`app_session_${slug}`);
        if (sessionData) {
          try {
            const parsed = JSON.parse(sessionData);
            // Per ora, gli utenti con password hanno ruolo 'agent' di default
            // Questo può essere esteso in futuro
            setUser({
              id: 'local',
              user_id: 'local',
              app_id: parsed.appInfo?.id || '',
              email: parsed.email || '',
              role: 'agent',
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            setRole('agent');
          } catch (e) {
            console.error('Error parsing session:', e);
          }
        }
      }
    }
    
    setLoading(false);
  }, [appId, slug]);

  const login = useCallback(async (email: string, password: string, appId: string) => {
    setLoading(true);
    
    // Prima prova l'autenticazione Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      // Se fallisce, potrebbe essere un utente client con password
      // Questo è gestito dal form di login esistente
      throw error;
    }
    
    if (data.session?.user) {
      // Carica i dati app_user
      // Cast mirato: frontend/types/database.ts non copre app_users, quindi
      // il client tipizzato risolverebbe qui a `never` come altrove nel
      // progetto (vedi audit tsc).
      const { data: appUserRaw } = await supabase
        .from('app_users' as any)
        .select('*')
        .eq('user_id', data.session.user.id)
        .eq('app_id', appId)
        .eq('is_active', true)
        .single();
      const appUser = appUserRaw as AppUser | null;

      if (appUser) {
        setUser(appUser);
        setRole(appUser.role);
        if (slug) markFirstLogin(slug, data.session.access_token);
      }
    }

    setLoading(false);
  }, [slug]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRole(null);
    
    // Rimuovi sessione locale
    if (slug) {
      localStorage.removeItem(`app_session_${slug}`);
    }
  }, [slug]);

  const refreshUser = useCallback(async () => {
    await initializeUser();
  }, [initializeUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        loading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// ============================================================================
// Helper per verificare permessi
// ============================================================================

export function usePermissions() {
  const { role } = useAuth();
  
  const canAccess = useCallback((route: string): boolean => {
    if (!role) return false;
    
    // Route pubbliche
    if (route.startsWith('/a/')) return true;
    
    // Route protette
    const PROTECTED_ROUTES: Record<string, AppUserRole[]> = {
      '/dashboard': ['admin', 'agent', 'viewer', 'editor'],
      '/dashboard/settings': ['admin', 'editor'],
      '/admin': ['admin'],
      '/dashboard/generator': ['admin'],
      '/pricing': ['admin'],
    };
    
    const allowedRoles = PROTECTED_ROUTES[route];
    if (allowedRoles) {
      return allowedRoles.includes(role);
    }
    
    return false;
  }, [role]);
  
  const canPerformAction = useCallback(
    (tableName: string, action: 'read' | 'write' | 'delete'): boolean => {
      if (!role) return false;
      
const ROLE_PERMISSIONS: Record<AppUserRole, Record<string, { read: boolean; write: boolean; delete: boolean }>> = {
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
  reseller: {
    clienti: { read: true, write: true, delete: false },
    prodotti: { read: true, write: true, delete: false },
    ordini: { read: true, write: true, delete: false },
    magazzino: { read: true, write: false, delete: false },
  },
};
      
      const tablePerms = ROLE_PERMISSIONS[role]?.[tableName];
      return tablePerms?.[action] ?? false;
    },
    [role]
  );
  
  return { canAccess, canPerformAction, role };
}