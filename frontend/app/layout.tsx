import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/src/lib/LanguageContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  // Include emoji support for flag emojis
  fallback: ["emoji"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShardApps - Generazione Gestionali AI",
  description: "Crea gestionali personalizzati con intelligenza artificiale per il tuo business",
  // manifest.json esisteva in public/ ma non era mai collegato: il sito
  // principale (dashboard/pricing/login) non risultava installabile come
  // PWA nonostante il file fosse pronto.
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
    apple: '/icons/icon-192x192.png',
  },
  // Campo tipizzato di Next.js invece di <meta> manuali in <head>: genera da
  // solo apple-mobile-web-app-capable/status-bar-style/title, evitando sia
  // l'assenza dei tag Apple sia un doppione se in futuro si aggiungessero a
  // mano anche i <meta> equivalenti.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ShardApps',
  },
};

// Esplicito invece di affidarsi al default di Next: senza width=device-width
// i browser mobili renderizzano a una viewport desktop (~980px) e poi
// rimpiccioliscono tutto, vanificando qualunque classe responsive. Il
// theme-color qui è solo il fallback prima dell'idratazione: ogni app
// generata (Comandi incluso, vedi hooks/usePwaSetup) lo sovrascrive
// client-side col proprio colore di brand.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#020617',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Google Fonts per i Design System: qui e non via next/font perche'
            l'insieme di famiglie e' scelto dinamicamente per ogni sito
            generato (design system diverso per settore/tenant), non
            un elenco statico che next/font possa risolvere a build time.
            La regola no-page-custom-font e' pensata per il Pages Router
            (dove esiste _document.js) — in App Router questo <link> nel
            root layout si applica gia' a ogni pagina, non solo a una. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@400;500;600&family=Playfair+Display:wght@400;500;600;700;800&family=Fraunces:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col mobile-scroll-container">
        <LanguageProvider>{children}</LanguageProvider>
      </body>

    </html>
  );
}