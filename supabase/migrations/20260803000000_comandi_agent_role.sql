-- ============================================================================
-- ZeusX - Motore "Comandi": ruolo Agente (rappresentante sul campo)
-- Data: 2026-08-03
-- Descrizione: aggiunge un ruolo 'agent' a tenant_members (accesso ridotto:
-- Catalogo in sola lettura + Raccolta Ordini, niente dati aziendali/incassi),
-- estende `orders` per gli ordini raccolti a voce dagli agenti (data di
-- consegna, snapshot JSON dell'estrazione AI, registrazione audio) e aggiunge
-- una rubrica clienti minima per il selettore rapido lato agente. Isolamento
-- multi-tenant via tenant_members, stessa convenzione RLS del resto del
-- modulo Comandi (vedi 20260730000000_comandi_schema.sql).
-- ============================================================================

-- 1. Ruolo 'agent' su tenant_members
-- Nota: il vincolo CHECK esistente ('owner','admin','member') è stato creato
-- in 20250626000000_alter_multitenant_schema.sql. Va ricreato per estendere
-- i valori ammessi — non esiste un "ADD VALUE" per i CHECK su testo.
ALTER TABLE tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'agent'));

COMMENT ON COLUMN tenant_members.role IS
  'owner/admin: accesso completo al tenant. member: account operativo generico (es. cassa POS). agent: accesso ridotto, solo Catalogo (sola lettura) e Raccolta Ordini — vedi ComandiInstanceDashboard/agente/page.tsx.';

-- 2. Rubrica clienti minima (selettore rapido lato agente)
-- Non sostituisce orders.customer_name/customer_phone (restano testo libero
-- per i clienti occasionali non in rubrica): è un elenco opzionale da cui
-- l'agente può scegliere rapidamente, popolabile anche al volo dal campo.
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE customers IS 'Rubrica clienti per tenant, usata dal selettore rapido nella pagina Agente (app/a/[slug]/app/agente)';

CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING GIN (name gin_trgm_ops);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_customers_updated_at') THEN
    CREATE TRIGGER tr_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members access own customers" ON customers;
CREATE POLICY "Tenant members access own customers" ON customers
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- 3. Estensione tabella orders per gli ordini vocali raccolti dagli agenti
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;
-- Snapshot dell'estrazione AI (parsed_items + discarded_items) al momento
-- della creazione, indipendente da order_items: order_items resta la fonte
-- di verità per fatturazione/magazzino (righe normalizzate, FK a
-- catalog_items), extracted_items è il log grezzo per audit/debug della
-- pipeline vocale (utile quando differiscono, es. dopo una correzione manuale
-- delle righe non ancora riflessa qui).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extracted_items JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Path dell'oggetto nel bucket privato 'comandi-agent-audio' (NON un URL
-- pubblico: il bucket non è pubblico, vedi sotto). Recupero via
-- supabaseAdmin.storage.from('comandi-agent-audio').createSignedUrl(path, ttl)
-- lato server quando servirà una UI di riascolto (non ancora implementata).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS audio_url TEXT;

COMMENT ON COLUMN orders.customer_id IS 'Riferimento opzionale a customers, quando il cliente è stato scelto dal selettore rapido invece che inserito come testo libero';
COMMENT ON COLUMN orders.delivery_date IS 'Data di consegna richiesta, raccolta dall''agente sul campo (opzionale)';
COMMENT ON COLUMN orders.extracted_items IS 'Snapshot JSON grezzo dell''estrazione AI (parsed_items/discarded_items) al momento della creazione, per audit — order_items resta la fonte di verità operativa';
COMMENT ON COLUMN orders.audio_url IS 'Path (non URL pubblico) dell''audio originale nel bucket privato comandi-agent-audio, quando l''ordine è stato raccolto via app/api/agent-voice-order';

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);

-- 4. Storage: bucket privato per le registrazioni audio degli ordini agente
-- A differenza di 'vision-uploads' (pubblico, perché l'URL deve essere
-- raggiungibile da Fal.ai) questo bucket resta privato: sono registrazioni
-- vocali di ordini reali dei clienti del tenant, non contenuti generati da
-- esporre pubblicamente. Lettura riservata ai membri del tenant proprietario
-- (via RLS su storage.objects); la scrittura avviene solo lato server
-- (service role, che bypassa le RLS) da app/api/agent-voice-order.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comandi-agent-audio',
  'comandi-agent-audio',
  false,
  26214400, -- 25MB: ordini vocali brevi, ben oltre il necessario
  ARRAY['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Tenant members read own comandi agent audio" ON storage.objects;
CREATE POLICY "Tenant members read own comandi agent audio" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'comandi-agent-audio'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM tenant_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
