// 스터디 메이트 서비스 워커: 홈 화면 설치 + 푸시 알림
const CACHE = 'studymate-v2';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.json', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 앱 파일은 항상 서버에서 최신으로 받아오고(브라우저 임시 저장 무시), 인터넷 없으면 저장본 사용
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request)),
  );
});

self.addEventListener('push', (e) => {
  let data = { title: '스터디 메이트', body: '친구가 뭔가 보냈어요' };
  try { data = Object.assign(data, e.data.json()); } catch (err) { /* */ }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [200, 100, 200, 100, 400], tag: 'studymate', renotify: true,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
