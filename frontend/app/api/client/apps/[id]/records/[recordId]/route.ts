import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params;
  console.log(`[PROXY PUT] Chiamata ricevuta per App: ${id}, Record: ${recordId}`);

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
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/records/${recordId}`;
    console.log(`[PROXY PUT] Inoltro a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params;
  console.log(`[PROXY DELETE] Chiamata ricevuta per App: ${id}, Record: ${recordId}`);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    // Il backend è registrato con prefisso /api nel server.js
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/records/${recordId}`;
    console.log(`[PROXY DELETE] Inoltro a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader },
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
