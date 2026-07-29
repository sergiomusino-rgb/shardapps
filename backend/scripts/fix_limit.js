const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const tenantId = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

  // Stato attuale
  const { data: current } = await supabase
    .from('tenants')
    .select('id, plan, app_limit')
    .eq('id', tenantId)
    .single();
  console.log('PRIMA:', current);

  // Fix app_limit in base al piano
  const limitMap = { starter: 1, pro: 5, business: 100 };
  const newLimit = limitMap[current?.plan] || 1;

  const { data: updated } = await supabase
    .from('tenants')
    .update({ app_limit: newLimit })
    .eq('id', tenantId)
    .select('id, plan, app_limit')
    .single();
  console.log('DOPO:', updated);

  // Conta app esistenti
  const { count } = await supabase
    .from('apps')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId);
  console.log('App create:', count);
  console.log('Slot disponibili:', newLimit - (count || 0));
}

fix().catch(console.error);
