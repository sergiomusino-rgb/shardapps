-- ============================================================================
-- ShardApps - App Catalog: FollowAI, primo prodotto reale e vendibile (STEP 5A)
-- Data: 2026-08-18
-- ============================================================================
-- Segue l'analisi read-only dello STEP 5A: FollowAI è il candidato scelto
-- (vedi motivazione nel report STEP 5A — CommandAI è il più maturo ma
-- richiederebbe riaprire il provisioning STEP 3 per un formato non-blueprint,
-- CheckAI è concettualmente meno definito). Questa migration è SOLO dati —
-- nessuna modifica di schema, nessuna tabella, nessuna colonna, nessuna RLS:
-- non tocca in alcun modo il codice di provisioning/checkout/webhook (STEP 3
-- e STEP 4 restano inviolati, come richiesto).
--
-- Due operazioni, entrambe idempotenti:
-- 1) Prezzo reale: app_products.price_monthly passa da 0.00 (placeholder) a
--    25.00 — sopra questo valore il checkout dello STEP 4 (già esistente,
--    invariato) accetta il prodotto; a 0.00 lo rifiutava esplicitamente con
--    FREE_PRODUCT (guardia in catalog-checkout-authorization.js).
-- 2) Nuova versione '1.1.0' in app_product_versions con un blueprint REALE
--    (CRM lead/follow-up), non più il segnaposto "Home + hero" della '1.0.0'
--    (20260816000000_app_catalog_seed_products.sql). Blueprint immutabile per
--    versione (stesso principio dello STEP 2): non si fa mai UPDATE di una
--    versione esistente, si inserisce una nuova riga. La versione '1.0.0'
--    resta nello storico ma viene disattivata: il provisioning (STEP 3,
--    invariato) sceglie di norma la versione attiva più recente quando non
--    ne viene richiesta una esplicita, quindi '1.1.0' verrebbe comunque
--    scelta per default — la disattivazione di '1.0.0' è solo per coerenza
--    semantica (una versione placeholder non deve restare "attiva" una volta
--    che esiste una versione reale) e per far fallire esplicitamente con 404
--    un'eventuale richiesta futura che la nominasse ancora per errore.
--
-- Blueprint validato PRIMA di scrivere questa migration eseguendo
-- sanitizeSiteBlueprint (frontend/src/lib/site-schema.ts) sullo stesso identico
-- JSON sotto, con tsx, fuori da qualunque route applicativa: tutti gli 8 campi
-- e le 4 azioni dell'entità 'leads' sopravvivono al parse, le transizioni di
-- stato sono valide, authConfig risulta {enabled:true, supportedRoles:
-- [admin,operator,viewer], defaultRole:viewer}. Nessuna modifica a
-- catalog-provision-authorization.js/provision/route.ts/checkout/route.ts è
-- stata necessaria: leggono il blueprint da app_product_versions esattamente
-- come già facevano per il placeholder, senza sapere né doversi accorgere che
-- ora è un blueprint reale.
--
-- Nota sui tipi di campo: il motore normalizza i tipi (blueprint-schema.ts::
-- normalizeFieldType) — 'numeric' normalizza a 'number' (usato per
-- deal_value: 'number' come letterale non è nel vocabolario di normalizzazione
-- e degraderebbe silenziosamente a 'text', 'numeric' sì ed è la scelta più
-- fedele alla richiesta "deal_value (number)"), 'date' resta 'date',
-- 'textarea' resta 'textarea', 'state' resta 'state' con i suoi
-- states/allowedTransitions.
-- ============================================================================

-- ─── 1) Prezzo reale ─────────────────────────────────────────────────────
UPDATE app_products
SET price_monthly = 25.00,
    updated_at = now()
WHERE slug = 'follow-ai';

