// ── Carnatic Practice — Service Worker ────────────────────────────────────
// !! BUMP CACHE_VERSION ON EVERY DEPLOY !!
// Change the string below (e.g. cmp-v68) before pushing to GitHub.
// The browser detects the change and installs the updated worker automatically.
const CACHE_VERSION = 'abhyasa-v1';

// Files to cache on install — these are served instantly from cache
// even on slow connections. cmpasset01.ogg is included so Tanpura
// works immediately without a network fetch on every session.
const STATIC_FILES = [
  '/index.html',
  '/app.html',
  '/config.js',
  '/app.js',
  '/practice-scoring.js',
  '/data.js',
  '/styles.css',
  '/cmpasset01.ogg',
  '/manifest.json',
  '/supabase.min.js',
  'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600&display=swap'
];

// ── INSTALL — cache all static files ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // Cache files individually so one failure doesn't block the rest
      return Promise.allSettled(
        STATIC_FILES.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Could not cache:', url, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — delete old caches from previous versions ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — serve from cache, fall back to network ────────────────────────
// Strategy: Cache-first for static assets, network-first for HTML pages.
// HTML pages are fetched fresh so session guard always runs with latest code.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always fetch HTML fresh from network (so auth redirects work correctly)
  // Fall back to cache only if network fails (true offline mode)
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update the cache with the fresh response
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Only handle http/https — skip chrome-extension and other schemes
  // IMPORTANT: these checks must happen BEFORE event.respondWith() is called.
  // Returning true in a listener without responding closes the message channel (Chrome bug).
  let reqUrl2;
  try { reqUrl2 = new URL(event.request.url); } catch(e) { return; }
  if (reqUrl2.protocol !== 'http:' && reqUrl2.protocol !== 'https:') return;

  // Only cache GET requests — POST/PUT etc. cannot be cached
  if (event.request.method !== 'GET') return;

  // For all other assets (JS, CSS, audio, fonts): cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Not in cache — fetch from network and cache for next time
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

// ── MESSAGE — force update from app ───────────────────────────────────────
// Call this from app.js if you want to force a cache refresh:
// navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' })
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
