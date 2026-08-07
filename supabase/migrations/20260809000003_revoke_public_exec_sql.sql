-- ============================================================================
-- CRITICO: revoca esecuzione pubblica di exec_sql/execute_sql
-- Data: 2026-08-09
-- Descrizione: le due funzioni SECURITY DEFINER exec_sql(text) ed
-- execute_sql(text) — mai create da una migrazione di questo repo, quindi
-- create a mano su Supabase Dashboard, probabilmente come utility per
-- applicare SQL senza CLI (vedi backend/scripts/migrate_rest.js, stesso
-- problema del token/password Postgres mancante) — eseguono con EXECUTE sql
-- qualunque stringa SQL gli venga passata, con i privilegi del proprietario
-- (superuser). PostgreSQL concede EXECUTE a PUBLIC di default alla creazione
-- di una funzione, salvo REVOKE esplicito: qui non era mai stato fatto.
--
-- Impatto verificato: qualunque utente autenticato (ruolo Postgres
-- "authenticated", cioè chiunque abbia fatto login sulla piattaforma) poteva
-- chiamare public.exec_sql/execute_sql via l'API REST e far eseguire SQL
-- arbitrario — lettura/scrittura/cancellazione di qualsiasi tabella,
-- bypass totale di ogni policy RLS, escalation di privilegi. Stessa classe
-- delle 4 vulnerabilità dell'audit del 2026-08-08 (vedi rls-check.yml): una
-- modifica fatta a mano sul Dashboard, mai passata da una migrazione, quindi
-- invisibile a git e a qualunque review.
--
-- check_rls_policies.js (il controllo automatico giornaliero) NON avrebbe
-- intercettato questo: verifica le policy RLS sulle tabelle, non i GRANT
-- sulle funzioni — categoria di controllo diversa, da considerare per
-- un'estensione futura dello script.
--
-- Fix: revoca EXECUTE da PUBLIC/authenticated/anon, lascia solo service_role
-- (che ha comunque accesso completo al DB tramite altre vie — nessuna
-- funzionalità della piattaforma perde nulla). Le funzioni non vengono
-- eliminate: restano utili come strumento di migrazione da service_role,
-- stesso ruolo che le ha già usate finora.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon;

REVOKE EXECUTE ON FUNCTION public.execute_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_sql(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_sql(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_sql(text) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
