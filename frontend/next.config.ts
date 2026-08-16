import type { NextConfig } from "next";

// CSP costruita per elenco esplicito di origini realmente usate dal
// frontend (verificate nel codice, non per assunzione):
// - fonts.googleapis.com/gstatic.com: unico script/stylesheet di terze
//   parti caricato dal browser (Google Fonts in app/layout.tsx). Nessun
//   altro script esterno nel repo (niente Stripe.js: i pagamenti passano
//   per Stripe Payment Link via redirect a pagina intera, non embed).
//   Presenti anche in connect-src, non solo in style-src/font-src: il
//   service worker (public/sw.js) intercetta OGNI richiesta cross-origin
//   (url.hostname !== self.location.hostname) e la ri-esegue con un
//   proprio fetch() per popolare la cache — quel fetch() dentro il SW è
//   soggetto a connect-src, non a style-src/font-src (quelli valgono solo
//   per il <link>/@font-face caricati direttamente dal documento). Senza
//   questa voce il fetch del SW veniva bloccato dalla CSP, mai dalla
//   richiesta diretta del browser (verificato: l'errore compariva solo da
//   sw.js, mai come violazione diretta di style-src/font-src).
// - Supabase (ujdyqnzofclzztmppxea.supabase.co): client browser (src/lib/supabase.ts)
//   fa fetch REST diretti; stesso host serve anche i video generati da
//   Vision (riscaricati da fal.ai e ri-caricati su Supabase Storage, mai
//   servito da fal.ai al client — vedi app/api/generate-video/route.ts).
// - zeusx-backend.onrender.com: unico backend Express referenziato da
//   NEXT_PUBLIC_BACKEND_URL in tutto il repo (nessun altro dominio trovato).
// - Nessun iframe nel repo (grep su tutta la codebase) -> frame-src 'none'.
// script-src usa 'unsafe-inline' invece di un nonce per-richiesta: il
// pattern a nonce di Next richiede rendering dinamico su OGNI pagina
// (niente più pagine statiche/ISR: /pricing, /login, /management...),
// un cambio di architettura invasivo. 'unsafe-inline' è il livello base
// raccomandato da Next per chi non ha requisiti di compliance stretti;
// resta comunque un salto reale da "nessuna CSP" a un default-src 'self'
// che blocca exfiltration verso domini non whitelisted.
const isDev = process.env.NODE_ENV === 'development';
const SUPABASE_ORIGIN = 'https://ujdyqnzofclzztmppxea.supabase.co';
const SUPABASE_WS_ORIGIN = 'wss://ujdyqnzofclzztmppxea.supabase.co';
const BACKEND_ORIGIN = 'https://zeusx-backend.onrender.com';
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https:;
  font-src 'self' https://fonts.gstatic.com data:;
  media-src 'self' blob: ${SUPABASE_ORIGIN};
  connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WS_ORIGIN} ${BACKEND_ORIGIN} https://fonts.googleapis.com https://fonts.gstatic.com${isDev ? ' http://127.0.0.1:5005 http://localhost:5005 ws://localhost:3000 ws://127.0.0.1:3000' : ''};
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'self';
  upgrade-insecure-requests;
`.replace(/\s{2,}/g, ' ').trim();

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // Non esporre il framework via header HTTP (X-Powered-By: Next.js):
  // informazione gratuita per un attacker in fase di ricognizione, senza
  // alcun beneficio per il client legittimo.
  poweredByHeader: false,
  // ffmpeg-static espone il path del binario tramite require.resolve interno:
  // va escluso dal bundling dei Server Components (che altrimenti prova a
  // riscriverne il path) e caricato con require() nativo di Node. Vedi uso in
  // app/api/concat-videos/route.ts.
  serverExternalPackages: ['ffmpeg-static'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['localhost:3000', 'shardapps.com', 'www.shardapps.com', 'zeusx.app', 'www.zeusx.app', 'zeusxapps.com'],
    },
  },
  // I file designmd/*.md sono letti a runtime via fs.readFile (non
  // require/import), quindi il file tracer di Next.js non li individua da
  // solo per il bundle serverless: senza questa inclusione esplicita
  // sparirebbero dal deploy Vercel anche dopo aver spostato la cartella
  // dentro frontend/ (vedi lib/designSystemLoader.ts).
  outputFileTracingIncludes: {
    '/api/creator/generate': ['./designmd/**/*'],
  },
  turbopack: {
    root: __dirname,
  },
  // Explicitly expose Supabase env vars to the browser
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  // Header di sicurezza sul frontend: il backend Express ha già CSP/HSTS/
  // X-Frame-Options via Helmet (server.js). Permissions-Policy lascia
  // esplicitamente il microfono per il dettato vocale del Creator/Comandi
  // AI (useVoiceInput.ts). La CSP è costruita sopra da un elenco esplicito
  // di origini verificate nel codice — vedi commento su cspHeader.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspHeader },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ];
  },
  async rewrites() {
    // Only use backend rewrite in production
    if (process.env.NODE_ENV === 'production') {
      // Un array semplice qui viene trattato da Next.js come rewrite
      // "afterFiles": eseguito dopo le route statiche/filesystem ma PRIMA
      // delle route dinamiche ([slug], [id]...) — quindi /api/:path* dirottava
      // verso il backend Express ogni route API dinamica di Next.js
      // (verify-password, mark-first-login, apps/[id], ecc.), che non
      // veniva mai raggiunta: il backend rispondeva con un suo 404 ("Cannot
      // POST ...") mascherato da errore applicativo. "fallback" gira dopo
      // aver controllato anche le route dinamiche di Next.js, quindi il
      // proxy verso il backend scatta solo se Next.js non ha davvero nessuna
      // route (statica o dinamica) per quel path.
      return {
        fallback: [
          {
            source: "/api/:path*",
            destination: `${process.env.NEXT_PUBLIC_BACKEND_URL || "https://zeusx-backend.onrender.com"}/api/:path*`,
          },
        ],
      };
    }
    return [];
  },
};

export default nextConfig;
