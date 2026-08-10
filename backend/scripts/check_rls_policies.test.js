// ─── Test del controllo RLS/permessi (Fase 2 — difesa in profondità) ───────
// Usa il test runner integrato in Node (node:test, stabile da Node 18+,
// requisito minimo del progetto è Node >=22 — vedi backend/package.json):
// nessuna dipendenza npm nuova. Copre solo evaluateTablePolicies/
// evaluateFunctionPrivileges (logica pura estratta da check_rls_policies.js),
// con righe finte — non serve nessuna credenziale Supabase per lanciarlo.
//
// Uso: node --test scripts (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FUNCTION_BASELINE,
  sameSet,
  evaluateTablePolicies,
  evaluateFunctionPrivileges,
} = require('./check_rls_policies');

// ─── sameSet ─────────────────────────────────────────────────────────────

test('sameSet: stesso contenuto in ordine diverso -> true', () => {
  assert.equal(sameSet(['a', 'b'], ['b', 'a']), true);
});

test('sameSet: lunghezza diversa -> false', () => {
  assert.equal(sameSet(['a'], ['a', 'b']), false);
});

test('sameSet: stesso numero di elementi ma diversi -> false', () => {
  assert.equal(sameSet(['a', 'b'], ['a', 'c']), false);
});

// ─── evaluateTablePolicies ──────────────────────────────────────────────

test('evaluateTablePolicies: tabella con RLS disabilitato -> failure', () => {
  const { failures } = evaluateTablePolicies(
    [{ table_name: 'profiles', rls_enabled: false }],
    []
  );
  assert.ok(failures.some((f) => f.includes('profiles') && f.includes('RLS NON abilitato')));
});

test('evaluateTablePolicies: tabella baseline con policy attese -> nessuna failure', () => {
  // tenant_members: SELECT = ['tenant_members_select_own'], resto vuoto (vedi BASELINE)
  const rows = [
    { table_name: 'tenant_members', command: 'SELECT', is_permissive: true, policy_name: 'tenant_members_select_own' },
  ];
  const { failures } = evaluateTablePolicies([{ table_name: 'tenant_members', rls_enabled: true }], rows);
  assert.equal(failures.filter((f) => f.startsWith('tenant_members')).length, 0);
});

test('evaluateTablePolicies: tabella baseline con policy permissiva extra (drift) -> failure', () => {
  // Stesso bug reale dell'audit dell'8/8: una vecchia policy permissiva mai
  // rimossa, in OR con quella nuova più restrittiva.
  const rows = [
    { table_name: 'tenant_members', command: 'SELECT', is_permissive: true, policy_name: 'tenant_members_select_own' },
    { table_name: 'tenant_members', command: 'SELECT', is_permissive: true, policy_name: 'old_permissive_policy' },
  ];
  const { failures } = evaluateTablePolicies([{ table_name: 'tenant_members', rls_enabled: true }], rows);
  assert.ok(failures.some((f) => f.startsWith('tenant_members.SELECT')));
});

test('evaluateTablePolicies: tabella non in baseline con 2 policy permissive sullo stesso comando -> warning, non failure', () => {
  // NB: BASELINE contiene ~90 tabelle reali; senza righe per loro,
  // evaluateTablePolicies segnala comunque le LORO failure ("nessuna
  // policy" attesa ma non fornita in questo fixture) — rumore atteso e
  // ininfluente, per questo le asserzioni sono mirate a "una_tabella_
  // qualsiasi" (non in BASELINE), non al totale dell'array.
  const rows = [
    { table_name: 'una_tabella_qualsiasi', command: 'SELECT', is_permissive: true, policy_name: 'p1' },
    { table_name: 'una_tabella_qualsiasi', command: 'SELECT', is_permissive: true, policy_name: 'p2' },
  ];
  const { failures, warnings } = evaluateTablePolicies([], rows);
  assert.equal(failures.filter((f) => f.startsWith('una_tabella_qualsiasi')).length, 0);
  assert.ok(warnings.some((w) => w.startsWith('una_tabella_qualsiasi.SELECT')));
});

// ─── evaluateFunctionPrivileges ──────────────────────────────────────────

function fnRow(overrides) {
  return {
    is_extension_function: false,
    is_trigger: false,
    is_security_definer: false,
    grantee: 'service_role',
    full_signature: 'placeholder()',
    ...overrides,
  };
}

test('evaluateFunctionPrivileges: funzione in baseline col grant esatto atteso -> nessuna failure/warning per quella funzione', () => {
  // NB: FUNCTION_BASELINE contiene ~28 funzioni reali; senza righe per le
  // altre, il fixture produce comunque le LORO failure ("nessun grant
  // trovato") — rumore atteso, per questo l'asserzione è mirata alla sola
  // firma sotto test.
  const [sig, expected] = Object.entries(FUNCTION_BASELINE)[0]; // exec_sql(sql text): ['service_role']
  const rows = expected.map((grantee) => fnRow({ full_signature: sig, grantee, is_security_definer: true }));
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(failures.filter((f) => f.startsWith(sig)).length, 0);
  assert.equal(warnings.filter((w) => w.startsWith(sig)).length, 0);
});

