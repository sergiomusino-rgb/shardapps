// ─── Controllo policy RLS attive (anti-regressione) ────────────────────────
// Nato dall'audit pre-lancio del 2026-08-08: una policy RLS vecchia e
// permissiva su `tenants`/`tenant_members` non era mai stata rimossa a causa
// di un refuso nel nome usato dai DROP POLICY successivi, ed è sopravvissuta
// per mesi attraverso più migrazioni di "fix" che sembravano corrette (OR
// con una policy vecchia basta a vanificare qualunque policy nuova più
// restrittiva). Questo script legge le policy REALMENTE attive sul database
// (via la funzione list_rls_policies, vedi migrazione
// 20260808000012_list_rls_policies_function.sql) e le confronta con quelle
// attese, invece di fidarsi che "il file di migrazione esiste quindi è a
// posto".
//
// Dal 2026-08-09 controlla anche i permessi EXECUTE sulle funzioni (schema
// public, FUNCTION_BASELINE sotto) — nato da un'altra vulnerabilità critica
// nella stessa categoria (drift di permessi mai tracciato in una
// migrazione): exec_sql/execute_sql eseguivano SQL arbitrario con EXECUTE
// ancora aperto a PUBLIC, e altre funzioni admin/crediti bypassavano ogni
// RLS senza alcun controllo interno sul chiamante. Il controllo sulle sole
// policy RLS delle tabelle non le avrebbe mai intercettate — vedi
// 20260809000003/05/06 nelle migrazioni.
//
// Uso: node backend/scripts/check_rls_policies.js
// Exit code 1 se una tabella o una funzione con contratto noto (BASELINE/
// FUNCTION_BASELINE sotto) non combacia esattamente — pensato per essere
// lanciato prima di ogni deploy (manualmente per ora; puoi aggiungerlo come
// step in CI).
//
// Test: node --test scripts (vedi check_rls_policies.test.js) — copre solo
// evaluateTablePolicies/evaluateFunctionPrivileges (logica pura, dati finti),
// non fa nessuna chiamata di rete: non serve un DB/credenziali per lanciarlo.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

