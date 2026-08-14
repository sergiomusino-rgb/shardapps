-- ============================================================================
-- ShardApps - App Catalog: ComandAI come prodotto Catalog-native
-- Data: 2026-08-20
-- ============================================================================
-- Segue l'audit read-only "ComandAI -> Catalog Factory": porta il prodotto
-- placeholder esistente 'command-ai' (20260816000000_app_catalog_seed_
-- products.sql) allo stato "reale e vendibile", stesso pattern già usato per
-- FollowAI (20260818000000) e CheckAI (20260819000000) — SOLO dati, nessuna
-- modifica di schema, nessuna tabella, nessuna colonna, nessuna RLS.
--
-- Differenza rispetto a FollowAI/CheckAI: ComandAI NON usa il motore a
-- blueprint dinamico (ViewerProFinal). Il suo runtime è selezionato da
-- apps.app_type='comandi_ai' (esistente da prima del Catalog, invariato) —
-- il blueprint di questa versione non viene MAI renderizzato (il routing di
-- app/a/[slug]/page.tsx instrada alla console ComandAI PRIMA che il
-- blueprint conti). Resta comunque un blueprint valido (superato da
-- sanitizeSiteBlueprint) per coerenza con lo schema esistente di
-- app_product_versions.blueprint (NOT NULL) — nessuna nuova colonna
-- introdotta solo per "il prodotto senza blueprint reale", come da
-- indicazione esplicita di non aggiungere astrazioni per questo.
--
-- Tre operazioni, tutte idempotenti:
-- 1) Nome/descrizione/prezzo reali su app_products (slug invariato:
--    'command-ai' resta l'identificatore stabile, non URL-facing in modo
--    critico — il brand mostrato in UI è app_products.name, qui corretto a
--    "ComandAI"). Prezzo: 25.00, NON inventato — è il prezzo già ufficiale
--    di ComandAI, la stessa costante MONTHLY_PRICE usata da
--    frontend/app/actions/comandi-provisioning.ts (client_price e zeusx_fee
--    per le copie rivendute). Sopra 0.00 anche perché richiesto da
--    catalog-checkout-authorization.js (guardia FREE_PRODUCT).
-- 2) Nuova versione '1.1.0' in app_product_versions: blueprint placeholder
--    esplicitamente etichettato come non-renderizzato (sottotitolo lo
--    dichiara), non più il generico "Home + hero" della '1.0.0'. Blueprint
--    immutabile per versione: mai UPDATE, sempre nuova riga.
-- 3) Disattiva la versione '1.0.0' (storico, non più provisionabile) — il
--    provisioning sceglie comunque di norma la versione attiva più recente,
--    la disattivazione è per coerenza semantica e per far fallire
--    esplicitamente con 404 una richiesta futura che la nominasse ancora.
--
-- Blueprint validato PRIMA di scrivere questa migration eseguendo
-- sanitizeSiteBlueprint (frontend/src/lib/site-schema.ts) sullo stesso
-- identico JSON sotto: stessa forma minimale già in produzione per la
-- '1.0.0' di command-ai/follow-ai/check-ai, quindi già nota superare il
-- parse. authConfig.enabled=false (auth_mode 'legacy'): coerente con
-- comandi-provisioning.ts, che imposta sempre auth_mode='legacy' per
-- ComandAI indipendentemente dal blueprint.
-- ============================================================================

-- ─── 1) Nome, descrizione e prezzo reali (slug invariato) ─────────────────
UPDATE app_products
SET name = 'ComandAI',
    description = 'Cassa vocale AI per ristorazione e commercio: prendi ordini a voce, li trascrivi e li strutturi automaticamente.',
    price_monthly = 25.00,
    updated_at = now()
WHERE slug = 'command-ai';

-- ─── 2) Nuova versione — blueprint placeholder, esplicitamente non renderizzato ──
INSERT INTO app_product_versions (product_id, version, blueprint, changelog, is_active)
SELECT
  p.id,
  '1.1.0',
  '{
    "projectType": "landing",
    "appName": "ComandAI",
    "sector": "comandi",
    "description": "Cassa vocale AI per ristorazione e commercio.",
    "businessConfig": {
      "name": "ComandAI",
      "tagline": "Prodotto ShardApps",
      "description": "Cassa vocale AI per ristorazione e commercio.",
      "address": "", "whatsapp": "", "phone": "", "email": "",
      "openingHours": [],
      "language": "it"
    },
    "adminPanel": { "entities": [] },
    "pages": [
      {
        "slug": "home",
        "label": "Home",
        "sections": [
          { "type": "hero", "title": "ComandAI", "subtitle": "Placeholder di catalogo, non renderizzato: il runtime reale è la console ComandAI esistente (app_type=comandi_ai)." }
        ]
      }
    ],
    "actionButtons": [],
    "ui": { "primaryColor": "#6366f1", "font": "Inter" },
    "authConfig": { "enabled": false, "supportedRoles": ["admin"], "defaultRole": "viewer" }
  }'::jsonb,
  'Versione reale e vendibile di ComandAI (App Catalog): il blueprint qui non viene mai renderizzato, il runtime è la console ComandAI esistente instradata da apps.app_type=''comandi_ai''. Sostituisce la 1.0.0 come versione attiva di default.',
  true
FROM app_products p
WHERE p.slug = 'command-ai'
ON CONFLICT (product_id, version) DO NOTHING;

-- ─── 3) Disattiva il placeholder 1.0.0 (storico, non più provisionabile) ──
UPDATE app_product_versions
SET is_active = false
WHERE product_id = (SELECT id FROM app_products WHERE slug = 'command-ai')
  AND version = '1.0.0';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
