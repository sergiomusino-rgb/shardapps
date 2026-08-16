import type { Metadata } from 'next';
import PrivacyClient from './PrivacyClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

const title = 'Informativa Privacy — ShardApps';
const description = 'Come ShardApps raccoglie, utilizza e protegge i dati personali degli utenti e dei loro clienti finali.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/privacy` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/privacy`,
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
  return <PrivacyClient />;
}
