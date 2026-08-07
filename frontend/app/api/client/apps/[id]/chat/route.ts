import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';

// Proxy verso backend/routes/client-app.js::POST /client/apps/:appId/chat
// (stesso pattern di ../business-config/route.ts): il backend fa da unica
// fonte di verità per l'auth client (password legacy o membership Supabase),
// costruisce il contesto (businessConfig/tabelle/record recenti) e chiama
// Groq — la GROQ_API_KEY non viene mai esposta al browser.
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
    const res = await fetch(`${BACKEND_URL}/api/client/apps/${id}/chat`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[client-chat] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
