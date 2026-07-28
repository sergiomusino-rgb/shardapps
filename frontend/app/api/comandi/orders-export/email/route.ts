// ─── Comandi: invio export "Ordini" via email ──────────────────────────────
// POST /api/comandi/orders-export/email  { format: 'csv'|'xlsx', recipientEmail }
// Riusa lo stesso pattern REST diretto verso Resend già in uso in
// app/api/webhooks/stripe/route.ts (notifyAdminTakeover): niente SDK, solo
// fetch con RESEND_API_KEY da env. A differenza di quel caso qui l'allegato
// è reale (base64), non solo un HTML notificativo.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/types/database';
import { buildOrdersExportRows, rowsToCsv, rowsToXlsxBuffer } from '@/src/lib/comandi-orders-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BodySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  recipientEmail: z.email(),
});

async function getUserIdFromBearerToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch (err) {
    console.error('[orders-export-email] Auth error:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return NextResponse.json({ success: false, error: 'Servizio non configurato correttamente.' }, { status: 500 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ success: false, error: 'Invio email non configurato (RESEND_API_KEY mancante).' }, { status: 500 });
  }

  const userId = await getUserIdFromBearerToken(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Autenticazione richiesta.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Richiesta non valida.' }, { status: 400 });
  }

  const validation = BodySchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message || 'Dati non validi' }, { status: 400 });
  }
  const { format, recipientEmail } = validation.data;

  const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = (membership as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ success: false, error: 'Nessun tenant associato all\'utente.' }, { status: 403 });
  }

  const rows = await buildOrdersExportRows(supabaseAdmin, tenantId);

  const filename = format === 'xlsx' ? 'ordini.xlsx' : 'ordini.csv';
  const attachmentContent =
    format === 'xlsx'
      ? rowsToXlsxBuffer(rows).toString('base64')
      : Buffer.from(rowsToCsv(rows), 'utf-8').toString('base64');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ZeusX Comandi <noreply@zeusx.it>',
        to: [recipientEmail],
        subject: 'Esportazione Ordini',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p>In allegato l'esportazione della tabella Ordini (${rows.length} righe).</p>
            <p style="color: #64748b; font-size: 14px; margin-top: 20px;">ZeusX Comandi</p>
          </div>
        `,
        attachments: [{ filename, content: attachmentContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[orders-export-email] Resend error:', res.status, errText);
      return NextResponse.json({ success: false, error: 'Errore durante l\'invio dell\'email.' }, { status: 502 });
    }
  } catch (err) {
    console.error('[orders-export-email] Errore invio email:', err);
    return NextResponse.json({ success: false, error: 'Errore durante l\'invio dell\'email.' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
