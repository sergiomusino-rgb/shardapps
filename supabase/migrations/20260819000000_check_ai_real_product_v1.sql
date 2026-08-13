-- ============================================================================
-- ShardApps - App Catalog: CheckAI, secondo prodotto reale e vendibile (STEP 8A)
-- Data: 2026-08-19
-- ============================================================================
-- Segue esattamente il pattern di 20260818000000_follow_ai_real_product_v1.sql
-- (STEP 5A, primo prodotto reale del Catalog): questa migration è SOLO dati —
-- nessuna modifica di schema, nessuna tabella, nessuna colonna, nessuna RLS,
-- nessun codice applicativo toccato. Non tocca in alcun modo provisioning/
-- checkout/cancel/webhook (STEP 3/4) né FollowAI né Comandi AI.
--
-- Dominio approvato nello STEP 7 (CHECKAI READY FOR BLUEPRINT): gestione
-- digitale dei controlli e delle verifiche periodiche — entità "controlli"
-- con pipeline a stati (da_verificare -> in_corso -> superato/non_superato,
-- con riapertura non_superato -> da_verificare), RBAC admin/operator/viewer,
-- 25€/mese, 30 giorni di trial (stessi valori di FollowAI).
--
-- Due operazioni, entrambe idempotenti:
-- 1) Prezzo reale: app_products.price_monthly passa da 0.00 (placeholder) a
--    25.00 — sopra questo valore il checkout dello STEP 4 (invariato) accetta
--    il prodotto; a 0.00 lo rifiutava esplicitamente con FREE_PRODUCT.
-- 2) Nuova versione '1.1.0' in app_product_versions con un blueprint REALE
--    (CRM di controlli/verifiche), non più il segnaposto "Home + hero" della
--    '1.0.0' (20260816000000_app_catalog_seed_products.sql). Blueprint
--    immutabile per versione: non si fa mai UPDATE di una versione esistente,
--    si inserisce una nuova riga. La versione '1.0.0' resta nello storico ma
--    viene disattivata — stessa motivazione già usata per FollowAI: il
--    provisioning sceglierebbe comunque '1.1.0' per default (versione attiva
--    più recente), la disattivazione è coerenza semantica + far fallire con
--    404 un'eventuale richiesta esplicita della vecchia versione placeholder.
--
-- Blueprint validato PRIMA di scrivere questa migration eseguendo
-- sanitizeSiteBlueprint (frontend/src/lib/site-schema.ts) sullo stesso
-- identico JSON sotto, con tsx, fuori da qualunque route applicativa —
-- 18 asserzioni esplicite, tutte PASS: 8 campi (check_name:text,
-- category:select, responsible:text, asset_or_location:text, status:state,
-- measured_value:number, next_check_date:date, notes:textarea), 4 azioni
-- change_state con targetState/requiredRole corretti, 4 stati e 3 transizioni
-- valide, authConfig (enabled:true, ruoli admin/operator/viewer,
-- defaultRole:viewer), 1 pagina con sezioni hero/about/cta. Nessuna modifica
-- a provision/route.ts, checkout/route.ts, cancel/route.ts o al webhook è
-- stata necessaria: leggono il blueprint da app_product_versions esattamente
-- come già facevano per FollowAI, senza sapere né doversi accorgere che
-- questo è un prodotto diverso.
--
-- Nota sui tipi di campo (stessa di FollowAI): 'numeric' normalizza a
-- 'number' (blueprint-schema.ts::normalizeFieldType) — 'number' come
-- letterale non è nel vocabolario di normalizzazione e degraderebbe
-- silenziosamente a 'text', 'numeric' sì.
-- ============================================================================

-- ─── 1) Prezzo reale ─────────────────────────────────────────────────────
UPDATE app_products
SET price_monthly = 25.00,
    updated_at = now()
WHERE slug = 'check-ai';

