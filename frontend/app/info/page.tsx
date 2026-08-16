import type { Metadata } from 'next';
import InfoClient from './InfoClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

const title = 'Termini e Condizioni e Prezzi — ShardApps';
const description =
  'Termini e Condizioni del servizio ShardApps e riepilogo dei piani Starter, Pro e Business per creare e rivendere gestionali AI.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/info` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/info`,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'it_IT',
    images: [{ url: DEFAULT_OG_IMAGE, width: 512, height: 512, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary',
    title,
    description,
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function Page() {
  return <InfoClient />;
}
