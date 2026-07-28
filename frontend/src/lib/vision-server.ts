// ─── Vision Studio: helper server-side condivisi ───────────────────────────
// Client Supabase (service role) e verifica utente da Bearer token, usati da
// tutte le route Vision (generate-video, concat-videos). Centralizzati qui
// invece che duplicati per route: sono codice di autenticazione/autorizzazione,
// e una divergenza accidentale tra le copie sarebbe un bug di sicurezza.

import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Database } from '@/types/database';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export class VisionConfigError extends Error {}

export function getServiceSupabase() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new VisionConfigError(
      'Supabase non configurato correttamente (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti).'
    );
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
