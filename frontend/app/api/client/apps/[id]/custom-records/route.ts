import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://shardapps-backend.onrender.com';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  const { searchParams } = new URL(req.url);
  const tableName = searchParams.get('table');

  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  if (!tableName) {
    return NextResponse.json({ error: 'Parametro table mancante' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/client/apps/${id}/custom-records/${tableName}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[custom-records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    const { tableName, data } = body;

    if (!tableName || !data) {
      return NextResponse.json({ error: 'tableName e data obbligatori' }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/api/client/apps/${id}/custom-records/${tableName}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });

    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[custom-records] proxy error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}