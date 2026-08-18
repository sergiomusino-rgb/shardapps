import type { Metadata } from 'next';
import TermsClient from './TermsClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

const title = 'Termini e Condizioni — ShardApps';
const description = 'Le condizioni per l\'utilizzo del Servizio ShardApps: piani, fatturazione, slot app, periodo di prova, cancellazione e responsabilità.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/terms` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/terms`,
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
  return <TermsClient />;
}
