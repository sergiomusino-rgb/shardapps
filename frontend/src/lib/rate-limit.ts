import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { Database } from '@/types/database';

// ─── Rate limiting applicativo ──────────────────────────────────────────────
// Copre le route non protette dall'unica regola disponibile sul piano Vercel
// Firewall (usata per /api/creator/generate). Contatore atomico via RPC
// Postgres (check_rate_limit, vedi migrazione 20260808000002).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let adminClient: ReturnType<typeof createClient<Database>> | null = null;
function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/** `key` deve già includere il prefisso/namespace della route chiamante
 * (es. `chat:${userId}`) per non condividere il bucket con altri limiter. */
export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number
): Promise<RateLimitResult> {
  const { data, error } = await getAdminClient().rpc('check_rate_limit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });

  if (error) {
    // Un errore nel controllo del rate limit non deve bloccare l'utente
    // legittimo: si fallisce aperti (allowed) e si logga per indagare.
    console.error('[rate-limit] check_rate_limit error:', error);
    return { allowed: true, remaining: maxRequests };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: Boolean(row?.allowed), remaining: Number(row?.remaining ?? 0) };
}

/** IP del client dietro il proxy Vercel (x-forwarded-for: client, proxy1, proxy2...). */
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
