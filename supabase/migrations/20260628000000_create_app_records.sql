-- Tabella per memorizzare i record delle app generate
CREATE TABLE IF NOT EXISTS public.app_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_app_records_app_id ON public.app_records(app_id);
CREATE INDEX IF NOT EXISTS idx_app_records_tenant_id ON public.app_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_records_table_name ON public.app_records(table_name);

-- RLS disabilitato per ora (il backend usa service role)
ALTER TABLE public.app_records DISABLE ROW LEVEL SECURITY;
