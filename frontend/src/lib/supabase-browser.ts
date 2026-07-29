import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables - fail fast if missing
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    `[supabase-browser] Missing Supabase environment variables! ` +
    `URL: ${!!supabaseUrl}, Key: ${!!supabaseAnonKey}. ` +
    `Make sure .env.local is properly configured and restart the dev server.`
  );
}

// Singleton pattern per evitare istanze multiple di GoTrueClient
const globalForSupabaseBrowser = globalThis as unknown as { supabaseBrowser: ReturnType<typeof createClient<Database>> };

export const supabaseBrowser = globalForSupabaseBrowser.supabaseBrowser || createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'zeusx-frontend',
    },
  },
});

if (process.env.NODE_ENV !== 'production') globalForSupabaseBrowser.supabaseBrowser = supabaseBrowser;