// Contratto verificato il 2026-08-08 leggendo le USING/WITH CHECK REALI
// via list_rls_policies() — non i file di migrazione, che per tenants/
// tenant_members/apps/subscriptions si sono rivelati non allineati al
// database live (drift da modifiche fatte a mano su Dashboard Supabase, mai
// tracciate in una migrazione). Se l'elenco REALE di policy permissive per
// una di queste tabelle/comandi non combacia esattamente, è un cambiamento —
// voluto o un refuso — da rivedere prima del deploy.
const BASELINE = {
  profiles: {
    // Dopo 20260808000014: sola lettura da client (propria riga o
    // has_table_access per il pannello admin). profiles.role autorizza le
    // rotte /api/admin/* (vedi takeover/route.ts) — nessuna scrittura diretta
    // da anon/authenticated deve mai essere permessa, la creazione riga
    // avviene via trigger on_auth_user_created (bypassa RLS).
    SELECT: ['profiles_select', 'profiles_select_own'],
    INSERT: [],
    UPDATE: [],
    DELETE: [],
  },
  tenants: {
    // has_table_access('tenants') è l'accesso RBAC per gli admin/reseller
    // ShardApps, in OR con l'appartenenza/ruolo nel tenant per l'utente normale.
    SELECT: ['tenants_select'],
    INSERT: ['tenants_insert'],
    UPDATE: ['tenants_update'],
    DELETE: ['tenants_delete'],
  },
  tenant_members: {
    // Dopo 20260808000013: SOLA lettura della propria riga da client. Ogni
    // scrittura (creazione agenti, cambio ruolo, ecc.) passa da Server
    // Action con service role, che bypassa RLS — quindi nessuna policy di
    // INSERT/UPDATE/DELETE per anon/authenticated è corretto, non un buco:
    // un array vuoto significa "nessuna policy permissiva" = scrittura
    // sempre negata per chiunque non sia service_role.
    SELECT: ['tenant_members_select_own'],
    INSERT: [],
    UPDATE: [],
    DELETE: [],
  },
  apps: {
    SELECT: ['apps_select', 'apps_select_by_totalum_app_id', 'apps_select_public_active', 'apps_service_role_all'],
    INSERT: ['apps_insert', 'apps_service_role_all'],
    UPDATE: ['apps_service_role_all', 'apps_update'],
    DELETE: ['apps_delete', 'apps_service_role_all'],
  },
  subscriptions: {
    SELECT: ['subscriptions_manage_service_role', 'subscriptions_select'],
    INSERT: ['subscriptions_insert', 'subscriptions_manage_service_role'],
    UPDATE: ['subscriptions_manage_service_role', 'subscriptions_update'],
    DELETE: ['subscriptions_delete', 'subscriptions_manage_service_role'],
  },
  catalog_items: {
    SELECT: ['catalog_items_select_tenant_member'],
    INSERT: ['catalog_items_write_non_agent'],
    UPDATE: ['catalog_items_update_non_agent'],
    DELETE: ['catalog_items_delete_non_agent'],
  },
  product_synonyms: {
    SELECT: ['product_synonyms_select_tenant_member'],
    INSERT: ['product_synonyms_write_non_agent'],
    UPDATE: ['product_synonyms_update_non_agent'],
    DELETE: ['product_synonyms_delete_non_agent'],
  },
  orders: {
    SELECT: ['orders_select_tenant_member'],
    INSERT: ['orders_insert_tenant_member'],
    UPDATE: ['orders_update_non_agent'],
    DELETE: ['orders_delete_non_agent'],
  },
  order_items: {
    SELECT: ['order_items_select_tenant_member'],
    INSERT: ['order_items_insert_tenant_member'],
    UPDATE: ['order_items_update_non_agent'],
    DELETE: ['order_items_delete_non_agent'],
  },
  customers: {
    // Unica policy FOR ALL per ogni ruolo (agente incluso): scelta di
    // prodotto esplicita, non un refuso — vedi 20260803000000_comandi_
    // agent_role.sql.
    SELECT: ['Tenant members access own customers'],
    INSERT: ['Tenant members access own customers'],
    UPDATE: ['Tenant members access own customers'],
    DELETE: ['Tenant members access own customers'],
  },
  app_registry: {
    // Dopo 20260808000015: niente scrittura diretta dal rivenditore su
    // monthly_fee/zeusx_share (commissioni ShardApps) — solo lettura della
    // propria riga, ogni scrittura passa da service role.
    SELECT: ['Resellers view their own apps', 'Service role manages app_registry'],
    INSERT: ['Service role manages app_registry'],
    UPDATE: ['Service role manages app_registry'],
    DELETE: ['Service role manages app_registry'],
  },
  transactions: {
    SELECT: ['Resellers view their own transactions', 'Service role manages transactions'],
    INSERT: ['Service role manages transactions'],
    UPDATE: ['Service role manages transactions'],
    DELETE: ['Service role manages transactions'],
  },
  credit_transactions: {
    // service_role_all usa auth.role() = 'service_role' esplicito (non
    // USING(true) senza clausola TO): corretto, non lo stesso refuso visto
    // altrove.
    SELECT: ['credit_transactions_select_own', 'credit_transactions_service_role_all'],
    INSERT: ['credit_transactions_service_role_all'],
    UPDATE: ['credit_transactions_service_role_all'],
    DELETE: ['credit_transactions_service_role_all'],
  },
  app_users: {
    // manage_tenant_owner richiede esplicitamente tm.role = 'owner': corretto.
    SELECT: ['app_users_select_own', 'app_users_manage_tenant_owner'],
    INSERT: ['app_users_manage_tenant_owner'],
    UPDATE: ['app_users_manage_tenant_owner'],
    DELETE: ['app_users_manage_tenant_owner'],
  },

  // ─── Resto dello schema, verificato per intero il 2026-08-08 ─────────────
  _system_entities: {
    // roles=['service_role'] esplicito nonostante USING/CHECK true: corretto.
    SELECT: ['service_role_full_access'],
    INSERT: ['service_role_full_access'],
    UPDATE: ['service_role_full_access'],
    DELETE: ['service_role_full_access'],
  },
  // CreatorAI SaaS Factory (Fase 3/4, migration 20260813000000): audit trail
  // delle azioni di entità (change_state/trigger_webhook/send_notification).
  // Aggiunta al BASELINE esplicito dopo il Product Readiness Audit (P2): senza
  // di questo, un futuro drift che aggiungesse per errore una policy
  // permissiva qui produrrebbe solo un WARNING (tabella "non in baseline"),
  // non un FAIL CI — stesso principio di app_credentials/app_rbac_users sotto.
  app_action_logs: {
    SELECT: ['app_action_logs_deny_anon_authenticated'],
    INSERT: ['app_action_logs_deny_anon_authenticated'],
    UPDATE: ['app_action_logs_deny_anon_authenticated'],
    DELETE: ['app_action_logs_deny_anon_authenticated'],
  },
  app_collaborators: {
    // FOR ALL, richiede esplicitamente role = 'admin': corretto.
    SELECT: ['admin_manage_collaborators'],
    INSERT: ['admin_manage_collaborators'],
    UPDATE: ['admin_manage_collaborators'],
    DELETE: ['admin_manage_collaborators'],
  },
  app_credentials: {
    SELECT: ['app_credentials_deny_anon_authenticated'],
    INSERT: ['app_credentials_deny_anon_authenticated'],
    UPDATE: ['app_credentials_deny_anon_authenticated'],
    DELETE: ['app_credentials_deny_anon_authenticated'],
  },
  app_definitions: {
    // Scrittura gated da has_feature_access('edit_app'/'delete_app') oltre
    // alla membership: sistema di permessi granulare, non "any tenant member".
    SELECT: ['app_definitions_select', 'app_definitions_select_public'],
    INSERT: ['app_definitions_insert'],
    UPDATE: ['app_definitions_update'],
    DELETE: ['app_definitions_delete'],
  },
  app_push_subscriptions: {
    SELECT: ['app_push_subscriptions_deny_anon_authenticated'],
    INSERT: ['app_push_subscriptions_deny_anon_authenticated'],
    UPDATE: ['app_push_subscriptions_deny_anon_authenticated'],
    DELETE: ['app_push_subscriptions_deny_anon_authenticated'],
  },
  // CreatorAI SaaS Factory (Fase 3, migration 20260812000000): utenti
  // multi-ruolo (admin/operator/viewer) di un'app auth_mode='rbac' — tabella
  // indipendente da app_credentials (che resta la password unica condivisa
  // delle app legacy). Stesso motivo del commento su app_action_logs sopra.
  app_rbac_users: {
    SELECT: ['app_rbac_users_deny_anon_authenticated'],
    INSERT: ['app_rbac_users_deny_anon_authenticated'],
    UPDATE: ['app_rbac_users_deny_anon_authenticated'],
    DELETE: ['app_rbac_users_deny_anon_authenticated'],
  },
  app_records: {
    // Stesso sistema has_feature_access di app_definitions.
    SELECT: ['app_records_select'],
    INSERT: ['app_records_insert'],
    UPDATE: ['app_records_update'],
    DELETE: ['app_records_delete'],
  },
  blueprints: {
    // SELECT pubblica per design (catalogo blueprint di settore): non un refuso.
    SELECT: ['Everyone view blueprints', 'blueprints_select'],
    INSERT: ['blueprints_insert'],
    UPDATE: ['blueprints_update'],
    DELETE: ['blueprints_delete'],
  },
  chats: {
    SELECT: ['chats_deny_anon_authenticated'],
    INSERT: ['chats_deny_anon_authenticated'],
    UPDATE: ['chats_deny_anon_authenticated'],
    DELETE: ['chats_deny_anon_authenticated'],
  },
  company_settings: {
    // upsert_tenant_admin NON controlla il ruolo nonostante il nome (qualunque
    // tenant_member può scrivere): accettato, sono solo dati di branding/
    // fatturazione non finanziari (nome azienda, logo, indirizzo) — a
    // differenza di tenants/app_registry non c'è una colonna prezzo/
    // commissione/ruolo da proteggere. Da stringere se in futuro vengono
    // aggiunti campi sensibili.
    SELECT: ['company_settings_select_public', 'company_settings_upsert_tenant_admin'],
    INSERT: ['company_settings_upsert_tenant_admin'],
    UPDATE: ['company_settings_upsert_tenant_admin'],
    DELETE: ['company_settings_upsert_tenant_admin'],
  },
  fatture: {
    // tenant_id = auth.uid() è il modello legacy a singolo owner (pre-
    // Comandi): documentato come "non applicabile" in comandi-invoices.ts,
    // che passa sempre da service role con verifica esplicita di membership/
    // ruolo. Corretto per le app a schema generato (dove tenant_id
    // storicamente coincide con l'owner), inutilizzato dal lato client per
    // Comandi.
    SELECT: ['Tenant can view own fatture'],
    INSERT: ['Tenant can insert own fatture'],
    UPDATE: ['Tenant can update own fatture'],
    DELETE: ['Tenant can delete own fatture'],
  },
  righe_fattura: {
    SELECT: ['Tenant can view righe of own fatture'],
    INSERT: ['Tenant can insert righe for own fatture'],
    UPDATE: ['Tenant can update righe of own fatture'],
    DELETE: ['Tenant can delete righe of own fatture'],
  },
  messages: {
    SELECT: ['messages_deny_anon_authenticated'],
    INSERT: ['messages_deny_anon_authenticated'],
    UPDATE: ['messages_deny_anon_authenticated'],
    DELETE: ['messages_deny_anon_authenticated'],
  },
  permissions_config: {
    // Scrittura gated da has_feature_access('manage_permissions'): corretto.
    SELECT: ['permissions_config_select'],
    INSERT: ['permissions_config_insert'],
    UPDATE: ['permissions_config_update'],
    DELETE: ['permissions_config_delete'],
  },
  processed_checkout_sessions: {
    SELECT: ['Service role manages processed_checkout_sessions'],
    INSERT: ['Service role manages processed_checkout_sessions'],
    UPDATE: ['Service role manages processed_checkout_sessions'],
    DELETE: ['Service role manages processed_checkout_sessions'],
  },
  projects: {
    SELECT: ['Gli utenti possono vedere solo i propri progetti'],
    INSERT: ['Gli utenti possono creare progetti'],
    UPDATE: ['Gli utenti possono aggiornare i propri progetti'],
    DELETE: ['Gli utenti possono eliminare i propri progetti'],
  },
  rate_limit_counters: {
    SELECT: ['rate_limit_counters_deny_anon_authenticated'],
    INSERT: ['rate_limit_counters_deny_anon_authenticated'],
    UPDATE: ['rate_limit_counters_deny_anon_authenticated'],
    DELETE: ['rate_limit_counters_deny_anon_authenticated'],
  },
  user_permissions: {
    // Scrittura gated da has_table_access('profiles'): corretto.
    SELECT: ['user_permissions_select'],
    INSERT: ['user_permissions_insert'],
    UPDATE: ['user_permissions_update'],
    DELETE: ['user_permissions_delete'],
  },
  // Tabelle legacy/orfane con RLS attivo e ZERO policy (tutto negato per
  // anon/authenticated, solo service_role): elencate qui esplicitamente
  // cosi' se in futuro qualcuno aggiunge una policy permissiva senza
  // accorgersene di riaprire l'accesso, il controllo lo segnala.
  user_preferences: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  access_tokens: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  prodotti: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  ordini: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  magazzino: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  chat_messages: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  clienti: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
  test_tabella: { SELECT: [], INSERT: [], UPDATE: [], DELETE: [] },
};

