import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// ─── Pre-launch hardening: nessuna sitemap esisteva prima. Elenca solo le
// pagine pubbliche di contenuto reale (landing, prezzi, termini, privacy) —
// non /login (noindex, vedi app/login/page.tsx), non /success, /cancel,
// /vision, /a/[slug]/* (pagine transazionali o per-tenant, nessun valore
// SEO proprio), non /comandi (prodotto separato, non ancora collegato dalla
// landing principale — fuori scope di questo hardening).
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/info`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
