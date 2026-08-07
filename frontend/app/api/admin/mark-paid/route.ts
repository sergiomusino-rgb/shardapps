import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ============================================================================
// Supabase Admin Client
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

// Admin user ID
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

// ============================================================================
// Helper: Verify admin
// ============================================================================

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  
  if (!user) return false;
  
  // Check if user is admin by ID
  if (user.id === ADMIN_USER_ID) return true;
  
  // Check if user has admin role in profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  
  return profile?.role === 'admin';
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Verify admin
    if (!await verifyAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { resellerId } = body;

    if (!resellerId) {
      return NextResponse.json(
        { error: 'resellerId is required' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.rpc('mark_reseller_transactions_paid', {
      p_reseller_id: resellerId
    });

    if (error) {
      console.error('[admin/mark-paid] Supabase error:', error);
      return NextResponse.json(
        { error: 'Errore nell\'aggiornamento' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking transactions as paid:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}