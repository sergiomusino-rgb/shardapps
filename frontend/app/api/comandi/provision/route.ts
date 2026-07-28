// ─── POST /api/comandi/provision ───────────────────────────────────────────
// Wrapper HTTP sottile attorno a provisionComandiAppAction (Server Action),
// necessario perché il backend Express (backend/routes/stripe.js), essendo
// un processo Node separato, non può importare direttamente una Server
// Action Next.js — deve invocarla via rete come qualunque altro servizio.
// Idempotente (vedi comandi-provisioning.ts): sicuro da richiamare più
// volte per lo stesso tenant.

import { NextRequest, NextResponse } from 'next/server';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Non autorizzato' }, { status: 401 });
  }

  const accessToken = authHeader.slice(7);
  const result = await provisionComandiAppAction({ accessToken });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
