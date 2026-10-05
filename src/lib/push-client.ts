/**
 * Web Push 클라이언트 헬퍼 — 브라우저 전용 순수 함수.
 *
 * 판정 로직을 컴포넌트에서 떼어 둔 이유: iOS의 조건(16.4+, 홈 화면 설치, standalone)이 까다로워
 * 분기를 유닛 테스트로 고정해 두지 않으면 "왜 버튼이 안 보이지"를 실기기에서만 알게 된다.
 */

/** 현재 환경에서 알림을 켤 수 있는 상태. */
export type PushSupport =
  /** 서비스 워커 + PushManager + Notification 모두 있음 → 켤 수 있다. */
  | 'supported'
  /** iOS Safari 탭에서 열림 → 홈 화면에 추가해야 푸시가 생긴다. */
  | 'needs-install'
  /** 이 브라우저는 Web Push를 지원하지 않는다. */
  | 'unsupported';

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  isStandalone: boolean;
}

export function detectPushSupport(env: PushEnvironment): PushSupport {
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return 'supported';
  // iOS 16.4+는 홈 화면 앱(standalone)에서만 PushManager를 노출한다.
  if (env.isIos && !env.isStandalone) return 'needs-install';
  return 'unsupported';
}

/** 실제 브라우저 전역에서 환경을 읽는다. SSR에서는 호출하지 않는다. */
export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent;
  // iPadOS 13+는 데스크톱 Safari UA(Macintosh)를 보낸다 — 터치 포인트로 구분한다.
  const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const isStandalone =
    nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  return {
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    isIos,
    isStandalone,
  };
}

/**
 * VAPID 공개키(base64url) → `applicationServerKey`용 바이트 배열.
 * `PushManager.subscribe`는 문자열도 받지만 Safari 구버전 호환을 위해 바이트로 넘긴다.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** 서비스 워커 경로. `public/sw.js` — 미들웨어 인증 예외 경로와 반드시 일치해야 한다. */
export const SERVICE_WORKER_PATH = '/sw.js';
