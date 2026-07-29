'use client';

import { useEffect } from 'react';

// Registra il service worker e collega il manifest dinamico (per settore/app)
// dell'app generata. Usato sia dalla landing pubblica sia dalla dashboard
// autenticata, cosi' l'installazione PWA e' disponibile da entrambi i punti
// di ingresso di /a/[slug].
export function usePwaSetup(slug: string, themeColor?: string, appleTouchIcon?: string, appName?: string) {
  useEffect(() => {
    if (!slug) return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = `/a/${slug}/manifest`;

    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.name = name;
        document.head.appendChild(tag);
      }
      tag.content = content;
    };

    // iOS non legge il manifest per lo status bar/standalone: serve la coppia
    // di meta apple-mobile-web-app-* per un'esperienza standalone coerente.
    if (themeColor) setMeta('theme-color', themeColor);
    setMeta('apple-mobile-web-app-capable', 'yes');
    setMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    // Safari ignora "short_name" dal manifest per l'etichetta sotto l'icona in
    // Home, legge solo questo meta — senza, userebbe il <title> della pagina.
    if (appName) setMeta('apple-mobile-web-app-title', appName);

    // iOS ignora del tutto il campo "icons" del manifest per l'icona in Home:
    // legge solo <link rel="apple-touch-icon">, altrimenti usa uno screenshot
    // della pagina come icona.
    if (appleTouchIcon) {
      let appleIconLink = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (!appleIconLink) {
        appleIconLink = document.createElement('link');
        appleIconLink.rel = 'apple-touch-icon';
        document.head.appendChild(appleIconLink);
      }
      appleIconLink.href = appleTouchIcon;
    }
  }, [slug, themeColor, appleTouchIcon, appName]);
}
