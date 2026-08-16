const CACHE_NAME = 'zeusx-app-v1';

// Cache on install
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate and clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Web Push (Fase B): il payload arriva come JSON da /api/apps/[id]/send-push
// ({ title, body, url, icon }). event.data può mancare (push "silenziosi" o
// malformati) o non essere JSON valido: in entrambi i casi si mostra comunque
// una notifica generica invece di far fallire silenziosamente l'evento.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Nuova notifica';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sulla notifica: porta al tab già aperto sull'URL di destinazione se
// esiste, altrimenti ne apre uno nuovo (comportamento standard PWA).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// Network-first per navigazioni HTML e chiamate API, cache-first per asset
// statici. In tutti i casi si cachano solo risposte GET con response.ok:
// una 404/500 transitoria (es. durante un rebuild del dev server) non deve
// restare bloccata in cache per sempre, altrimenti route valide continuano
// a risultare 404 anche dopo che il problema a monte è stato risolto.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const cachePut = (response) => {
    if (request.method === 'GET' && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  };

  // Fallback usato da ogni .catch() sotto: caches.match() risolve a
  // `undefined` quando non c'è nulla in cache (prima richiesta mai andata
  // a buon fine, es. bloccata dalla CSP o offline al primo utilizzo) —
  // event.respondWith(undefined) fa fallire il fetch event con
  // "TypeError: Failed to convert value to 'Response'", non un errore di
  // rete "pulito" gestibile lato pagina. Garantisce SEMPRE una vera
  // Response, anche quando non c'è nulla da servire.
  const respondFromCacheOrFallback = () =>
    caches.match(request).then((cached) => cached || new Response(null, { status: 504, statusText: 'Gateway Timeout' }));

  // Navigazioni HTML - network first: in sviluppo/uso online mostra sempre
  // la versione corrente della route, cade sulla cache solo se offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(cachePut)
        .catch(respondFromCacheOrFallback)
    );
    return;
  }

  // API calls - network first (cache only GET + ok requests)
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
    event.respondWith(
      fetch(request)
        .then(cachePut)
        .catch(respondFromCacheOrFallback)
    );
    return;
  }

  // Static assets - network first, come navigazioni/API. Prima era
  // cache-first: senza un CACHE_NAME che cambia ad ogni deploy, un chunk
  // richiesto una volta restava servito dalla cache per sempre anche dopo
  // un aggiornamento del codice (riprodotto durante un test: il dev server
  // veniva riavviato con codice nuovo ma il browser continuava a eseguire i
  // vecchi bundle JS). La cache resta comunque popolata (cachePut) e serve
  // da fallback per il funzionamento offline.
  event.respondWith(
    fetch(request)
      .then(cachePut)
      .catch(respondFromCacheOrFallback)
  );
});