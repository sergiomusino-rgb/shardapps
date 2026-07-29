// Prezzo dell'abbonamento mensile che il cliente finale paga per un'app: non è
// fisso, lo decide il reseller (tenant) per ogni app dalla pagina Management
// (client_subscription_price / client_price, minimo 25€). 25€ è la quota
// minima che spetta a ZeusX — se il reseller vende l'app a 70€/mese, 25€
// restano alla piattaforma e i restanti 45€ al reseller.
export const ZEUSX_MINIMUM_FEE_EUR = 25;

export function getClientSubscriptionPrice(app: {
  client_subscription_price?: number | null;
  client_price?: number | null;
}): number {
  return app.client_subscription_price || app.client_price || ZEUSX_MINIMUM_FEE_EUR;
}
