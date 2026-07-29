'use client';

import { supabase } from '@/src/lib/supabase';

export default function CheckoutPage() {
  const totalum_app_id = 'pizzeria'; // ID dell'app per cui creare il checkout

  const handleUpgrade = async () => {
    try {
      // Chiama l'API locale per creare la sessione di checkout con split payment
      const res = await fetch(`/api/totalum-client/checkout?totalum_app_id=${totalum_app_id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        alert("Errore: " + (data.error || "Sessione non creata"));
      }
    } catch (err) {
      console.error("Errore:", err);
      alert("Errore di connessione al server.");
    }
  };

  // URL per accedere all'app (con slug)
  const appUrl = `http://localhost:3000/a/pizzeria-mr6n7ces`;

  return (
    <div className="p-12 text-center">
      <h1 className="text-2xl font-bold mb-6">Completa il tuo abbonamento</h1>
      <p className="text-gray-600 mb-4">Abbonamento per: La Mia Pizzeria Test (100€/mese)</p>
      <button 
        onClick={handleUpgrade}
        className="bg-blue-600 text-white px-8 py-4 rounded-lg font-bold hover:bg-blue-700"
      >
        Paga ora
      </button>
    </div>
  );
}
