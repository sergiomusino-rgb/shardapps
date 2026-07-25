-- ============================================================================
-- ZeusX - Motore "Comandi": ordini vocali con catalogo prodotti
-- Data: 2026-07-30
-- Descrizione: schema per il modulo Comandi (ordini presi via trascrizione
-- vocale, riconciliati contro il catalogo prodotti del tenant tramite
-- ricerca fuzzy sui nomi/sinonimi parlati). Isolamento multi-tenant via
-- tenant_members, come da convenzione RLS in uso nel resto del progetto
-- (vedi 20250626_create_multitenant_schema.sql).
-- ============================================================================

-- 1. Estensione per ricerca fuzzy del testo (matching sinonimi vocali)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Stato ordine
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'PENDING_CONFIRMATION',
      'CONFIRMED',
      'PROCESSING',
      'COMPLETED',
      'CANCELLED'
    );
  END IF;
END $$;

-- 3. Catalogo prodotti del tenant
CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_of_measure TEXT NOT NULL DEFAULT 'pz',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

COMMENT ON TABLE catalog_items IS 'Catalogo prodotti/servizi per tenant, usato dal motore Comandi per riconciliare gli ordini vocali';

-- 4. Sinonimi parlati per prodotto (es. "birretta" -> "Birra 33cl")
CREATE TABLE IF NOT EXISTS product_synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  spoken_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_synonyms IS 'Alias/sinonimi parlati mappati a un catalog_items, per il matching fuzzy della trascrizione vocale';

-- 5. Ordini
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone TEXT,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status order_status NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  audio_transcript TEXT,
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE orders IS 'Ordini generati dal motore Comandi, inclusa la trascrizione audio originale e il livello di confidenza dell''estrazione AI';

-- 6. Righe ordine
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'pz',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_items IS 'Righe ordine: product_name/unit_price sono uno snapshot al momento dell''ordine, indipendente da modifiche successive al catalogo';

-- 7. Indici
CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_id ON catalog_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_catalog_items_name_trgm ON catalog_items USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_synonyms_tenant_id ON product_synonyms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_synonyms_product_id ON product_synonyms(product_id);
CREATE INDEX IF NOT EXISTS idx_product_synonyms_alias_trgm ON product_synonyms USING GIN (spoken_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- 8. Trigger updated_at (riusa update_updated_at_column definita in 20250626_create_multitenant_schema.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_catalog_items_updated_at') THEN
    CREATE TRIGGER tr_catalog_items_updated_at BEFORE UPDATE ON catalog_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_orders_updated_at') THEN
    CREATE TRIGGER tr_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 9. Row Level Security: isolamento rigido per tenant_id via tenant_members
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_synonyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members access own catalog_items" ON catalog_items;
CREATE POLICY "Tenant members access own catalog_items" ON catalog_items
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members access own product_synonyms" ON product_synonyms;
CREATE POLICY "Tenant members access own product_synonyms" ON product_synonyms
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members access own orders" ON orders;
CREATE POLICY "Tenant members access own orders" ON orders
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members access own order_items" ON order_items;
CREATE POLICY "Tenant members access own order_items" ON order_items
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
