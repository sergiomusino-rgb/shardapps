import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; tableName: string }> }) {
  const { id, tableName } = await params;
  console.log(`[PROXY GET] Chiamata ricevuta per App: ${id}, Tabella: ${tableName}`);
  
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    // Il backend è registrato con prefisso /api nel server.js
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/custom-records/${tableName}`;
    console.log(`[PROXY GET] Inoltro a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Authorization': authHeader },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[custom-records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tableName: string }> }) {
  const { id, tableName } = await params;
  console.log(`[PROXY POST] Chiamata ricevuta per App: ${id}, Tabella: ${tableName}`);

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
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/custom-records/${tableName}`;
    console.log(`[PROXY POST] Inoltro a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[custom-records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}