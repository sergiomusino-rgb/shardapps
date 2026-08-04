import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

// Proxy verso backend/routes/client-app.js::PUT /client/apps/:appId/payment-settings
// (stesso pattern di ../business-config/route.ts): il backend fa da unica
// fonte di verità per l'auth client e per il merge in apps.config.paymentSettings.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');

  if (!authHeader) {
    return NextResponse.json({ error: 'Authorization header mancante' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/api/client/apps/${id}/payment-settings`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[payment-settings] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
