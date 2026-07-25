import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const totalum_app_id = searchParams.get('totalum_app_id');
  
  // Debug: mostra le variabili d'ambiente
  const debug = {
    hasSupabaseUrl: !!supabaseUrl,
    hasServiceKey: !!supabaseServiceKey,
    supabaseUrl: supabaseUrl?.substring(0, 30) + '...',
    totalum_app_id: totalum_app_id,
  };
  
  if (!totalum_app_id) {
    return NextResponse.json({ error: 'totalum_app_id obbligatorio', debug });
  }
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Variabili d\'ambiente mancanti', debug });
  }
  
  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);
  
  // Prova a leggere l'app
  const { data: app, error } = await supabase
    .from('apps')
    .select('id, name, slug, totalum_app_id, client_active, client_subscription_price, stripe_connect_id')
    .eq('totalum_app_id', totalum_app_id)
    .single();
  
  return NextResponse.json({
    debug,
    query: {
      table: 'apps',
      filter: `totalum_app_id = '${totalum_app_id}'`,
    },
    result: app,
    error: error?.message,
  });
}