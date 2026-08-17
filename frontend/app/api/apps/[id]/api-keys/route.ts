// ─── Data Export + Public API — proxy gestione API key (Fase 10) ──────────
// Thin proxy verso il backend Express (routes/api-keys.js), stesso identico
// pattern già in uso per .../custom-tables, .../records ecc. (vedi
// app/api/client/apps/[id]/records/route.ts): zero logica qui, solo inoltro
// dell'Authorization header (JWT Supabase del proprietario) — l'isolamento
// tenant/app e la generazione/hash della chiave restano interamente nel
// backend, un solo motore, nessuna duplicazione.

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/apps/${id}/api-keys`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[api-keys] proxy GET error:', err);
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
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }

    const res = await fetch(`${BACKEND_URL}/api/apps/${id}/api-keys`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[api-keys] proxy POST error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
