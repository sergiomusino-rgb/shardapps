import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // ffmpeg-static espone il path del binario tramite require.resolve interno:
  // va escluso dal bundling dei Server Components (che altrimenti prova a
  // riscriverne il path) e caricato con require() nativo di Node. Vedi uso in
  // app/api/concat-videos/route.ts.
  serverExternalPackages: ['ffmpeg-static'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['localhost:3000', 'zeusx.app', 'www.zeusx.app'],
    },
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
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.NEXT_PUBLIC_BACKEND_URL || "https://zeusx-backend.onrender.com"}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
