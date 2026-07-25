-- Tabella fatture
CREATE TABLE IF NOT EXISTS fatture (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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

-- Tabella righe fattura
CREATE TABLE IF NOT EXISTS righe_fattura (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fattura_id UUID NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  descrizione TEXT NOT NULL,
  quantita NUMERIC NOT NULL DEFAULT 1,
  prezzo_unitario NUMERIC NOT NULL DEFAULT 0,
  aliquota_iva INTEGER NOT NULL DEFAULT 22,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_fatture_tenant_id ON fatture(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fatture_numero_anno ON fatture(tenant_id, anno, numero_fattura);
CREATE INDEX IF NOT EXISTS idx_righe_fattura_fattura_id ON righe_fattura(fattura_id);

-- RLS policies
ALTER TABLE fatture ENABLE ROW LEVEL SECURITY;
ALTER TABLE righe_fattura ENABLE ROW LEVEL SECURITY;

-- Policy per fatture: tenant può vedere/modificare solo le proprie fatture
CREATE POLICY "Tenant can view own fatture" ON fatture
  FOR SELECT USING (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can insert own fatture" ON fatture
  FOR INSERT WITH CHECK (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can update own fatture" ON fatture
  FOR UPDATE USING (tenant_id = auth.uid()::uuid);

CREATE POLICY "Tenant can delete own fatture" ON fatture
  FOR DELETE USING (tenant_id = auth.uid()::uuid);

-- Policy per righe_fattura: tenant può gestire le righe delle proprie fatture
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