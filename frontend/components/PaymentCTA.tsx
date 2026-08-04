'use client';

// ─── PaymentCTA ─────────────────────────────────────────────────────────────
// Rendering condizionale del modulo pagamenti opzionale Plug & Play: da
// piazzare in qualunque schermata con un importo da incassare (fattura,
// preventivo, prenotazione). Se il tenant ha attivato i pagamenti online E
// configurato un Payment Link Stripe valido, mostra "Paga Ora"/"Paga Acconto"
// che apre quel link in una nuova scheda; altrimenti mostra solo i metodi
// tradizionali, senza reindirizzare da nessuna parte.
//
// Uso tipico:
//   const { config } = useAppInfo();
//   <PaymentCTA paymentSettings={getPaymentSettings(config)} amountLabel="€120,00" />

import { CreditCard, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isOnlinePaymentActive, type PaymentSettings } from '@/src/lib/payment-settings';

interface PaymentCTAProps {
  paymentSettings: PaymentSettings;
  /** Importo già formattato da mostrare accanto al pulsante/allo stato (es. "€120,00"). */
  amountLabel?: string;
  /** 'full' → "Paga Ora" (saldo intero). 'deposit' → "Paga Acconto" (caparra/prenotazione). */
  mode?: 'full' | 'deposit';
  className?: string;
}

export default function PaymentCTA({ paymentSettings, amountLabel, mode = 'full', className }: PaymentCTAProps) {
  if (isOnlinePaymentActive(paymentSettings)) {
    return (
      <div className={className}>
        <a href={paymentSettings.stripeLink} target="_blank" rel="noopener noreferrer">
          <Button size="lg" className="w-full">
            <CreditCard size={18} />
            {mode === 'deposit' ? 'Paga Acconto' : 'Paga Ora'}
            {amountLabel ? ` — ${amountLabel}` : ''}
          </Button>
        </a>
        <p className="mt-1.5 text-center text-xs text-tenant-text-secondary">
          Pagamento sicuro gestito da Stripe. Verrai reindirizzato al checkout.
        </p>
      </div>
    );
  }

  // Pagamenti online non attivi: solo stato/metodi tradizionali, nessun link.
  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-lg border border-tenant-border bg-tenant-card-alt px-3.5 py-2.5 text-sm text-tenant-text-secondary">
        <Landmark size={16} className="shrink-0" />
        <span>
          {amountLabel ? `${amountLabel} da saldare` : 'Da saldare'} in sede o tramite bonifico bancario.
        </span>
      </div>
    </div>
  );
}
