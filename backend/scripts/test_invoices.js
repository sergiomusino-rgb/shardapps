require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get the app
  const { data: app, error: appError } = await supabase
    .from('apps')
    .select('id, tenant_id, client_password')
    .eq('slug', 'zeusx-negozio-mrjuyono')
    .single();

  if (appError) {
    console.log('ERRORE app:', JSON.stringify(appError, null, 2));
    return;
  }
  console.log('App trovata, tenant_id:', app.tenant_id);
  console.log('client_password:', app.client_password);

  // Query fatture
  const { data: fatture, error: fattureError } = await supabase
    .from('fatture')
    .select('*')
    .eq('tenant_id', app.tenant_id)
    .limit(5);

  if (fattureError) {
    console.log('ERRORE fatture:', JSON.stringify(fattureError, null, 2));
  } else {
    console.log('Fatture trovate:', fatture?.length || 0);
    console.log('Dati:', JSON.stringify(fatture, null, 2));
  }
}

main().catch(console.error);