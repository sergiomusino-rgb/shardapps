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
  title: "ZeusX - Generazione Gestionali AI",
  description: "Crea gestionali personalizzati con intelligenza artificiale per il tuo business",
  icons: {
    icon: '/favicon.png',
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
        {/* Google Fonts per i Design System */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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