// Contratto verificato il 2026-08-09, stesso giorno e stesso motivo del
// BASELINE sopra: due funzioni SECURITY DEFINER (exec_sql/execute_sql,
// create a mano su Dashboard, mai da una migrazione) eseguivano qualunque
// SQL gli venisse passato con EXECUTE ancora aperto a PUBLIC — mai revocato,
// perché Postgres lo concede di default alla creazione di una funzione e
// nessuno lo aveva mai tolto esplicitamente. Verificato con una sessione
// utente autenticata reale: chiunque loggato poteva eseguire SQL arbitrario,
// bypassando ogni RLS (vedi 20260809000003_revoke_public_exec_sql.sql).
// Estendendo questo stesso controllo alle funzioni sono emerse altre 4
// funzioni admin/finanziarie con lo stesso problema, questa volta create da
// una migrazione regolare ma senza mai un REVOKE FROM PUBLIC esplicito
// (20260809000005_revoke_public_admin_functions.sql): chiunque poteva
// riassegnare la proprietà di qualunque app, azzerare i debiti di qualunque
// reseller, o leggere email/nome/debito di tutti i reseller.
//
// Come per BASELINE: un elenco vuoto (INSERT/UPDATE/DELETE nella tabella
// sopra) significa "nessuna policy permissiva" — qui un elenco di grantee
// mancante da FUNCTION_BASELINE significa "non ancora verificata", non
// "sicura per default". Le funzioni degli helper di introspezione stesse
// (list_rls_policies, list_function_privileges, ecc.) sono incluse qui:
// devono restare riservate a service_role tanto quanto qualunque altra.
// Chiavi = full_signature esatta restituita da list_function_privileges()
// (pg_get_function_identity_arguments: include i nomi dei parametri, non
// solo i tipi) — un disallineamento qui produce un falso "nessun grant
// trovato" per ogni voce, non un problema reale del database.
const FUNCTION_BASELINE = {
  // Tooling di introspezione/migrazione: mai da esporre oltre service_role.
  'exec_sql(sql text)': ['service_role'],
  'execute_sql(sql_query text)': ['service_role'],
  'get_function_source(fn_name text)': ['service_role'],
  'list_rls_policies()': ['service_role'],
  'list_table_rls_status()': ['service_role'],
  'list_function_privileges()': ['service_role'],
  // Admin/reseller: nessun controllo interno sul chiamante, protette solo
  // dal verifyAdmin() delle route app/api/admin/*.ts (già su service_role) —
  // vedi 20260809000005_revoke_public_admin_functions.sql.
  'admin_takeover_reseller_app(target_app_id uuid)': ['service_role'],
  'mark_reseller_transactions_paid(p_reseller_id uuid)': ['service_role'],
  'get_reseller_debts()': ['service_role'],
  'get_zeusx_total_due(p_reseller_id uuid)': ['service_role'],
  'get_app_for_takeover(target_app_id uuid)': ['service_role'],
  'get_reseller_apps(p_reseller_id uuid)': ['service_role'],
  'get_reseller_apps_with_total(p_reseller_id uuid)': ['service_role'],
  'get_user_tenant_ids(p_user_id uuid)': ['service_role'],
  'count_tenant_apps(p_tenant_id uuid)': ['service_role'],
  'is_app_accessible(p_app_id uuid)': ['service_role'],
  'is_tenant_member(p_tenant_id uuid, p_user_id uuid)': ['service_role'],
  'add_tenant_slots(tenant_id uuid, slots_to_add integer)': ['service_role'],
  'check_rate_limit(p_key text, p_window_seconds integer, p_max_requests integer)': ['service_role'],
  // Crediti Vision: nessun controllo interno, l'importo/utente arriva intero
  // dal chiamante — vanno chiamate solo da un flusso server già verificato
  // (webhook Stripe, conteggio consumo reale), mai dal client diretto. Vedi
  // 20260809000006_revoke_public_credits_and_misc_functions.sql.
  'deduct_credits(p_user_id uuid, p_amount integer, p_type text, p_description text, p_reference_id text, p_metadata jsonb)': ['service_role'],
  'grant_credits(p_user_id uuid, p_amount integer, p_type text, p_description text, p_reference_id text, p_metadata jsonb)': ['service_role'],
  'refund_credits(p_user_id uuid, p_amount integer, p_description text, p_reference_id text, p_metadata jsonb)': ['service_role'],
  // Marca processata + accredita crediti + somma slot + aggiorna piano come
  // un'unica transazione atomica (fix consistenza crediti Vision, vedi
  // 20260811000000_atomic_checkout_session_processing.sql) — invocabile solo
  // dal webhook Stripe (service_role), stesso principio di grant_credits.
  'apply_checkout_session_atomic(p_session_id text, p_tenant_id uuid, p_plan text, p_slots_to_add integer, p_credits_to_add integer, p_user_id uuid, p_plan_rank_map jsonb)': ['service_role'],
  // Slot app: RPC atomica anti race-condition, chiamata solo da route server
  // già su service_role (api/creator/create, api/apps) — non ha bisogno di
  // essere raggiungibile dal client.
  'increment_tenant_app_count(p_tenant_id uuid)': ['service_role'],

  // ─── Verificate: grant ampio intenzionale, con controllo interno solido ──
  // Lette per intero il 2026-08-09 — ognuna filtra esplicitamente su
  // auth.uid() prima di restituire qualunque dato, quindi un chiamante non
  // autenticato o non pertinente riceve sempre riga vuota/eccezione, a
  // prescindere da quanto è ampio il grant. Corretto lasciarle raggiungibili
  // da anon/authenticated: sono pensate per essere chiamate dal client (RLS
  // helper e lettura dei propri dati), non solo da service_role.
  'get_app_client_credentials(p_app_id uuid)': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  'get_my_tenant_ids()': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  'has_feature_access(feature_name text)': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  'has_table_access(table_name text)': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  'is_member_of_tenant(tenant_id_to_check uuid)': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
  // NON SECURITY DEFINER: gira con i privilegi del chiamante, quindi resta
  // comunque soggetta alla RLS reale della tabella tenants (tenants_select)
  // anche con un grant ampio sulla funzione — verificato empiricamente che
  // un utente anon non riesce a leggere slot di un tenant che non è il suo.
  'get_tenant_slots_available(tenant_id uuid)': ['PUBLIC', 'anon', 'authenticated', 'service_role'],
};

