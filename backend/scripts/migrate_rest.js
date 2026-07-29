// Use Supabase REST API with custom headers to create tables
// The service_role key has admin privileges via the REST API header
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function run() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
  }

  // Step 1: Create the exec_sql function via REST API (PostgREST)
  // We need to use the raw SQL endpoint which is typically at /rest/v1/rpc/
  
  // Try via management API - this is the Supabase Platform API
  // The format is: POST https://api.supabase.com/v1/projects/{ref}/database/query
  // But it needs a management API token, not the service_role key
  
  // Alternative: Use the pg_dump approach via REST
  // The Supabase REST API can handle raw SQL via a custom function if it exists
  
  // Try creating the function directly via the /sql endpoint
  // This is specific to Supabase hosted projects
  console.log('Trying to create tables via /auth/v1/admin/sql...');
  
  const createTableSQL = `
CREATE TABLE IF NOT EXISTS fatture (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  numero_fattura TEXT NOT NULL,
  anno INTEGER NOT NULL,
  data_emissione DATE NOT NULL,
  cliente_nome TEXT NOT NULL,
  cliente_piva TEXT,
  cliente_indirizzo TEXT,
  stato TEXT DEFAULT 'bozza' CHECK (stato IN ('bozza', 'emessa', 'pagata', 'annullata')),
  metodo_pagamento TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS righe_fattura (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fattura_id UUID NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  descrizione TEXT NOT NULL,
  quantita NUMERIC NOT NULL DEFAULT 1,
  prezzo_unitario NUMERIC NOT NULL DEFAULT 0,
  aliquota_iva INTEGER NOT NULL DEFAULT 22,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fatture_tenant_id ON fatture(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fatture_numero_anno ON fatture(tenant_id, anno, numero_fattura);
CREATE INDEX IF NOT EXISTS idx_righe_fattura_fattura_id ON righe_fattura(fattura_id);
  `;

  // Try the /sql endpoint used by Supabase Dashboard
  const endpoints = [
    { url: `${SUPABASE_URL}/sql`, method: 'POST', label: '/sql' },
    { url: `${SUPABASE_URL}/rest/v1/rpc/exec_sql`, method: 'POST', label: '/rpc/exec_sql' },
    { url: `${SUPABASE_URL}/auth/v1/admin/sql`, method: 'POST', label: '/auth/v1/admin/sql' },
    { url: `${SUPABASE_URL}/api/sql`, method: 'POST', label: '/api/sql' },
  ];

  for (const ep of endpoints) {
    try {
      console.log(`Trying ${ep.label}...`);
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ query: createTableSQL })
      });
      console.log(`  Status: ${res.status}`);
      const text = await res.text();
      console.log(`  Response: ${text.substring(0, 200)}`);
      
      if (res.ok) {
        console.log(`✅ SUCCESS with ${ep.label}!`);
        return;
      }
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // If none worked, try to create the exec_sql function via SQL insert
  console.log('\nTrying to insert a record in a known table to check connection...');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/apps?select=id&limit=1`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      }
    });
    if (res.ok) {
      console.log('✅ REST API connection works!');
      const data = await res.json();
      console.log(`  Found ${data.length} apps`);
      
      // Since REST works, the issue is just that the table doesn't exist.
      // The solution is to run the SQL via the Supabase Dashboard.
      console.log('\n❌ Cannot create tables via REST API.');
      console.log('Please copy and paste this URL in your browser:');
      console.log('  https://supabase.com/dashboard/project/ujdyqnzofclzztmppxea/sql/new');
      console.log('\nThen paste the SQL from supabase_migrations/20260704_create_fatture_tables.sql');
      console.log('and click "Run"');
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}

run().catch(console.error);