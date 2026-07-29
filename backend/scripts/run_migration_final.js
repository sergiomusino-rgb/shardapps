require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const sql = `
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

async function run() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY deve essere impostata in backend/.env');
  }

  // Use the Supabase transaction pooler with service_role as password
  const pool = new Pool({
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.ujdyqnzofclzztmppxea',
    password: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected to Supabase PostgreSQL');
    
    await client.query(sql);
    console.log('✅ Migration executed successfully!');
    
    // Verify
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('fatture','righe_fattura')"
    );
    console.log('Tables found:', rows.map(r => r.table_name).join(', '));
    
    client.release();
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Full error:', err);
  }
  
  await pool.end();
}

run();