-- ─── 2) Nuova versione con blueprint reale ──────────────────────────────
INSERT INTO app_product_versions (product_id, version, blueprint, changelog, is_active)
SELECT
  p.id,
  '1.1.0',
  '{
    "projectType": "webapp-pwa",
    "appName": "FollowAI",
    "sector": "saas",
    "description": "CRM leggero per il monitoraggio e il follow-up automatico dei clienti: pipeline lead, promemoria di ricontatto, note e cronologia sempre a portata di mano.",
    "businessConfig": {
      "name": "FollowAI",
      "tagline": "Non perdere mai più un cliente da ricontattare",
      "description": "FollowAI tiene traccia di ogni lead e cliente, mostra chi va ricontattato e quando, e registra ogni passaggio della trattativa dal primo contatto alla chiusura.",
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
          "name": "leads",
          "label": "Lead",
          "labelPlural": "Lead",
          "icon": "👥",
          "fields": [
            { "id": "company_name", "type": "text", "label": "Azienda", "required": true },
            { "id": "contact_person", "type": "text", "label": "Referente", "required": false },
            { "id": "email", "type": "email", "label": "Email", "required": false },
            { "id": "phone", "type": "phone", "label": "Telefono", "required": false },
            {
              "id": "status",
              "type": "state",
              "label": "Stato",
              "required": false,
              "states": ["nuovo", "contattato", "in_trattativa", "chiuso_vinto", "chiuso_perso"],
              "allowedTransitions": {
                "nuovo": ["contattato"],
                "contattato": ["in_trattativa", "chiuso_perso"],
                "in_trattativa": ["chiuso_vinto", "chiuso_perso"]
              }
            },
            { "id": "deal_value", "type": "numeric", "label": "Valore Opportunità (€)", "required": false },
            { "id": "next_followup", "type": "date", "label": "Prossimo Follow-up", "required": false },
            { "id": "notes", "type": "textarea", "label": "Note", "required": false }
          ],
          "actions": [
            { "id": "mark_contacted", "label": "Segna come Contattato", "type": "change_state", "targetState": "contattato", "requiredRole": "operator" },
            { "id": "start_negotiation", "label": "Avvia Trattativa", "type": "change_state", "targetState": "in_trattativa", "requiredRole": "operator" },
            { "id": "mark_won", "label": "Chiudi Vinto", "type": "change_state", "targetState": "chiuso_vinto", "requiredRole": "admin" },
            { "id": "mark_lost", "label": "Chiudi Perso", "type": "change_state", "targetState": "chiuso_perso", "requiredRole": "operator" }
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
            "title": "Non perdere mai più un cliente da ricontattare",
            "subtitle": "FollowAI è il CRM leggero che tiene traccia di ogni lead, mostra chi ricontattare oggi e registra ogni fase della trattativa.",
            "imageUrl": "",
            "ctaLabel": "Accedi al tuo CRM",
            "ctaHref": ""
          },
          {
            "type": "about",
            "title": "Come funziona",
            "body": "Ogni lead entra nella pipeline con stato \"Nuovo\". Il team lo contatta, avvia la trattativa e chiude vinto o perso — ogni passaggio è tracciato con data, valore dell''opportunità e note. Il campo \"Prossimo Follow-up\" ricorda sempre chi ricontattare e quando.",
            "imageUrl": ""
          },
          {
            "type": "cta",
            "title": "Pronto a gestire i tuoi lead senza più dimenticare un follow-up?",
            "subtitle": "Accedi alla tua area riservata per iniziare.",
            "buttonLabel": "Vai al pannello",
            "buttonHref": ""
          }
        ]
      }
    ],
    "actionButtons": [],
    "ui": { "primaryColor": "#0ea5e9", "font": "Inter" },
    "authConfig": { "enabled": true, "supportedRoles": ["admin", "operator", "viewer"], "defaultRole": "viewer" }
  }'::jsonb,
  'Prima versione reale e vendibile di FollowAI (STEP 5A): CRM lead/follow-up con pipeline a stati (nuovo -> contattato -> in_trattativa -> chiuso_vinto/chiuso_perso), RBAC admin/operator/viewer, 25€/mese. Sostituisce la 1.0.0 come versione attiva di default.',
  true
FROM app_products p
WHERE p.slug = 'follow-ai'
ON CONFLICT (product_id, version) DO NOTHING;

-- ─── 3) Disattiva il placeholder 1.0.0 (storico, non più provisionabile) ──
UPDATE app_product_versions
SET is_active = false
WHERE product_id = (SELECT id FROM app_products WHERE slug = 'follow-ai')
  AND version = '1.0.0';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
