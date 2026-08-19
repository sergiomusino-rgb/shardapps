// ─── Data & API — proxy viewer log azioni (Pre-Beta Hardening, Blocco 8) ───
// Thin proxy verso il backend Express (routes/api-keys.js), stesso identico
// pattern di .../api-keys/route.ts: zero logica qui, solo inoltro
// dell'Authorization header — isolamento tenant/app interamente nel backend.

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/apps/${id}/action-logs`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[action-logs] proxy GET error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
