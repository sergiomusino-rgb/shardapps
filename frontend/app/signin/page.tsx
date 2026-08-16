// ─── /signin — redirect verso il login reale ───────────────────────────────
// Audit commerciale pre-lancio: questa pagina non era collegata da nessun
// link interno (verificato: nessun href="/signin" in tutto il repo), ma
// restava raggiungibile a URL diretto — "/signin" è un pattern di URL
// talmente standard che un visitatore può digitarlo per tentativo. Il form
// che c'era prima non chiamava mai Supabase Auth ("Per ora simuliamo
// l'autenticazione...", commento originale): accettava qualunque
// email/password e reindirizzava sempre a /dashboard, che però richiede una
// sessione reale (AuthGuard) e avrebbe rimandato subito a /login — un login
// che sembra funzionare ma non autentica mai nessuno è peggio di un 404.
// Fix minimo: redirect server-side verso /login, l'unica pagina di
// login/registrazione reale (Supabase Auth) del prodotto.
import { redirect } from 'next/navigation';

export default function SignInRedirect() {
  redirect('/login');
}
