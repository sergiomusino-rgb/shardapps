import type { Metadata } from 'next';
import PricingClient from './PricingClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

const title = 'Prezzi — ShardApps | Piani per agenzie e reseller';
const description =
  'Starter, Pro o Business: crea gestionali AI e rivendili ai tuoi clienti. Attivazione una tantum + 25€/mese per app attiva. White label incluso sul piano Business.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/pricing`,
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
  return <PricingClient />;
}
