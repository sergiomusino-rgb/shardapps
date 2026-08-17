// ─── Data Export + Public API — proxy revoca API key (Fase 10) ────────────
// Stesso pattern di ../route.ts: thin proxy verso backend/routes/api-keys.js.

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const { id, keyId } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/apps/${id}/api-keys/${keyId}/revoke`, {
      method: 'POST',
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[api-keys/revoke] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
