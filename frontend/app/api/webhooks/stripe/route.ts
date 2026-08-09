import { NextResponse } from 'next/server';

// ============================================================================
// Webhook Stripe DISMESSO (Fase 3, cleanup 2026-08-09)
// ----------------------------------------------------------------------------
// Questo endpoint non è configurato come webhook su Stripe Dashboard in
// produzione, e non è referenziato da nessun percorso applicativo o di
// test reale. In particolare: backend/scripts/e2e_lifecycle_test.js — il
// motivo per cui questo file era stato tenuto in vita finora — chiama in
// realtà solo BACKEND_URL/api/webhooks/stripe (backend/server.js), MAI
// questo endpoint (verificato leggendo l'intero script, non solo il
// commento che lo affermava, che era impreciso).
//
// backend/server.js è l'UNICO webhook Stripe autoritativo del progetto:
// gestisce sia il ciclo di vita del piano reseller (tenants/subscriptions,
// con guardia anti-fuori-ordine e idempotenza condivise via
// backend/lib/stripe-webhook-logic.js) sia, dalla Fase 3, quello
// dell'abbonamento cliente finale (apps.status). Tutta la logica prima
// duplicata qui (handleCheckoutSessionCompleted, handleInvoicePaid,
// handleAppSubscriptionUpdated, handlePaymentFailed,
// handleUserSubscriptionCancelled, handleOAuthDeauthorized) è stata
// rimossa: era irraggiungibile, la versione autoritativa vive in
// backend/server.js.
//
// Stub 410 invece di eliminare il file: se Stripe Dashboard fosse mai
// ripuntato qui per errore, l'endpoint deve rispondere in modo esplicito e
// innocuo — non un 404 generico né, peggio, rielaborare silenziosamente
// gli eventi in parallelo al webhook autoritativo (che ha idempotenza e
// guardia anti-fuori-ordine condivise; questo stub non le duplica più).
// ============================================================================

const GONE_RESPONSE = {
  error: 'Endpoint dismesso. Il webhook Stripe autoritativo è backend/server.js (/api/webhooks/stripe).',
};

export async function POST() {
  return NextResponse.json(GONE_RESPONSE, { status: 410 });
}

export async function GET() {
  return NextResponse.json(GONE_RESPONSE, { status: 410 });
}