// Ruoli il cui EXECUTE su una funzione non ancora verificata è un segnale di
// rischio: un client anonimo o un qualunque utente loggato che può eseguire
// una funzione mai passata in review.
const RISKY_GRANTEES = ['PUBLIC', 'anon', 'authenticated'];

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// ─── Valutazione pura, senza rete/DB (testabile con dati finti) ────────────
// Estratta dal vecchio main() monolitico in occasione della Fase 2
// (2026-08-09, difesa in profondità): main() restava l'unico modo per
// verificare che il controllo si comporti come atteso, il che significava
// poterlo testare solo con un vero progetto Supabase collegato — qui invece
// prende in input le righe già lette (stessa forma restituita dalle RPC
// list_table_rls_status/list_rls_policies) e restituisce liste di
// messaggi, senza I/O.

function evaluateTablePolicies(rlsStatus, rows) {
  const tablesWithoutRls = (rlsStatus || []).filter((t) => !t.rls_enabled);

  // tabella -> comando -> [nomi policy permissive]. Una policy FOR ALL
  // (command === 'ALL') vale per tutti e 4 i comandi, non solo per uno.
  const byTableCommand = {};
  for (const row of rows || []) {
    if (!row.is_permissive) continue; // le policy RESTRICTIVE si combinano in AND: logica diversa, non gestita qui
    const commands = row.command === 'ALL' ? COMMANDS : [row.command];
    for (const cmd of commands) {
      byTableCommand[row.table_name] = byTableCommand[row.table_name] || {};
      byTableCommand[row.table_name][cmd] = byTableCommand[row.table_name][cmd] || [];
      byTableCommand[row.table_name][cmd].push(row.policy_name);
    }
  }

  const failures = [];
  const warnings = [];

  // 0. Tabelle con RLS mai abilitato: sempre un fallimento critico, a
  // prescindere da qualunque policy scritta.
  for (const t of tablesWithoutRls) {
    failures.push(`${t.table_name}: RLS NON abilitato — tabella completamente aperta a chi ha un grant su di essa.`);
  }

  // 1. Tabelle con un contratto noto e verificato: confronto esatto.
  for (const [table, expectedByCmd] of Object.entries(BASELINE)) {
    const actualByCmd = byTableCommand[table] || {};
    for (const cmd of COMMANDS) {
      const expected = expectedByCmd[cmd] || [];
      const actual = actualByCmd[cmd] || [];
      if (!sameSet(expected, actual)) {
        failures.push(`${table}.${cmd}: atteso [${expected.join(', ')}], trovato [${actual.join(', ') || 'nessuna policy'}]`);
      }
    }
  }

  // 2. Tutte le altre tabelle: controllo generico "smell", non un contratto
  // verificato. Più di una policy permissiva sullo stesso comando può essere
  // voluto, ma è esattamente il pattern che ha causato il bug del
  // 2026-08-08 (vecchia policy mai rimossa + nuova più restrittiva, unite in
  // OR): segnalato per revisione manuale, non blocca da solo il deploy.
  for (const [table, byCmd] of Object.entries(byTableCommand)) {
    if (BASELINE[table]) continue;
    for (const cmd of COMMANDS) {
      const names = byCmd[cmd] || [];
      if (names.length > 1) {
        warnings.push(`${table}.${cmd}: ${names.length} policy permissive attive insieme — [${names.join(', ')}]. Verifica che sia intenzionale.`);
      }
    }
  }

  return { failures, warnings };
}

