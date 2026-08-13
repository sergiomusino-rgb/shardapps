-- ============================================================================
-- ShardApps - App Catalog & Instance Model (STEP 3 — seed catalogo iniziale)
-- Data: 2026-08-16
-- ============================================================================
-- Seed puro, non struttura: non tocca la migration 20260815000000 (schema
-- app_products/app_product_versions) né altera nessuna riga esistente di
-- `apps` — solo INSERT idempotenti (ON CONFLICT DO NOTHING sullo slug/sulla
-- versione) dei 3 prodotti placeholder necessari a dimostrare il flusso
-- Product -> Version -> Instance end-to-end (STEP 3, FASE 8/10 dell'audit):
-- FollowAI, CheckAI, CommandAI — ciascuno con UNA versione '1.0.0' e un
-- blueprint minimale ma REALE (uno SiteBlueprintJSON valido che supera
-- sanitizeSiteBlueprint, stesso schema di qualunque app CreatorAI), non un
-- JSON finto. Il prodotto CreatorAI COMPLETO (entità, RBAC, azioni reali)
-- per ciascuno di questi resta fuori scope qui, per esplicita richiesta
-- (FASE 11 — "NON costruire ancora FollowAI/CheckAI/CommandAI complete").
--
-- Perché una migration e non uno script separato: coerente con l'unico
-- meccanismo di dati/seed già usato in questo repo (nessun altro pattern di
-- "seed script" esiste nel progetto — ogni dato di riferimento, incluse le
-- baseline RLS/funzioni, è sempre arrivato via migration). Una migration
-- idempotente (ON CONFLICT DO NOTHING) è anche più sicura da ri-applicare
-- per errore di uno script ad-hoc mai tracciato.
--
-- Nota sul nome "command-ai": è un prodotto placeholder DISTINTO dal
-- "Comandi AI" già esistente e funzionante (app_type='comandi_ai',
-- provisioning gratuito automatico per ogni tenant via
-- comandi-provisioning.ts) — tabelle e meccanismi completamente separati,
-- zero collisione. Il vero "Comandi AI" diventare un prodotto di questo
-- catalogo è una decisione futura, non presa qui.
-- ============================================================================

INSERT INTO app_products (slug, name, description, icon, category, price_monthly, trial_days, is_active)
VALUES
  ('follow-ai', 'FollowAI', 'Monitoraggio e follow-up automatico dei clienti — presto disponibile.', '📈', 'crm', 0.00, 30, true),
  ('check-ai', 'CheckAI', 'Controlli e verifiche automatizzate per la tua attività — presto disponibile.', '✅', 'automazione', 0.00, 30, true),
  ('command-ai', 'CommandAI', 'Gestione ordini vocali con AI — presto disponibile come prodotto autonomo del catalogo.', '🎙️', 'automazione', 0.00, 30, true)
ON CONFLICT (slug) DO NOTHING;

-- Blueprint placeholder minimale ma valido (SiteBlueprintJSON — stesso
-- schema di frontend/src/lib/site-schema.ts, ri-validato comunque a runtime
-- da sanitizeSiteBlueprint ad ogni provisioning, mai fidato ciecamente
-- nemmeno qui): una sola pagina Home con una sezione hero, nessuna entità
-- admin, RBAC disattivato (authConfig.enabled=false — auth_mode 'legacy',
-- comportamento più semplice/prevedibile per un placeholder di test).
INSERT INTO app_product_versions (product_id, version, blueprint, changelog, is_active)
SELECT
  p.id,
  '1.0.0',
  jsonb_build_object(
    'projectType', 'landing',
    'appName', p.name,
    'sector', 'saas',
    'description', p.description,
    'businessConfig', jsonb_build_object(
      'name', p.name,
      'tagline', 'Prodotto ShardApps',
      'description', p.description,
      'address', '', 'whatsapp', '', 'phone', '', 'email', '',
      'openingHours', '[]'::jsonb,
      'language', 'it'
    ),
    'adminPanel', jsonb_build_object('entities', '[]'::jsonb),
    'pages', jsonb_build_array(
      jsonb_build_object(
        'slug', 'home',
        'label', 'Home',
        'sections', jsonb_build_array(
          jsonb_build_object('type', 'hero', 'title', p.name, 'subtitle', 'Presto disponibile')
        )
      )
    ),
    'actionButtons', '[]'::jsonb,
    'ui', jsonb_build_object('primaryColor', '#6366f1', 'font', 'Inter'),
    'authConfig', jsonb_build_object('enabled', false, 'supportedRoles', jsonb_build_array('admin'), 'defaultRole', 'viewer')
  ),
  'Versione iniziale placeholder — schema minimale per testare il provisioning dal catalogo (App Catalog STEP 3).',
  true
FROM app_products p
WHERE p.slug IN ('follow-ai', 'check-ai', 'command-ai')
ON CONFLICT (product_id, version) DO NOTHING;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
