import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── GET /api/admin/operations — Operations dashboard (Round 2) ────────────
// Punto di ingresso in sola lettura per rendere osservabile ciò che prima
// viveva solo nei log del processo backend: esecuzioni dei job schedulati
// (cron_job_runs, migration 20260827000000 — applicata su questo ambiente
// durante questo stesso hardening, vedi verifica DB nel report finale) e un
// riepilogo minimo del consumo AI (ai_usage, migration 20260826000000).
// Nessuna scrittura, nessuna azione: solo lettura per un admin, stesso
// principio "niente CRM/DevOps enorme" richiesto dal task.
//
// Auth: stesso identico pattern duplicato di ogni altra route /api/admin/*
// esistente (vedi app/api/admin/beta-applications/route.ts) — non un
// refactor verso un helper condiviso, per non toccare route funzionanti.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);

  if (!user) return false;
  if (user.id === ADMIN_USER_ID) return true;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  return profile?.role === 'admin';
}

interface CronJobRunRow {
  job_name: string;
  run_key: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'failed';
  error: string | null;
}

// Job noti eseguiti da backend/scripts/run-scheduled-jobs.js (Render Cron) —
// elencati esplicitamente così un job che smette del tutto di girare
// (nessuna riga affatto, non solo l'ultima fallita) è visibile come "mai
// eseguito" invece di sparire silenziosamente dalla lista.
const KNOWN_JOBS = ['expiry-check', 'workflow-tick'];

export async function GET(request: NextRequest) {
  try {
    if (!(await verifyAdmin(request))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    const [recentRunsRes, aiUsage24hRes, aiUsage30dRes] = await Promise.all([
      // Ultime 50 esecuzioni di QUALUNQUE job, più recenti prima — sufficiente
      // per calcolare "ultimo run per job" lato server sotto e mostrare uno
      // storico corto in UI, senza introdurre un secondo endpoint paginato.
      supabaseAdmin
        .from('cron_job_runs')
        .select('job_name, run_key, started_at, finished_at, status, error')
        .order('started_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('ai_usage')
        .select('cost_usd')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabaseAdmin
        .from('ai_usage')
        .select('cost_usd')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    // cron_job_runs/ai_usage possono mancare su un ambiente dove la migration
    // non è ancora stata applicata: mai un 500 per questo, la dashboard deve
    // restare utile mostrando gli altri dati disponibili (fail soft, stesso
    // principio già seguito da lib/ai-usage.js sui budget mancanti).
    const recentRuns: CronJobRunRow[] = recentRunsRes.error ? [] : (recentRunsRes.data || []);

    const lastRunByJob: Record<string, CronJobRunRow | null> = {};
    for (const jobName of KNOWN_JOBS) {
      lastRunByJob[jobName] = recentRuns.find((r) => r.job_name === jobName) || null;
    }

    const sumCost = (rows: { cost_usd: number | null }[] | null | undefined) =>
      (rows || []).reduce((sum, r) => sum + (typeof r.cost_usd === 'number' ? r.cost_usd : 0), 0);

    // isEmailConfigured/isWebhookConfigured vivono nel backend Express
    // (backend/lib/alerting.js), un progetto npm separato che questa route
    // Next.js non importa (nessun path condiviso, vedi commento in
    // backend/lib/ai-router.js sullo stesso vincolo) — qui si verifica quindi
    // solo la PRECONDIZIONE osservabile da questo processo: le stesse env var
    // che quel modulo controlla, non il modulo stesso.
    const alerting = {
      emailConfigured: !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO),
      webhookConfigured: !!process.env.ALERT_WEBHOOK_URL,
    };

    return NextResponse.json({
      cronJobsMigrationApplied: !recentRunsRes.error,
      jobs: KNOWN_JOBS.map((jobName) => ({ jobName, lastRun: lastRunByJob[jobName] })),
      recentRuns: recentRuns.slice(0, 20),
      aiUsage: {
        migrationApplied: !aiUsage24hRes.error,
        last24hCostUsd: aiUsage24hRes.error ? null : sumCost(aiUsage24hRes.data),
        last24hCalls: aiUsage24hRes.error ? null : (aiUsage24hRes.data || []).length,
        last30dCostUsd: aiUsage30dRes.error ? null : sumCost(aiUsage30dRes.data),
        last30dCalls: aiUsage30dRes.error ? null : (aiUsage30dRes.data || []).length,
      },
      alerting,
    });
  } catch (err) {
    console.error('[GET /api/admin/operations] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
