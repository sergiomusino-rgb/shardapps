'use client';

// ─── Public API v1 — documentazione (Fase 11) ──────────────────────────────
// Pagina statica (nessun dato sensibile, nessuna chiamata di rete): spiega
// al reseller come usare la Public API v1 (backend/routes/public-api.js) con
// la propria API key. Nessuna API key reale in questo file, solo placeholder.

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.shardapps.com';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-950 border border-slate-800 p-4 text-xs text-gray-200 font-mono">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

export default function ApiDocsPage() {
  const params = useParams();
  const slug = params.slug as string;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-3xl mx-auto">
        <Link
          href={`/a/${slug}/settings`}
          className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 mb-6"
        >
          <ArrowLeft size={15} /> Torna a Impostazioni
        </Link>

        <h1 className="text-3xl font-bold mb-2">Public API v1</h1>
        <p className="text-gray-400 mb-8">
          Accedi ai dati di questa app da software esterni tramite una API key dedicata.
          Genera una chiave in Settings → Data &amp; API.
        </p>

        <Section title="Base URL">
          <CodeBlock>{`${BACKEND_URL}/api/v1/apps/APP_ID`}</CodeBlock>
          <p>
            <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">APP_ID</code> è l&apos;identificativo
            della tua app, visibile nell&apos;URL della dashboard o nella risposta di creazione della chiave.
          </p>
        </Section>

        <Section title="Autenticazione">
          <p>Ogni richiesta deve includere la API key nell&apos;header Authorization:</p>
          <CodeBlock>{'Authorization: Bearer YOUR_API_KEY'}</CodeBlock>
          <p>
            Una API key è vincolata a UNA sola app: non può mai essere usata per accedere ai dati di
            un&apos;altra app o di un altro account, anche a parità di titolare.
          </p>
          <p>
            Ogni chiave ha uno scope: <strong>read</strong> (sola lettura) oppure <strong>read + write</strong>.
            Una chiave read-only riceve <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">403</code> su
            POST/PATCH/DELETE.
          </p>
        </Section>

        <Section title="GET /entities — elenco entità disponibili">
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/entities`}</CodeBlock>
        </Section>

        <Section title="GET /schema — struttura dati pubblica">
          <p>Restituisce nome, label, campi (tipo, obbligatorietà, opzioni, relazioni) di ogni entità.</p>
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/schema`}</CodeBlock>
        </Section>

        <Section title="GET /entities/:entity — elenco record">
          <p>
            Parametri opzionali: <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">limit</code>{' '}
            (default 50, max 200), <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">offset</code>,{' '}
            <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">sort</code> (created_at | updated_at),{' '}
            <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">order</code> (asc | desc), più un filtro
            di uguaglianza per ogni campo dell&apos;entità (es. <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">?stato=aperto</code>).
          </p>
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${BACKEND_URL}/api/v1/apps/APP_ID/entities/clienti?limit=20&sort=created_at&order=desc"`}</CodeBlock>
        </Section>

        <Section title="GET /entities/:entity/:id — singolo record">
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/entities/clienti/RECORD_ID`}</CodeBlock>
        </Section>

        <Section title="POST /entities/:entity — crea un record (richiede scope write)">
          <CodeBlock>{`curl -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"nome": "Mario Rossi", "email": "mario@esempio.it"}' \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/entities/clienti`}</CodeBlock>
        </Section>

        <Section title="PATCH /entities/:entity/:id — aggiorna un record (richiede scope write)">
          <p>Aggiornamento parziale: solo i campi inviati vengono modificati.</p>
          <CodeBlock>{`curl -X PATCH \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "nuovo@esempio.it"}' \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/entities/clienti/RECORD_ID`}</CodeBlock>
        </Section>

        <Section title="DELETE /entities/:entity/:id — elimina un record (richiede scope write)">
          <CodeBlock>{`curl -X DELETE \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/entities/clienti/RECORD_ID`}</CodeBlock>
        </Section>

        <Section title="GET /export — export completo (ZIP)">
          <p>Manifest, schema, definizioni delle tabelle personalizzate e tutti i record, in JSON + CSV.</p>
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  -o export.zip \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/export`}</CodeBlock>
        </Section>

        <Section title="GET /health — verifica rapida della chiave">
          <CodeBlock>{`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${BACKEND_URL}/api/v1/apps/APP_ID/health`}</CodeBlock>
        </Section>

        <Section title="Rate limit">
          <p>
            Ogni API key è limitata a <strong>100 richieste al minuto</strong>. Oltre la soglia, ogni richiesta
            aggiuntiva riceve <code className="bg-slate-900 px-1.5 py-0.5 rounded text-xs">429 Too Many Requests</code>{' '}
            finché la finestra non si resetta.
          </p>
        </Section>

        <Section title="Risposte di errore">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ['401', 'API key mancante, malformata, non valida, revocata o scaduta'],
                ['403', 'API key valida ma non autorizzata (app diversa, scope mancante, abbonamento non attivo)'],
                ['404', 'App o entità/record non trovato'],
                ['429', 'Rate limit superato per questa API key'],
              ].map(([code, desc]) => (
                <tr key={code} className="border-t border-slate-800">
                  <td className="py-2 pr-4 font-mono text-gray-200">{code}</td>
                  <td className="py-2 text-gray-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
