import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5005';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const targetUrl = `${BACKEND_URL}/api/client/apps/${id}/users/${userId}`;
    const res = await fetch(targetUrl, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    const result = await res.json();
    return NextResponse.json(result, { status: res.status });
  } catch (err) {
    console.error('[client/users/:userId] proxy DELETE error:', err);
    return NextResponse.json({ error: 'Errore connessione backend' }, { status: 500 });
  }
}
