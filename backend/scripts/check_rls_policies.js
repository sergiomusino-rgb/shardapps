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
};

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

async function main() {
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
