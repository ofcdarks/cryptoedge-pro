const CACHE_NAME = 'cryptoedge-v1.0.0';
const STATIC_ASSETS = [
  '/',
  '/css/app.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

// Install — cache static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: always network, never cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'Sem conexão' }), {
        headers: { 'Content-Type': 'application/json' }, status: 503
      })
    ));
    return;
  }

  // Static assets: cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(resp => {
          if (resp.ok && e.request.method === 'GET') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match('/offline.html') || new Response('Offline'));
    })
  );
});

// Background sync for API calls when offline
self.addEventListener('sync', e => {
  if (e.tag === 'sync-trades') {
    e.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // placeholder for future offline queue
}

// ─── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'CryptoEdge Pro', {
        body:  data.body  || '',
        icon:  data.icon  || '/icon-192.png',
        badge: data.badge || '/icon-32.png',
        data:  data.data  || {},
        vibrate: [200, 100, 200],
        tag: 'cryptoedge-' + (data.data?.type || 'general'),
        renotify: true,
      })
    );
  } catch(e) {}
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(cls => {
      if (cls.length > 0) { cls[0].focus(); return; }
      return clients.openWindow('/');
    })
  );
});

// ─── Install & Cache ──────────────────────────────────────────────────────────
const CACHE_V = 'cryptoedge-v2.0.0';
const CORE = ['/', '/css/app.css', '/js/app.js', '/js/features.js', '/offline.html',
              '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_V && k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  return self.clients.claim();
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trades') {
    event.waitUntil(fetch('/api/bot/equity').catch(()=>{}));
  }
});

// ─── Share Target ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/api/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const data = await event.request.formData();
      const title = data.get('title') || '';
      const text  = data.get('text')  || '';
      const u     = data.get('url')   || '';
      return Response.redirect(`/?shared=${encodeURIComponent(title||text||u)}`, 303);
    })());
    return;
  }
});

// ─── Capacitor Bridge (quando rodando como app nativo) ────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CAPACITOR_PUSH') {
    const { title, body, data } = event.data.payload || {};
    self.registration.showNotification(title || 'CryptoEdge Pro', {
      body, icon: '/icon-192.png', badge: '/icon-32.png', data,
      vibrate: [200, 100, 200], tag: 'cryptoedge'
    });
  }
});
