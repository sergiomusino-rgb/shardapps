// ─── Creator AI Generate — Status API Route (P0-1, async generation) ───────
// GET /api/creator/generate/status/[jobId] — stato del generation_job creato
// da POST /api/creator/generate. La UI (dashboard/creator/page.tsx) fa
// polling qui finché lo status non è 'ready' o 'failed' — vedi root-cause
// report "async generation / client-server lifecycle mismatch": prima la
// connessione HTTP di /generate restava aperta per l'intera pipeline (fino
// a ~180s), il client la interrompeva mostrando un falso errore mentre il
// server continuava e completava comunque, senza modo per l'utente di
// recuperare il risultato.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getUserFromToken, getOrCreateTenant } from '@/src/lib/creator-server';
import { getGenerationJobForTenant, updateGenerationJob } from '@/src/lib/creator-generation-jobs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

const NON_TERMINAL_STATUSES = new Set(['planning', 'generating', 'validating', 'repairing']);

// P0-3: se un job resta in uno stato non terminale oltre questa soglia, è
// quasi certamente perché l'esecuzione server-side è stata interrotta (un
// limite di piattaforma mai esplicitamente configurato) prima di raggiungere
// ready/failed — mai lasciare la UI in polling indefinito (requisito
// esplicito: "il job deve finire sempre in ready oppure failed, mai restare
// indefinitamente in uno stato intermedio"). Margine ampio sopra il caso
// peggiore teorico della pipeline stessa (invariata) — un timeout di
// OSSERVABILITA' del job, non un timeout AI (AI_ROUTER_TIMEOUT_MS resta
// 30000, invariato).
const STALE_JOB_THRESHOLD_MS = 6 * 60 * 1000;

// Validazione live V4 (preview zeusx-zwu8): risposte di questa route non
// devono mai essere trattenute da una cache intermedia (CDN/proxy Edge) —
// ogni poll deve riflettere lo stato reale e più recente del job. Applicato
// a TUTTE le risposte (anche gli errori), non solo al 200 di successo.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE_HEADERS });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const tenantId = await getOrCreateTenant(supabase, user, token);
    let job = await getGenerationJobForTenant(supabase, jobId, tenantId);
    if (!job) {
      return NextResponse.json({ success: false, error: 'Generazione non trovata', code: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    if (NON_TERMINAL_STATUSES.has(job.status)) {
      const updatedAtMs = new Date(job.updated_at).getTime();
      if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > STALE_JOB_THRESHOLD_MS) {
        try {
          job = await updateGenerationJob(supabase, job.id, {
            status: 'failed',
            current_step: 'stale',
            error: 'La generazione si è interrotta inaspettatamente (nessun aggiornamento da troppo tempo). Riprova.',
          });
        } catch {
          // Se anche questo update fallisce, si restituisce comunque il job
          // così com'è: la UI vedrà ancora uno stato non terminale e
          // ritenterà al prossimo polling — mai un 500 per un problema di
          // sola osservabilità qui.
        }
      }
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      current_step: job.current_step,
      error: job.error,
      appId: job.app_id,
      fallbackUsed: job.fallback_used,
      // Stessa forma della risposta sincrona di prima ({success,data:{schema}})
      // così il consumer frontend può riusare la stessa logica di gestione,
      // presente solo quando lo status è 'ready'.
      ...(job.status === 'ready' ? { data: { schema: job.result_schema } } : {}),
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
