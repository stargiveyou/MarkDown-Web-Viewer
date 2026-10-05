/*
 * 서비스 워커 — **푸시 알림 수신·클릭 처리만** 한다.
 *
 * ⚠️ fetch 이벤트를 가로채지 않고 아무것도 캐시하지 않는다.
 *    인증이 필요한 문서·API 응답이 기기 캐시에 남으면 로그아웃 후에도 읽힐 수 있다.
 *    이 파일은 미들웨어 인증에서 제외된 공개 경로라, 여기에 데이터를 넣지 않는다.
 *
 * 페이로드 형식: src/types/api.ts `PushNotificationPayload` { title, body, url, tag? }
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** 알림 클릭 시 열 경로 — 같은 origin의 앱 내부 경로만 허용한다. */
function safeAppPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/workspace';
  }
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : '/workspace';
  } catch {
    return '/workspace';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === 'string' && data.title ? data.title : 'Husky Works MDs';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: safeAppPath(data.url) },
  };
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag;

  // iOS는 푸시를 받으면 반드시 알림을 띄워야 한다(무음 푸시 불가) — 항상 showNotification.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safeAppPath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target);
              return;
            } catch {
              // navigate가 막히면 새 창으로 연다.
            }
          } else {
            return;
          }
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
