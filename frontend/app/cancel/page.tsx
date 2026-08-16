"use client";

import Link from 'next/link';

export default function CancelPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center">
      <div className="bg-white p-8 rounded-2xl shadow-lg border border-red-100 max-w-md w-full">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Pagamento annullato</h1>
        <p className="text-gray-600 mb-6">
          Nessun addebito è stato effettuato. Puoi riprovare quando sei pronto.
        </p>

        <div className="flex flex-col gap-3">
          {/* Audit commerciale pre-lancio: "/checkout" non è mai stata una
              route reale del prodotto (404) — nessun checkout di questo
              repo usa /cancel come propria cancel_url (tutti tornano a
              /pricing o alla dashboard dell'app), quindi questa pagina non
              era mai raggiunta dal flusso reale, ma i link restavano rotti
              per chiunque ci arrivasse a URL diretto. Corretti verso le
              uniche destinazioni reali equivalenti. */}
          <Link
            href="/pricing"
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Riprova il pagamento
          </Link>
          <Link
            href="/"
            className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
          >
            Torna alla Home
          </Link>
        </div>
      </div>
    </div>
  );
}