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
      allowedOrigins: ['localhost:3000', 'zeusx.app', 'www.zeusx.app', 'zeusxapps.com'],
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
