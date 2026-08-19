-- ============================================================================
-- ShardApps - Private Beta: invite-only signup + beta entitlement (€0)
-- Data: 2026-08-30
-- ============================================================================
-- Implementa i due blocker tecnici dell'audit Private Beta:
--
-- 1) BLOCKER #1 (invite-only): oggi supabase.auth.signUp() è aperto a
--    chiunque — /beta + /api/beta/apply scrivono solo in beta_applications
--    (RLS deny-all) senza mai gate-are la creazione dell'account. Questa
--    migration aggiunge un trigger BEFORE INSERT su auth.users che rifiuta
--    la creazione dell'utente se la sua email non ha una candidatura
--    beta_applications con status='approved'. Il trigger gira lato Postgres,
--    quindi vale per QUALUNQUE percorso di creazione riga in auth.users
--    (signUp dal browser, chiamata REST diretta a Supabase Auth, un futuro
--    admin.createUser() server-side) — non è aggirabile saltando il
--    frontend. Gli utenti già esistenti non sono toccati: il trigger si
--    attiva solo su INSERT, mai su login (nessuna riga auth.users scritta).
--
-- 2) BLOCKER #2 (beta gratuita senza Stripe): tenants.beta_access è un
--    nuovo entitlement, separato dal modello commerciale (plan/app_limit
--    restano invariati, mai riscritti da questa migration) — quando true,
--    bypassa il paywall SOLO nel punto dove viene già applicato oggi
--    (canCreateApp/reserveAppSlot, src/lib/creator-server.ts, condiviso da
--    /api/creator/generate, /api/creator/publish e
--    /api/catalog/products/[productSlug]/provision — quindi CreatorAI E
--    FollowAI/CheckAI in un solo punto, nessuna duplicazione). Impostato
--    server-side al momento della creazione del tenant (stessa query su
--    beta_applications del trigger sopra), mai da un parametro client.
--
-- Difesa in profondità (trovata durante la security review di questo task,
-- non un blocker separato): la policy RLS "tenants_update_owner"
-- (20260630000011) permette all'owner di un tenant di fare UPDATE su
-- QUALUNQUE colonna della propria riga, incluse plan/app_limit — un owner
-- autenticato potrebbe quindi auto-concedersi slot/piano (o, dopo questa
-- migration, beta_access) con una chiamata REST diretta
-- (PATCH /rest/v1/tenants?id=eq.<proprio tenant>), bypassando completamente
-- Stripe. RLS in Postgres filtra le RIGHE, non le colonne: la fix corretta è
-- un REVOKE a livello di colonna, non una nuova policy. Questo pre-esisteva
-- anche per plan/app_limit (fuori scope di questo task in generale), ma qui
-- va chiuso per forza: senza, beta_access non sarebbe affatto "non
-- client-controlled" come richiesto. ai_daily_budget_usd/ai_monthly_budget_usd
-- hanno lo stesso gap teorico ma restano fuori scope (non toccati).
-- ============================================================================

-- ─── 1) Entitlement beta sul tenant ─────────────────────────────────────────

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS beta_access boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.beta_access IS 'Private Beta: bypassa il paywall (slot app) senza toccare plan/app_limit. Impostato SOLO server-side (src/lib/creator-server.ts::getOrCreateTenant, in base a beta_applications.status=''approved'' per l''email dell''utente) o dall''admin via PATCH /api/admin/beta-applications/:id. Mai scrivibile da anon/authenticated via REST diretta, vedi REVOKE sotto.';

-- Nessun client (anon/authenticated) deve poter scrivere queste 4 colonne
-- direttamente via PostgREST, a prescindere da quale riga possiede: sono le
-- uniche leve che decidono se un tenant può creare/pubblicare app senza
-- pagare. Il resto della riga (name, slug, branding, ecc.) resta scrivibile
-- dall'owner come prima — nessun cambio lì.
REVOKE INSERT (plan, app_limit, total_apps_created, beta_access),
       UPDATE (plan, app_limit, total_apps_created, beta_access)
  ON tenants FROM authenticated, anon;

-- ─── 2) increment_tenant_app_count: bypass atomico per i tenant beta ───────
-- CREATE OR REPLACE preserva firma e commento di scopo invariati rispetto a
-- 20260808000005/20260809000002 — unica modifica: la guardia nella WHERE
-- ora accetta anche beta_access=true, così un tenant beta con app_limit=0
-- continua a incrementare (mai bloccato dall'RPC atomica, non solo dal
-- pre-check in JS). I grant restano quelli fissati da
-- 20260809000006_revoke_public_credits_and_misc_functions.sql (solo
-- service_role): ripetuti qui esplicitamente per idempotenza, MAI ri-concessi
-- ad authenticated (era il refuso originale già corretto).
CREATE OR REPLACE FUNCTION public.increment_tenant_app_count(
    p_tenant_id UUID
)
RETURNS TABLE (total_apps_created INTEGER, app_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INTEGER;
    v_limit INTEGER;
BEGIN
    UPDATE tenants
    SET total_apps_created = total_apps_created + 1, updated_at = now()
    WHERE id = p_tenant_id AND (total_apps_created < app_limit OR beta_access = true)
    RETURNING tenants.total_apps_created, tenants.app_limit INTO v_total, v_limit;

    IF NOT FOUND THEN
        RETURN; -- limite raggiunto (e non beta), o tenant inesistente: nessuna riga, nessun incremento
    END IF;

    RETURN QUERY SELECT v_total, v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_tenant_app_count(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_tenant_app_count(uuid) TO service_role;

-- ─── 3) Gate invite-only: BEFORE INSERT su auth.users ──────────────────────
-- SECURITY DEFINER: il ruolo che GoTrue usa per scrivere in auth.users non
-- ha di per sé accesso a public.beta_applications (RLS deny-all) — la
-- funzione gira coi privilegi del proprietario (bypassa RLS), non del
-- chiamante, stesso principio già in uso per public.handle_new_user() (trigger
-- AFTER INSERT esistente su questa stessa tabella, invariato da questa
-- migration) e get_app_client_credentials.
CREATE OR REPLACE FUNCTION public.enforce_beta_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nessun canale di signup non-email in uso oggi (solo email+password, vedi
  -- frontend/app/login/LoginClient.tsx): non bloccare un caso che il
  -- prodotto non usa invece di rifiutare a vuoto un futuro OAuth/phone auth.
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.beta_applications
    WHERE lower(email) = lower(NEW.email) AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'BETA_ACCESS_REQUIRED: email non autorizzata alla Private Beta ShardApps'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_beta_allowlist_trigger ON auth.users;
CREATE TRIGGER enforce_beta_allowlist_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_beta_allowlist();

-- ─── 4) Helper admin: trova il tenant di proprietà di un'email ─────────────
-- Usato solo da PATCH /api/admin/beta-applications/:id (service_role) per
-- sincronizzare beta_access quando l'admin approva/revoca una candidatura
-- DOPO che il tenant esiste già (es. utente pre-esistente, o approvato dopo
-- un primo tentativo di signup fallito). auth.users non è raggiungibile da
-- PostgREST (schema non esposto): serve una funzione SECURITY DEFINER anche
-- solo per questa lettura, stesso motivo del punto 3.
CREATE OR REPLACE FUNCTION public.find_owned_tenant_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_tenant_id FROM public.tenants WHERE owner_id = v_user_id ORDER BY created_at ASC LIMIT 1;
  RETURN v_tenant_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.find_owned_tenant_id_by_email(text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.find_owned_tenant_id_by_email(text) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
