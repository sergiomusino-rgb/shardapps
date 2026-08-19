import type { Metadata } from 'next';
import BetaClient from './BetaClient';
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE } from '@/lib/seo';

// Stesso pattern di app/page.tsx e app/pricing/page.tsx: Server Component
// sottile che esporta solo `metadata`, il contenuto/interattività vive in
// BetaClient.tsx ('use client'). Inglese come lingua di riferimento per
// title/description (a differenza delle altre pagine, in italiano) perché
// questa pagina è rivolta a un pubblico reseller internazionale — il
// contenuto in pagina resta comunque tradotto nelle 5 lingue via i18n.
const title = 'Private Beta — ShardApps for Agencies & Resellers';
const description =
  'Build, brand and resell AI-powered business apps for your clients. ShardApps is opening its Private Beta to a limited number of agencies, freelancers and resellers — apply now.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/beta` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/beta`,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_US',
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
  return <BetaClient />;
}
