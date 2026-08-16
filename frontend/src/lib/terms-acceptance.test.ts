// ─── Test — gate accettazione Termini e Condizioni in registrazione ────────
// node:test nativo, nessuna dipendenza da React/DOM: copre esattamente i
// requisiti del task "ULTIMO FIX PRE-LANCIO: ACCETTAZIONE TERMINI":
//   - signup senza accettazione -> bloccato (nessuna chiamata supabase, per
//     costruzione: handleRegister chiama supabase.auth.signUp SOLO se
//     validateRegistrationSubmission ritorna ok: true)
//   - signup con accettazione -> procede
//   - il login normale non usa questa funzione -> invariato (verificato per
//     lettura di app/login/page.tsx: handleLogin non la importa/chiama)
//
// Uso: node --test "src/lib/terms-acceptance.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistrationSubmission } from './terms-acceptance.ts';

test('password valida + termini accettati -> ok: true (la registrazione può procedere)', () => {
  const result = validateRegistrationSubmission({ password: 'abcdef', termsAccepted: true });
  assert.deepEqual(result, { ok: true });
});

test('password valida + termini NON accettati -> bloccato con errorKey dedicato', () => {
  const result = validateRegistrationSubmission({ password: 'abcdef', termsAccepted: false });
  assert.deepEqual(result, { ok: false, errorKey: 'login_error_terms_required' });
});

test('password troppo corta (anche con termini accettati) -> bloccato su errore password, come da comportamento preesistente', () => {
  const result = validateRegistrationSubmission({ password: '123', termsAccepted: true });
  assert.deepEqual(result, { ok: false, errorKey: 'login_error_password_length' });
});

test('password troppo corta + termini non accettati -> il primo blocco è quello della password (comportamento preesistente invariato)', () => {
  const result = validateRegistrationSubmission({ password: '', termsAccepted: false });
  assert.deepEqual(result, { ok: false, errorKey: 'login_error_password_length' });
});
