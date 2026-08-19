// ─── looksHashed — riconoscimento del formato, senza bcryptjs ─────────────
// Estratto da password-hash.ts (Pre-Beta Hardening, Blocco 6) in un modulo a
// parte SOLO per un motivo: è l'unica funzione di quel modulo usata anche da
// un componente client ('use client', dashboard/projects/[id]/page.tsx, per
// decidere se mostrare o nascondere client_password nel pannello). Import
// bcryptjs (usato da hashPassword/verifyPassword in password-hash.ts) non
// deve mai finire nel bundle browser solo per un test di regex — questo file
// non lo importa, password-hash.ts riesporta da qui per i chiamanti server.
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

export function looksHashed(value: unknown): value is string {
  return typeof value === 'string' && BCRYPT_HASH_RE.test(value);
}