function evaluateFunctionPrivileges(funcRows) {
  const byFunctionGrantee = {};
  const funcMeta = {};
  for (const row of funcRows || []) {
    if (row.is_extension_function || row.is_trigger) continue; // rumore: pg_trgm e trigger non richiamabili via RPC
    if (row.grantee === 'postgres') continue; // privilegio implicito del proprietario, non un grant significativo
    byFunctionGrantee[row.full_signature] = byFunctionGrantee[row.full_signature] || new Set();
    byFunctionGrantee[row.full_signature].add(row.grantee);
    funcMeta[row.full_signature] = { isSecurityDefiner: row.is_security_definer };
  }

  const failures = [];
  const warnings = [];

  // 1. Funzioni con un contratto noto e verificato: confronto esatto (come
  // per le tabelle) — qualunque grantee in più o in meno è un fallimento.
  for (const [fnSignature, expected] of Object.entries(FUNCTION_BASELINE)) {
    const actual = [...(byFunctionGrantee[fnSignature] || new Set())];
    if (!sameSet(expected, actual)) {
      failures.push(`${fnSignature}: atteso [${expected.join(', ')}], trovato [${actual.join(', ') || 'nessun grant'}]`);
    }
    delete byFunctionGrantee[fnSignature];
  }

  // 2. Funzioni non ancora verificate (non in FUNCTION_BASELINE). Prima
  // della Fase 2 (2026-08-09) qualunque funzione qui, anche SECURITY
  // DEFINER con EXECUTE aperto a PUBLIC/anon/authenticated, produceva solo
  // un warning — lo stesso identico varco di exec_sql/execute_sql sarebbe
  // potuto tornare in vita con un semplice `CREATE FUNCTION ... SECURITY
  // DEFINER` senza REVOKE esplicito, senza mai far fallire un deploy.
  //
  // Hardening: SECURITY DEFINER bypassa RLS con i privilegi del
  // proprietario — se non è già stata letta e aggiunta esplicitamente a
  // FUNCTION_BASELINE, un grant a un ruolo rischioso è ora un fallimento,
  // non un warning. Le funzioni NON SECURITY DEFINER restano un warning:
  // girano con i privilegi del chiamante, quindi anche con un grant ampio
  // restano soggette alla RLS reale delle tabelle che toccano (stesso
  // ragionamento già verificato per get_tenant_slots_available/
  // add_tenant_slots, vedi FUNCTION_BASELINE sopra) — non la stessa classe
  // di rischio, non deve bloccare da sola un deploy.
  for (const [fnSignature, granteeSet] of Object.entries(byFunctionGrantee)) {
    const grantees = [...granteeSet];
    const risky = grantees.filter((g) => RISKY_GRANTEES.includes(g));
    if (risky.length === 0) continue;

    const isSecurityDefiner = !!funcMeta[fnSignature]?.isSecurityDefiner;
    if (isSecurityDefiner) {
      failures.push(
        `${fnSignature} (SECURITY DEFINER): non è in FUNCTION_BASELINE ed è eseguibile da [${risky.join(', ')}]. ` +
        `Bypassa RLS con i privilegi del proprietario — revoca il grant o aggiungila a FUNCTION_BASELINE dopo averla letta per intero.`
      );
    } else {
      warnings.push(
        `${fnSignature} (invoker rights): non ancora verificata, eseguibile da [${risky.join(', ')}]. ` +
        `Se non ha un controllo interno su auth.uid()/membership, revoca il grant o aggiungila a FUNCTION_BASELINE dopo averla letta.`
      );
    }
  }

  return { failures, warnings };
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Una tabella con RLS mai abilitato (ALTER TABLE ... ENABLE ROW LEVEL
  // SECURITY mai eseguito) non ha bisogno di nessuna policy per essere
  // completamente aperta a chiunque abbia un grant su di essa — un
  // controllo sulle sole policy (sotto) non la vedrebbe mai.
  const { data: rlsStatus, error: rlsError } = await supabase.rpc('list_table_rls_status');
  if (rlsError) {
    console.error('❌ Impossibile leggere lo stato RLS delle tabelle:', rlsError.message);
    console.error('   Verifica di aver applicato la migrazione 20260808000016_rls_status_function.sql');
    process.exitCode = 2;
    return;
  }

  const { data: rows, error } = await supabase.rpc('list_rls_policies');
  if (error) {
    console.error('❌ Impossibile leggere le policy RLS:', error.message);
    console.error('   Verifica di aver applicato la migrazione 20260808000012_list_rls_policies_function.sql');
    process.exitCode = 2;
    return;
  }

  const { data: funcRows, error: funcError } = await supabase.rpc('list_function_privileges');
  if (funcError) {
    console.error('❌ Impossibile leggere i permessi sulle funzioni:', funcError.message);
    console.error('   Verifica di aver applicato la migrazione 20260809000004_list_function_privileges.sql');
    process.exitCode = 2;
    return;
  }

  console.log('🔍 Controllo policy RLS attive (schema public)\n');
  const { failures: tableFailures, warnings: tableWarnings } = evaluateTablePolicies(rlsStatus, rows);
  for (const msg of tableFailures) console.log(`❌ ${msg}`);
  for (const msg of tableWarnings) console.log(`⚠️  ${msg}`);

  // 3. Permessi EXECUTE sulle funzioni (schema public). Nato dalla
  // vulnerabilità del 2026-08-09: exec_sql/execute_sql eseguivano SQL
  // arbitrario con EXECUTE ancora aperto a PUBLIC, mai revocato — questo
  // controllo sulle sole policy RLS delle tabelle non l'avrebbe mai vista,
  // categoria di permesso diversa.
  console.log('\n🔍 Controllo permessi EXECUTE sulle funzioni (schema public)\n');
  const { failures: funcFailures, warnings: funcWarnings } = evaluateFunctionPrivileges(funcRows);
  for (const msg of funcFailures) console.log(`❌ ${msg}`);
  for (const msg of funcWarnings) console.log(`⚠️  ${msg}`);

  const hasFailure = tableFailures.length > 0 || funcFailures.length > 0;
  const hasWarning = tableWarnings.length > 0 || funcWarnings.length > 0;

  console.log();
  if (hasFailure) {
    console.log('❌ FALLITO: una o più tabelle critiche non hanno il set di policy atteso, o una funzione non combacia col contratto verificato (o è SECURITY DEFINER non verificata con grant rischioso). Vedi sopra.');
    process.exitCode = 1;
    return;
  }
  if (hasWarning) {
    console.log('⚠️  Nessuna tabella/funzione del contratto critico è compromessa, ma ci sono sovrapposizioni di policy o funzioni non ancora verificate — vedi sopra.');
    return;
  }
  console.log('✅ Tutte le policy RLS e i permessi sulle funzioni combaciano con quanto atteso.');
}

// require.main === module: main() (rete + credenziali reali) gira solo
// quando il file è eseguito direttamente (`node check_rls_policies.js`),
// non quando viene require()'d da un test — che deve poter importare
// BASELINE/FUNCTION_BASELINE/evaluate* senza un progetto Supabase collegato.
if (require.main === module) {
  // process.exitCode invece di process.exit(): su Windows, chiudere il
  // processo mentre il client Supabase (fetch/keep-alive) ha ancora socket
  // aperti fa crashare Node con un assertion error di libuv, mascherando
  // l'esito reale del controllo. Con exitCode il processo termina da solo a
  // I/O esaurito, con lo stesso codice di uscita.
  main().catch((err) => {
    console.error('❌ Errore inatteso:', err);
    process.exitCode = 2;
  });
}

module.exports = {
  BASELINE,
  FUNCTION_BASELINE,
  RISKY_GRANTEES,
  sameSet,
  evaluateTablePolicies,
  evaluateFunctionPrivileges,
};
