import { NextRequest, NextResponse } from 'next/server';

// ─── Proxy: esecuzione azione di entità (Fase 3 CreatorAI) ─────────────────
// Stesso identico pattern di .../records/[recordId]/route.ts (PUT/DELETE):
// inoltra al backend Express, che applica enforcement ruolo + validazione
// transizione di stato (vedi backend/routes/client-app.js, POST
// .../records/:recordId/actions/:actionId).

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string; actionId: string }> }
) {
  const { id, recordId, actionId } = await params;
  console.log(`[PROXY POST action] App: ${id}, Record: ${recordId}, Action: ${actionId}`);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }

    // Il backend è registrato con prefisso /api nel server.js
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/records/${recordId}/actions/${actionId}`;
    console.log(`[PROXY POST action] Inoltro a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[records/actions] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
