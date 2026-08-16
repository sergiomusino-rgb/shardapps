// ─── Creator AI Rollback API Route (Next.js App Router) ────────────────────
// CreatorAI Engine 2.0, Fase 6 — azione umana ESPLICITA e separata dal
// publish gate (mai automatica, mai invocata da generate/refactor): ripristina
// apps.config a uno snapshot precedente (app_versions, vedi
// frontend/src/lib/app-versions.ts). Stesso pattern auth/tenant delle altre
// route creator/* (getUserFromToken + getOrCreateTenant), nessuna logica di
// dominio qui — solo bookkeeping HTTP attorno a app-versions.ts.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getUserFromToken, getOrCreateTenant } from '@/src/lib/creator-server';
import { listAppVersions, rollbackAppVersion } from '@/src/lib/app-versions';
import { captureError } from '@/src/lib/error-tracking';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

async function authenticate(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  const token = authHeader.slice(7);
  const user = await getUserFromToken(supabase, token);
  if (!user) {
    return { error: NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  const tenantId = await getOrCreateTenant(supabase, user, token);
  return { user, tenantId };
}

// ─── GET /api/creator/rollback?appId=... — cronologia versioni di un'app ───
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if ('error' in auth) return auth.error;

    const appId = request.nextUrl.searchParams.get('appId');
    if (!appId) {
      return NextResponse.json({ success: false, error: 'appId è richiesto', code: 'MISSING_INPUT' }, { status: 400 });
    }

    const versions = await listAppVersions(supabase, appId, auth.tenantId);
    return NextResponse.json({ success: true, data: { versions } });
  } catch (err) {
    captureError('creator.rollback.list', err, { url: request.url });
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// ─── POST /api/creator/rollback — ripristina apps.config a una versione ────
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Body della richiesta non è JSON valido', code: 'INVALID_JSON' }, { status: 400 });
    }
    const { appId, versionId } = body;
    if (!appId || typeof appId !== 'string' || !versionId || typeof versionId !== 'string') {
      return NextResponse.json({ success: false, error: 'appId e versionId sono richiesti', code: 'MISSING_INPUT' }, { status: 400 });
    }

    const auth = await authenticate(request);
    if ('error' in auth) return auth.error;

    const result = await rollbackAppVersion(supabase, {
      versionId,
      appId,
      tenantId: auth.tenantId,
      createdBy: auth.user.id,
    });

    if (!result.ok) {
      // Stessa risposta per "versione inesistente" e "versione di un'altra
      // app/tenant" (VERSION_NOT_FOUND/APP_MISMATCH): mai confermare al
      // chiamante che una versione altrui esiste, stesso principio già
      // usato da getGenerationJobForTenant (Fase 5).
      return NextResponse.json({ success: false, error: 'Versione non trovata', code: 'VERSION_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { appId: result.appId, config: result.restoredConfig } });
  } catch (err) {
    captureError('creator.rollback', err, { url: request.url });
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
