/* Service worker aplikacji PWA (WN-03, WN-05).
 * - pliki statyczne: cache-first (nazwy z hashem nie zmieniają treści),
 * - strony aplikacji: network-first, ale jeśli serwer nie odpowie w 3 s (np. darmowy hosting wybudza się
 *   po przerwie), od razu zapisana powłoka - aplikacja otwiera się natychmiast i sama pokazuje komunikat
 *   o łączeniu; odpowiedź serwera i tak trafia do pamięci na następny raz,
 * - odczyty API (GET): network-first z powrotem do ostatniej odpowiedzi,
 *   dzięki czemu plan i baza ćwiczeń są dostępne bez połączenia.
 * Zapisy (POST) nie są tu buforowane - obsługuje je kolejka w src/lib/offline.ts.
 */
const VERSION = 'silownik-v11';
const SHELL_TIMEOUT_MS = 3000;
const STATIC = `${VERSION}-static`;
const RUNTIME = `${VERSION}-runtime`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(RUNTIME).then((c) => c.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Strona po starcie przesyła listę plików, które już załadowała.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CACHE_URLS') {
    caches.open(STATIC).then((c) => c.addAll(event.data.urls).catch(() => {}));
  }
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackUrl ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackUrl ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function shellFirstAfterTimeout(request) {
  const cache = await caches.open(RUNTIME);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(SHELL, response.clone());
    return response;
  });
  const cached = await cache.match(SHELL);
  if (!cached) return network;   // pierwsze uruchomienie - nie ma jeszcze zapisanej powłoki
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), SHELL_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/auth/') || url.pathname === '/api/health/' || url.pathname === '/api/ping/') return;
  if (url.pathname.startsWith('/api/reports/')) return;

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(shellFirstAfterTimeout(request));
  }
});
