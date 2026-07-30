'use client';

// ─── /a/[slug]/gestionale ───────────────────────────────────────────────────
// Piattaforma unificata: l'Area Riservata è un'unica implementazione (Area
// Riservata v1, ViewerProFinal in ../app/page.tsx), condivisa da questa route
// e da /a/[slug]/app — le app del motore Sito/PWA (Creator v2) vi arrivano
// con le proprie config.adminPanel.entities adattate al motore tabellare v1
// (vedi adaptAdminEntitiesToTables in ../app/page.tsx), niente più pannello
// separato e ridotto.
export { ViewerProFinal as default } from '../app/page';
