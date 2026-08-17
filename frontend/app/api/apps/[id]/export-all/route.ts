// ─── Data Export + Public API — proxy export completo (Fase 9/10) ─────────
// Thin proxy verso backend/routes/api-keys.js GET .../export-all: inoltra lo
// stream binario dello ZIP così com'è (nessun buffering completo qui, lo
// stesso principio di streaming applicato lato backend con archiver).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/apps/${id}/export-all`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (!backendRes.ok) {
      // Il backend risponde JSON sugli errori (404/500 ecc.), lo ZIP solo su 200.
      const data = await backendRes.json().catch(() => ({ error: 'Errore export' }));
      return NextResponse.json(data, { status: backendRes.status });
    }

    return new NextResponse(backendRes.body, {
      status: 200,
      headers: {
        'Content-Type': backendRes.headers.get('content-type') || 'application/zip',
        'Content-Disposition': backendRes.headers.get('content-disposition') || 'attachment; filename="shardapps-export.zip"',
      },
    });
  } catch (err) {
    console.error('[export-all] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
