// ─── Gate di accettazione Termini e Condizioni in fase di registrazione ────
// Logica pura estratta da app/login/page.tsx (handleRegister) per essere
// testabile con node:test (i .tsx non sono importabili direttamente).
//
// Regola: la chiamata a supabase.auth.signUp deve partire SOLO se questa
// funzione ritorna { ok: true }. Il login di utenti esistenti non usa
// questa funzione: nessun impatto sul flusso di login.

export type RegistrationValidationResult =
  | { ok: true }
  | { ok: false; errorKey: 'login_error_password_length' | 'login_error_terms_required' };

export function validateRegistrationSubmission(input: {
  password: string;
  termsAccepted: boolean;
}): RegistrationValidationResult {
  if (input.password.length < 6) {
    return { ok: false, errorKey: 'login_error_password_length' };
  }
  if (!input.termsAccepted) {
    return { ok: false, errorKey: 'login_error_terms_required' };
  }
  return { ok: true };
}
