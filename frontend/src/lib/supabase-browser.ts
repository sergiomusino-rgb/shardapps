// Alias storico: questo file esisteva come istanza separata (stesso storage
// key di src/lib/supabase.ts, GoTrueClient duplicato — vedi warning "Multiple
// GoTrueClient instances" nei log). Ora re-esporta la stessa istanza
// singleton invece di crearne una seconda, senza dover toccare i ~20 file che
// importano `supabaseBrowser` da qui.
export { supabase as supabaseBrowser } from './supabase';
