import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
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
  // Header di sicurezza a rischio zero (nessuna CSP): il backend Express ha
  // già CSP/HSTS/X-Frame-Options via Helmet (server.js), il frontend Next.js
  // no. Qui solo gli header che non richiedono di conoscere in anticipo ogni
  // script/font/iframe di terze parti usato dalle pagine (Stripe.js, Google
  // Fonts, Supabase realtime...) — una CSP scritta senza poter testare il
  // build reale su Vercel rischierebbe di rompere qualcosa in produzione
  // senza preavviso. Permissions-Policy lascia esplicitamente il microfono
  // per il dettato vocale del Creator/Comandi AI (useVoiceInput.ts).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
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
