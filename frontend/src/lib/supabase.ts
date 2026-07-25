'use client';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Extract project ref from URL for correct storage key
const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)/)?.[1] || 'zeusx';

// Evita la duplicazione in sviluppo (Singleton pattern)
const globalForSupabase = globalThis as unknown as { supabase: ReturnType<typeof createClient> };

export const supabase = globalForSupabase.supabase || createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

if (process.env.NODE_ENV !== 'production') globalForSupabase.supabase = supabase;

export function getAccessTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.access_token || parsed[0] || null;
  } catch {
    return null;
  }
}
