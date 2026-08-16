// ─── Costanti SEO condivise tra le pagine pubbliche ─────────────────────────
// Pre-launch hardening: prima ogni pagina pubblica ereditava lo stesso
// title/description del layout root (le pagine erano tutte 'use client',
// che non possono esportare `metadata` di Next.js). Ogni page.tsx pubblico
// ora è un Server Component sottile che esporta metadata e renderizza il
// componente client esistente (rinominato *Client.tsx, stesso identico
// contenuto/logica) — nessuna modifica al comportamento della pagina.
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com').replace(/\/$/, '');
export const SITE_NAME = 'ShardApps';
// Nessuna immagine OG 1200x630 dedicata esiste ancora nel repo (solo asset
// legacy non verificati o non a tema: vedi audit) — favicon.png è l'unico
// asset di brand verificato in uso altrove nel prodotto, usato qui come
// fallback minimo. Un'immagine OG dedicata resta un miglioramento
// post-lancio, non bloccante.
export const DEFAULT_OG_IMAGE = `${SITE_URL}/favicon.png`;
