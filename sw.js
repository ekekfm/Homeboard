/* 홈보드 서비스 워커: 앱 화면은 저장해 두고 오프라인에서도 열리게, 뉴스는 항상 새로 받아온다. */
const CACHE = "homeboard-v10";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // 날씨 등 외부 요청은 그대로 통과

  const put = (res) => {
    if (res && (res.ok || res.type === "opaque")) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (sameOrigin && url.pathname.endsWith("briefing.json")) {
    // 뉴스: 새 것을 먼저, 실패하면 저장본
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req)));
    return;
  }
  if (isFont) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
    return;
  }
  // 앱 화면: 새 것을 먼저 시도하고, 오프라인이면 저장본
  e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
});

// 기기 알림을 누르면 홈보드를 앞으로 가져오거나 새로 연다
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { if ("navigate" in c) c.navigate(url).catch(() => {}); return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