-- ─── 2) Nuova versione con blueprint reale ──────────────────────────────
INSERT INTO app_product_versions (product_id, version, blueprint, changelog, is_active)
SELECT
  p.id,
  '1.1.0',
  '{
    "projectType": "webapp-pwa",
    "appName": "CheckAI",
    "sector": "saas",
    "description": "Gestione digitale dei controlli e delle verifiche periodiche: chi deve farli, quando, con quale esito, in un unico storico.",
    "businessConfig": {
      "name": "CheckAI",
      "tagline": "Non perdere più un controllo",
      "description": "CheckAI centralizza i controlli periodici della tua attività: chi deve farli, quando, con quale esito, e li tiene in un unico storico.",
      "address": "",
      "whatsapp": "",
      "phone": "",
      "email": "",
      "openingHours": [],
      "language": "it"
    },
    "adminPanel": {
      "entities": [
        {
          "name": "controlli",
          "label": "Controllo",
          "labelPlural": "Controlli",
          "icon": "✅",
          "fields": [
            { "id": "check_name", "type": "text", "label": "Nome Controllo", "required": true },
            {
              "id": "category",
              "type": "select",
              "label": "Categoria",
              "required": true,
              "options": ["Sicurezza", "Qualità", "Manutenzione", "Igiene", "Altro"]
            },
            { "id": "responsible", "type": "text", "label": "Responsabile", "required": false },
            { "id": "asset_or_location", "type": "text", "label": "Ambiente/Asset", "required": false },
            {
              "id": "status",
              "type": "state",
              "label": "Stato",
              "required": false,
              "states": ["da_verificare", "in_corso", "superato", "non_superato"],
              "allowedTransitions": {
                "da_verificare": ["in_corso"],
                "in_corso": ["superato", "non_superato"],
                "non_superato": ["da_verificare"]
              }
            },
            { "id": "measured_value", "type": "numeric", "label": "Valore Rilevato", "required": false },
            { "id": "next_check_date", "type": "date", "label": "Prossimo Controllo", "required": false },
            { "id": "notes", "type": "textarea", "label": "Note", "required": false }
          ],
          "actions": [
            { "id": "start_check", "label": "Avvia Controllo", "type": "change_state", "targetState": "in_corso", "requiredRole": "operator" },
            { "id": "mark_passed", "label": "Segna Superato", "type": "change_state", "targetState": "superato", "requiredRole": "operator" },
            { "id": "mark_failed", "label": "Segna Non Superato", "type": "change_state", "targetState": "non_superato", "requiredRole": "operator" },
            { "id": "reopen_check", "label": "Riapri Controllo", "type": "change_state", "targetState": "da_verificare", "requiredRole": "admin" }
          ]
        }
      ]
    },
    "pages": [
      {
        "slug": "home",
        "label": "Home",
        "sections": [
          {
            "type": "hero",
            "title": "Non perdere più un controllo",
            "subtitle": "CheckAI organizza le verifiche periodiche della tua attività: chi deve farle, quando, con quale esito.",
            "imageUrl": "",
            "ctaLabel": "Accedi al tuo pannello controlli",
            "ctaHref": ""
          },
          {
            "type": "about",
            "title": "Come funziona",
            "body": "I controlli periodici finiscono su carta, fogli sparsi o messaggi — e prima o poi qualcuno viene dimenticato. CheckAI li centralizza: chi deve farli, quando, con quale esito, e li tiene in un unico storico.",
            "imageUrl": ""
          },
          {
            "type": "cta",
            "title": "Pronto a organizzare i controlli della tua attività?",
            "subtitle": "Accedi alla tua area riservata per iniziare.",
            "buttonLabel": "Accedi al pannello controlli",
            "buttonHref": ""
          }
        ]
      }
    ],
    "actionButtons": [],
    "ui": { "primaryColor": "#22c55e", "font": "Inter" },
    "authConfig": { "enabled": true, "supportedRoles": ["admin", "operator", "viewer"], "defaultRole": "viewer" }
  }'::jsonb,
  'Prima versione reale e vendibile di CheckAI (STEP 8A): gestione controlli/verifiche periodiche con pipeline a stati (da_verificare -> in_corso -> superato/non_superato, con riapertura non_superato -> da_verificare), RBAC admin/operator/viewer, 25€/mese. Sostituisce la 1.0.0 come versione attiva di default.',
  true
FROM app_products p
WHERE p.slug = 'check-ai'
ON CONFLICT (product_id, version) DO NOTHING;

-- ─── 3) Disattiva il placeholder 1.0.0 (storico, non più provisionabile) ──
UPDATE app_product_versions
SET is_active = false
WHERE product_id = (SELECT id FROM app_products WHERE slug = 'check-ai')
  AND version = '1.0.0';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
