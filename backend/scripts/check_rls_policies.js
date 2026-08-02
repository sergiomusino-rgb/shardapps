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
// Uso: node backend/scripts/check_rls_policies.js
// Exit code 1 se una tabella con contratto noto (BASELINE sotto) non
// combacia esattamente — pensato per essere lanciato prima di ogni deploy
// (manualmente per ora; puoi aggiungerlo come step in CI).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devono essere impostate in backend/.env');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    // ZeusX, in OR con l'appartenenza/ruolo nel tenant per l'utente normale.
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
    // monthly_fee/zeusx_share (commissioni ZeusX) — solo lettura della
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

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

async function main() {
  // Una tabella con RLS mai abilitato (ALTER TABLE ... ENABLE ROW LEVEL
  // SECURITY mai eseguito) non ha bisogno di nessuna policy per essere
  // completamente aperta a chiunque abbia un grant sulla tabella — un
  // controllo sulle sole policy (sotto) non la vedrebbe mai.
  const { data: rlsStatus, error: rlsError } = await supabase.rpc('list_table_rls_status');
  if (rlsError) {
    console.error('❌ Impossibile leggere lo stato RLS delle tabelle:', rlsError.message);
    console.error('   Verifica di aver applicato la migrazione 20260808000016_rls_status_function.sql');
    process.exitCode = 2;
    return;
  }
  const tablesWithoutRls = (rlsStatus || []).filter((t) => !t.rls_enabled);

  const { data: rows, error } = await supabase.rpc('list_rls_policies');
  if (error) {
    console.error('❌ Impossibile leggere le policy RLS:', error.message);
    console.error('   Verifica di aver applicato la migrazione 20260808000012_list_rls_policies_function.sql');
    process.exitCode = 2;
    return;
  }

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

  let hasFailure = false;
  let hasWarning = false;

  console.log('🔍 Controllo policy RLS attive (schema public)\n');

  // 0. Tabelle con RLS mai abilitato: sempre un fallimento critico, a
  // prescindere da qualunque policy scritta.
  if (tablesWithoutRls.length > 0) {
    hasFailure = true;
    for (const t of tablesWithoutRls) {
      console.log(`❌ ${t.table_name}: RLS NON abilitato — tabella completamente aperta a chi ha un grant su di essa.`);
    }
  }

  // 1. Tabelle con un contratto noto e verificato: confronto esatto.
  for (const [table, expectedByCmd] of Object.entries(BASELINE)) {
    const actualByCmd = byTableCommand[table] || {};
    for (const cmd of COMMANDS) {
      const expected = expectedByCmd[cmd] || [];
      const actual = actualByCmd[cmd] || [];
      if (!sameSet(expected, actual)) {
        hasFailure = true;
        console.log(`❌ ${table}.${cmd}: atteso [${expected.join(', ')}], trovato [${actual.join(', ') || 'nessuna policy'}]`);
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
        hasWarning = true;
        console.log(`⚠️  ${table}.${cmd}: ${names.length} policy permissive attive insieme — [${names.join(', ')}]. Verifica che sia intenzionale.`);
      }
    }
  }

  console.log();
  if (hasFailure) {
    console.log('❌ FALLITO: una o più tabelle critiche non hanno il set di policy atteso. Vedi sopra.');
    process.exitCode = 1;
    return;
  }
  if (hasWarning) {
    console.log('⚠️  Nessuna tabella del contratto critico è compromessa, ma ci sono sovrapposizioni su tabelle non ancora verificate — vedi sopra.');
    return;
  }
  console.log('✅ Tutte le policy RLS combaciano con quanto atteso.');
}

// process.exitCode invece di process.exit(): su Windows, chiudere il
// processo mentre il client Supabase (fetch/keep-alive) ha ancora socket
// aperti fa crashare Node con un assertion error di libuv, mascherando
// l'esito reale del controllo. Con exitCode il processo termina da solo a
// I/O esaurito, con lo stesso codice di uscita.
main().catch((err) => {
  console.error('❌ Errore inatteso:', err);
  process.exitCode = 2;
});
