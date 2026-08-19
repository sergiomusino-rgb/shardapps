// ─── Password hashing — Pre-Beta Hardening, Blocco 6 ───────────────────────
// Controparte TypeScript di backend/lib/password-hash.js — stessa
// interfaccia, stessa libreria (bcryptjs), stesso motivo dei due moduli
// separati (frontend Next.js e backend Express sono due progetti npm
// distinti). Vedi il commento esteso in quel file per il perché di
// bcryptjs invece di bcrypt/argon2 nativi e per la strategia di migrazione
// (verify-then-rehash, mai una riscrittura bulk del DB).

import bcrypt from 'bcryptjs';
// Riesportata da qui per i chiamanti server-side esistenti (mai un secondo
// import da spostare): vedi password-hash-shape.ts per il perché è un file a
// parte (l'unico consumer client-side di looksHashed non deve mai bundlare
// bcryptjs solo per un test di regex).
import { looksHashed } from './password-hash-shape.ts';
export { looksHashed };

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

export interface VerifyPasswordResult {
  match: boolean;
  /** true SOLO quando il match riesce su un valore ancora in chiaro (account
   * legacy non ancora migrato) — il chiamante deve riscrivere l'hash subito. */
  needsRehash: boolean;
}

/** Vedi backend/lib/password-hash.js::verifyPassword — stessa logica. */
export async function verifyPassword(plain: unknown, stored: unknown): Promise<VerifyPasswordResult> {
  if (typeof stored !== 'string' || !stored || typeof plain !== 'string' || !plain) {
    return { match: false, needsRehash: false };
  }
  if (looksHashed(stored)) {
    try {
      const match = await bcrypt.compare(plain, stored);
      return { match, needsRehash: false };
    } catch {
      return { match: false, needsRehash: false };
    }
  }
  const match = stored === plain;
  return { match, needsRehash: match };
}
