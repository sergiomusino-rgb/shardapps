/**
 * ZeusX - Database Types
 * Tipi TypeScript per le tabelle Supabase
 */

// App Status enum
export type AppStatus = 'trial' | 'active' | 'past_due' | 'canceled';

// Plan type
export type Plan = 'starter' | 'pro' | 'business';

// Tabella apps - con i nuovi campi per Stripe Managed Payments
export interface App {
  id: string; // UUID
  tenant_id: string; // UUID
  blueprint_id: string | null; // UUID
  name: string;
  config: Record<string, unknown>;
  trial_ends_at: string | null; // TIMESTAMPTZ
  is_active: boolean;
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
  
  // Nuovi campi per Milestone 2 - Reseller/White-label checkout
  stripe_connect_id: string | null; // ID account Stripe Connect del proprietario
  client_price: number; // Prezzo totale impostato dal reseller (default 25.00)
  zeusx_fee: number; // Quota fissa mensile ZeusX (default 25.00)
  stripe_subscription_id: string | null; // ID subscription Stripe legato alla singola app
  totalum_app_id: string | null; // ID app generata da Totalum
  status: AppStatus; // Stato: trial, active, past_due, canceled (default 'trial')
  trial_start: string | null; // TIMESTAMPTZ - inizio prova
  trial_end: string | null; // TIMESTAMPTZ - fine prova
  production_url: string | null; // https://zeusx-app-mrpcz95k-188oie.totalum-project.com
}

// Tabella tenants
export interface Tenant {
  id: string; // UUID
  owner_id: string; // UUID
  name: string;
  slug: string;
  plan: string;
  app_limit: number;
  total_apps_created: number;
  vat_number: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
}

// Tabella profiles
export interface Profile {
  id: string; // UUID
  user_id: string; // UUID
  email: string | null;
  full_name: string | null;
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
}

// Tabella subscriptions
export interface Subscription {
  id: string; // UUID
  tenant_id: string; // UUID
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_start: string | null; // TIMESTAMPTZ
  current_period_end: string | null; // TIMESTAMPTZ
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
}

// Tabella app_registry (per Management Console)
export interface AppRegistry {
  id: string; // UUID
  reseller_id: string; // UUID
  app_name: string;
  app_url: string;
  status: string;
  monthly_fee: number;
  zeusx_share: number;
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
}

// Tabella blueprints
export interface Blueprint {
  id: string; // UUID
  sector: string;
  display_name: string;
  description: string;
  schema: Record<string, unknown>;
  ui_config: Record<string, unknown>;
  created_at: string | null; // TIMESTAMPTZ
  updated_at: string | null; // TIMESTAMPTZ
}

// Input types per le operazioni di inserimento
export interface NewApp {
  tenant_id: string;
  blueprint_id?: string | null;
  name: string;
  config?: Record<string, unknown>;
  stripe_connect_id?: string | null;
  client_price?: number;
  zeusx_fee?: number;
  stripe_subscription_id?: string | null;
  totalum_app_id?: string | null;
  status?: AppStatus;
  trial_start?: string | null;
  trial_end?: string | null;
}

// Input types per le operazioni di update
export interface UpdateApp {
  name?: string;
  config?: Record<string, unknown>;
  is_active?: boolean;
  stripe_connect_id?: string | null;
  client_price?: number;
  zeusx_fee?: number;
  stripe_subscription_id?: string | null;
  totalum_app_id?: string | null;
  status?: AppStatus;
  trial_start?: string | null;
  trial_end?: string | null;
}

// Database type for Supabase client
export interface Database {
  public: {
    Tables: {
      apps: {
        Row: App;
        Insert: NewApp;
        Update: UpdateApp;
      };
      tenants: {
        Row: Tenant;
        Insert: Omit<Tenant, 'id' | 'created_at' | 'updated_at'> & { total_apps_created?: number };
        Update: Partial<Omit<Tenant, 'id' | 'created_at' | 'updated_at'>>;
      };
      profiles: {
        Row: Profile & { role?: string; subscription_plan?: string };
        Insert: Omit<Profile, 'id' | 'created_at' | 'updated_at'> & { role?: string; subscription_plan?: string };
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>> & { role?: string; subscription_plan?: string };
      };
      subscriptions: {
        Row: Subscription;
        Insert: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Subscription, 'id' | 'created_at' | 'updated_at'>>;
      };
      app_registry: {
        Row: AppRegistry;
        Insert: Omit<AppRegistry, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AppRegistry, 'id' | 'created_at' | 'updated_at'>>;
      };
      tenant_members: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: string;
          created_at: string | null;
        };
        Insert: {
          tenant_id: string;
          user_id: string;
          role?: string;
        };
        Update: {
          role?: string;
        };
      };
      app_users: {
        Row: {
          id: string;
          user_id: string;
          app_id: string;
          email: string;
          full_name?: string;
          role: 'admin' | 'agent' | 'viewer' | 'editor' | 'reseller';
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          app_id: string;
          email: string;
          full_name?: string;
          role?: 'admin' | 'agent' | 'viewer' | 'editor' | 'reseller';
          is_active?: boolean;
        };
        Update: {
          email?: string;
          full_name?: string;
          role?: 'admin' | 'agent' | 'viewer' | 'editor' | 'reseller';
          is_active?: boolean;
        };
      };
      blueprints: {
        Row: Blueprint;
        Insert: Omit<Blueprint, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Blueprint, 'id' | 'created_at' | 'updated_at'>>;
      };
    };
    Views: {};
    Functions: {};
  };
}