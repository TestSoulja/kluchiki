// Оболочка PWA (plan.md §10): stale-while-revalidate для файлов из списка
// и навигации. Запросы вне списка не перехватываются — это обычный fetch
// того же origin без кэша. Без зависимостей и только относительные адреса.
//
// Имя кэша — единственный номер версии в приложении. Новый файл в app/
// обязан попасть в SHELL, иначе tests/guard.test.mjs падает.

const CACHE_NAME = 'kluchiki-shell-8';

const SHELL = [
  './',
  './index.html',
  './about.html',
  './manifest.webmanifest',
  './app/about.css',
  './app/style.css',
  './app/main.js',
  './app/store-idb.js',
  './app/lib/backup.js',
  './app/lib/clipboard.js',
  './app/lib/csv.js',
  './app/lib/erase.js',
  './app/lib/generator.js',
  './app/lib/lock.js',
  './app/lib/nav.js',
  './app/lib/password-field.js',
  './app/lib/passkey.js',
  './app/lib/recovery.js',
  './app/lib/repo.js',
  './app/lib/search.js',
  './app/lib/session-store.js',
  './app/lib/unlock-order.js',
  './app/ui/card.js',
  './app/ui/create.js',
  './app/ui/csv.js',
  './app/ui/dom.js',
  './app/ui/erase.js',
  './app/ui/generator.js',
  './app/ui/icons.js',
  './app/ui/list.js',
  './app/ui/loss.js',
  './app/ui/passkey.js',
  './app/ui/recovery.js',
  './app/ui/slots.js',
  './app/ui/transfer.js',
  './app/ui/unlock.js',
  './src/aead.js',
  './src/bytes.js',
  './src/canonical.js',
  './src/kdf.js',
  './src/slots.js',
  './src/vault.js',
  './app/icons/icon-192.png',
  './app/icons/icon-512.png',
  './app/icons/icon-maskable-512.png',
];

const SHELL_PATHS = new Set(
  SHELL.map((entry) => new URL(entry, self.location.href).pathname),
);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            // Чужие кэши не трогаем: удаляем только свои прежние версии.
            // Текущий кэш исключён, иначе activate снёс бы оболочку,
            // которую только что наполнил install.
            .filter(
              (name) =>
                name.startsWith('kluchiki-') && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function shellResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  // Обновление идёт фоном: даже когда отдан кэш, следующая загрузка
  // получит уже новую оболочку. Ошибку сети здесь не показываем.
  const update = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        return cache.put(request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void update;
    return cached;
  }

  const fresh = await update;
  if (fresh) return fresh;

  if (request.mode === 'navigate') {
    const fallback = await cache.match(new URL('./', self.location.href).href);
    if (fallback) return fallback;
  }
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL_PATHS.has(url.pathname)) return;
  // Навигация на корень области (./) уже в списке: ответ берётся из кэша,
  // в фоне обновляется; офлайн корень отдаёт index.html.
  event.respondWith(shellResponse(request));
});
