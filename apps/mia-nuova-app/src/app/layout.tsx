import './globals.css';
import type { Metadata } from 'next';
import SubscriptionAlert from '../components/SubscriptionAlert';

export const metadata: Metadata = {
  title: 'Mia Nuova App - ZEUSX',
  description: 'Applicazione generata con ZEUSX Entity Builder',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // TODO: Sostituire con l'ID reale dell'app dal contesto/params
  const appId = process.env.NEXT_PUBLIC_APP_ID || 'mock-app-id';

  return (
    <html lang="it">
      <body className="min-h-screen bg-slate-950">
        <SubscriptionAlert appId={appId} />
        {children}
      </body>
    </html>
  );
}