test('evaluateFunctionPrivileges: funzione in baseline con un grantee IN PIU\' del contratto -> failure', () => {
  // Stesso scenario della vulnerabilità reale: exec_sql doveva avere solo
  // service_role e invece aveva anche PUBLIC/authenticated/anon.
  const rows = [
    fnRow({ full_signature: 'exec_sql(sql text)', grantee: 'service_role', is_security_definer: true }),
    fnRow({ full_signature: 'exec_sql(sql text)', grantee: 'authenticated', is_security_definer: true }),
  ];
  const { failures } = evaluateFunctionPrivileges(rows);
  assert.ok(failures.some((f) => f.startsWith('exec_sql(sql text)')));
});

test('evaluateFunctionPrivileges: funzione in baseline con un grantee MANCANTE dal contratto -> failure', () => {
  const rows = []; // exec_sql non compare affatto: nessun grant trovato
  const { failures } = evaluateFunctionPrivileges(rows);
  assert.ok(failures.some((f) => f.startsWith('exec_sql(sql text)') && f.includes('nessun grant')));
});

test('evaluateFunctionPrivileges: OBIETTIVO FASE 2 — nuova funzione SECURITY DEFINER non in baseline, EXECUTE a authenticated -> FAILURE (non warning)', () => {
  // Lo scenario esplicito richiesto: "tra un mese qualcuno introduce
  // CREATE FUNCTION ... SECURITY DEFINER e lascia EXECUTE a authenticated,
  // la CI deve fallire". Prima dell'hardening questo produceva solo un
  // warning (hasWarning), exit code 0.
  const rows = [
    fnRow({ full_signature: 'nuova_funzione_pericolosa(uuid)', grantee: 'authenticated', is_security_definer: true }),
  ];
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(warnings.length, 0);
  assert.ok(failures.some((f) => f.includes('nuova_funzione_pericolosa') && f.includes('SECURITY DEFINER')));
});

test('evaluateFunctionPrivileges: nuova funzione SECURITY DEFINER non in baseline, EXECUTE a PUBLIC -> failure', () => {
  const rows = [
    fnRow({ full_signature: 'altra_funzione(text)', grantee: 'PUBLIC', is_security_definer: true }),
  ];
  const { failures } = evaluateFunctionPrivileges(rows);
  assert.ok(failures.some((f) => f.includes('altra_funzione')));
});

test('evaluateFunctionPrivileges: nuova funzione SECURITY DEFINER non in baseline, EXECUTE a anon -> failure', () => {
  const rows = [
    fnRow({ full_signature: 'terza_funzione(text)', grantee: 'anon', is_security_definer: true }),
  ];
  const { failures } = evaluateFunctionPrivileges(rows);
  assert.ok(failures.some((f) => f.includes('terza_funzione')));
});

test('evaluateFunctionPrivileges: nuova funzione SECURITY DEFINER non in baseline, SOLO service_role -> nessuna failure/warning per quella funzione (comportamento sicuro di default)', () => {
  const rows = [
    fnRow({ full_signature: 'funzione_gia_sicura(uuid)', grantee: 'service_role', is_security_definer: true }),
  ];
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(failures.filter((f) => f.includes('funzione_gia_sicura')).length, 0);
  assert.equal(warnings.filter((w) => w.includes('funzione_gia_sicura')).length, 0);
});

test('evaluateFunctionPrivileges: nuova funzione NON SECURITY DEFINER (invoker rights) non in baseline, EXECUTE a authenticated -> warning, non failure', () => {
  // Non la stessa classe di rischio: gira coi privilegi del chiamante,
  // resta soggetta alla RLS reale delle tabelle che tocca.
  const rows = [
    fnRow({ full_signature: 'funzione_invoker(uuid)', grantee: 'authenticated', is_security_definer: false }),
  ];
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(failures.filter((f) => f.includes('funzione_invoker')).length, 0);
  assert.ok(warnings.some((w) => w.includes('funzione_invoker') && w.includes('invoker rights')));
});

test('evaluateFunctionPrivileges: funzioni di estensione e trigger sono ignorate anche con grant PUBLIC', () => {
  const rows = [
    fnRow({ full_signature: 'pg_trgm_helper()', grantee: 'PUBLIC', is_extension_function: true, is_security_definer: true }),
    fnRow({ full_signature: 'update_updated_at_column()', grantee: 'PUBLIC', is_trigger: true, is_security_definer: true }),
  ];
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(failures.filter((f) => f.includes('pg_trgm_helper') || f.includes('update_updated_at_column')).length, 0);
  assert.equal(warnings.filter((w) => w.includes('pg_trgm_helper') || w.includes('update_updated_at_column')).length, 0);
});

test('evaluateFunctionPrivileges: grantee "postgres" (owner) ignorato, non conta come grant rischioso', () => {
  const rows = [
    fnRow({ full_signature: 'funzione_owner_only(uuid)', grantee: 'postgres', is_security_definer: true }),
  ];
  const { failures, warnings } = evaluateFunctionPrivileges(rows);
  assert.equal(failures.filter((f) => f.includes('funzione_owner_only')).length, 0);
  assert.equal(warnings.filter((w) => w.includes('funzione_owner_only')).length, 0);
});
