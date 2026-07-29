// Execute SQL migration via Supabase REST API
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

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

ALTER TABLE fatture ENABLE ROW LEVEL SECURITY;
ALTER TABLE righe_fattura ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant can view own fatture" ON fatture
  FOR SELECT USING (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can insert own fatture" ON fatture
  FOR INSERT WITH CHECK (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can update own fatture" ON fatture
  FOR UPDATE USING (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can delete own fatture" ON fatture
  FOR DELETE USING (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can view righe of own fatture" ON righe_fattura
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fatture
      WHERE fatture.id = righe_fattura.fattura_id
      AND fatture.tenant_id = auth.uid()::uuid
    )
  );

CREATE POLICY "Tenant can insert righe for own fatture" ON righe_fattura
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fatture
      WHERE fatture.id = righe_fattura.fattura_id
      AND fatture.tenant_id = auth.uid()::uuid
    )
  );

CREATE POLICY "Tenant can update righe of own fatture" ON righe_fattura
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM fatture
      WHERE fatture.id = righe_fattura.fattura_id
      AND fatture.tenant_id = auth.uid()::uuid
    )
  );

CREATE POLICY "Tenant can delete righe of own fatture" ON righe_fattura
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM fatture
      WHERE fatture.id = righe_fattura.fattura_id
      AND fatture.tenant_id = auth.uid()::uuid
    )
  );
`;

async function main() {
  // Use the Supabase SQL endpoint (pg SQL via REST)
  const url = `${SUPABASE_URL}/rest/v1/`;
  
  // Try using the pg_graphql endpoint for raw SQL
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pg_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: sql })
  });

  if (response.ok) {
    console.log('✅ Migrazione eseguita con successo!');
  } else {
    const text = await response.text();
    console.log('❌ Errore:', response.status, text);
    
    // Try alternative approach: create the function first
    if (response.status === 404) {
      console.log('\nTentativo con approccio alternativo...');
      await tryAlternative();
    }
  }
}

async function tryAlternative() {
  // First create the pg_sql function using direct pg connection
  const createFuncSql = `
    CREATE OR REPLACE FUNCTION pg_sql(query text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE query;
    END;
    $$;
  `;

  // Encode as base64 for safe transport
  const encodedSql = Buffer.from(sql).toString('base64');
  const encodedCreateFunc = Buffer.from(createFuncSql).toString('base64');

  // Use the Supabase auth endpoint to execute SQL via the service role
  // This uses the management API
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: sql })
  });

  const data = await response.text();
  console.log(`Response (${response.status}):`, data);
}

main().catch(console.error);