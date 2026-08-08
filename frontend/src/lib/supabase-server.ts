import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { cookies } from 'next/headers';

export async function createServerSupabase(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  // @supabase/ssr@0.6.0 (installato) non gestisce correttamente il campo
  // `__InternalSupabase` che `supabase gen types` inietta nei tipi generati
  // recenti: il generico <Database> passato a createServerClient collassa a
  // `never` sulle Row. Il cast verso SupabaseClient<Database> (da
  // @supabase/supabase-js, che gestisce correttamente questo caso) restituisce
  // la stessa istanza runtime con la tipizzazione corretta, senza toccare la
  // versione della dipendenza.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Ignora errori in API route read-only
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Ignora errori in API route read-only
          }
        },
      },
    }
  ) as unknown as SupabaseClient<Database>;
}
