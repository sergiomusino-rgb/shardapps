import type { Metadata } from 'next';
import HomeClient from './HomeClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

const title = 'ShardApps — Crea e rivendi gestionali AI col tuo brand';
const description =
  "ShardApps genera con l'AI gestionali e app web/PWA complete di database, CRUD e workflow. Personalizzale via chat, brandizzale col tuo logo e rivendile ai tuoi clienti: pensato per agenzie, freelancer e reseller.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title,
    description,
    url: SITE_URL,
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

// JSON-LD Organization: unico blocco strutturato di questa pagina — dati
// verificabili (nome, url, logo) senza inventare rating/reviews/prezzi che
// Google potrebbe segnalare come dati strutturati non verificabili.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: DEFAULT_OG_IMAGE,
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <HomeClient />
    </>
  );
}
