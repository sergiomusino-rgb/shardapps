// ─── Decisione pura di esposizione — GET /api/public/apps/[slug]/records ───
// Stesso pattern di catalog-checkout-authorization.js/catalog-provision-
// authorization.js: nessun I/O qui, la route risolve app+blueprint+entity e
// passa solo i dati già letti; questa funzione decide soltanto se
// quell'entità è REALMENTE pubblica.
//
// Audit pre-lancio 2026-08-14, BLOCKER #1: "pubblica" significa sempre e
// solo "referenziata da una sezione 'list'/'form' di una pagina pubblica del
// blueprint" — MAI "l'app non ha auth_mode='rbac'". Prima di questa patch la
// route applicava questo controllo solo per le app rbac; per qualunque altra
// app (la maggioranza, dato che il generatore lascia authConfig disabilitato
// di default) qualunque entità dichiarata in adminPanel.entities era
// leggibile qui senza credenziali per il solo fatto di esistere nello
// schema — anche un'entità di sola gestione interna (clienti, ordini,
// fornitori) mai referenziata da una pagina pubblica. Estratta qui per poter
// essere testata senza montare Next.js/Supabase, stesso motivo di tutti gli
// altri moduli *-authorization.js di questa cartella.
function isEntityExposedInPublicPages(blueprint, entityName) {
  return blueprint.pages.some((page) =>
    page.sections.some((section) =>
      (section.type === 'list' || section.type === 'form') && section.entity === entityName
    )
  );
}

module.exports = { isEntityExposedInPublicPages };
