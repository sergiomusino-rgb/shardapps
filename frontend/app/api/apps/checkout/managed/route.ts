import { NextResponse } from 'next/server';

// ============================================================================
// Route Managed Payments DISMESSA (Fase 3B, cleanup 2026-08-09)
// ----------------------------------------------------------------------------
// Verificato (audit Fase 3B, item F): nessun chiamante reale in tutto il
// repository — né UI (nessun fetch/router.push verso /api/apps/checkout/
// managed), né backend, né lo script di stress-test
// backend/scripts/e2e_lifecycle_test.js (che esercita solo l'endpoint
// gemello /api/apps/checkout, modello Stripe Connect, non questo).
//
// Era un tentativo precedente e abbandonato di implementare il checkout
// Managed Payments (Merchant of Record) per l'abbonamento del cliente
// finale: autenticava/autorizzava il RESELLER (tenant.owner_id) invece del
// cliente finale che deve effettivamente pagare — incoerente con la
// semantica "Managed Payments" dichiarata nei suoi stessi commenti. I suoi
// success_url/cancel_url (/success?app_id=..., /checkout?app_id=...) non
// combaciano nemmeno col contratto attuale di quelle pagine (/success si
// aspetta appSlug, non app_id; /checkout è una demo statica che ignora
// app_id).
//
// L'implementazione corretta e attualmente in produzione è
// frontend/app/api/a/[slug]/create-checkout-session/route.ts: stesso
// modello Managed Payments, ma senza controllo di ownership (è il cliente
// finale, non il reseller, ad aprire la pagina pubblica /a/{slug} e pagare),
// con redirect coerenti verso /a/{slug}/dashboard. Nessuna delle scritture
// legacy di questo file (tabella "transactions", creazione Product/Price
// dedicati) è quindi più necessaria: la route corretta non le duplica.
//
// Stub 410 invece di eliminazione: se qualcosa (link salvato, integrazione
// esterna, bookmark) puntasse ancora qui per errore, l'endpoint deve
// rispondere in modo esplicito e innocuo — non un 404 generico né,
// peggio, rieseguire silenziosamente un flusso di pagamento superato e
// mai stato correttamente autorizzato lato cliente finale.
// ============================================================================

const GONE_RESPONSE = {
  error: 'This endpoint has been retired. Use /api/a/[slug]/create-checkout-session instead.',
};

export async function POST() {
  return NextResponse.json(GONE_RESPONSE, { status: 410 });
}

export async function GET() {
  return NextResponse.json(GONE_RESPONSE, { status: 410 });
}
