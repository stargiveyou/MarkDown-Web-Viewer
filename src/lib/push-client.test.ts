/**
 * Web Push 클라이언트 판정 로직 테스트.
 * iOS는 "홈 화면에 추가 + standalone"에서만 PushManager가 생기므로 그 분기를 고정한다.
 */

import { describe, expect, it } from 'vitest';

import { detectPushSupport, urlBase64ToUint8Array, type PushEnvironment } from '@/lib/push-client';

const base: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIos: false,
  isStandalone: false,
};

describe('detectPushSupport', () => {
  it('데스크톱 Chrome/Safari → supported', () => {
    expect(detectPushSupport(base)).toBe('supported');
  });

  it('iOS 홈 화면 앱 (16.4+) → supported', () => {
    expect(detectPushSupport({ ...base, isIos: true, isStandalone: true })).toBe('supported');
  });

  it('iOS Safari 탭 (PushManager 없음) → needs-install', () => {
    expect(
      detectPushSupport({ ...base, isIos: true, isStandalone: false, hasPushManager: false }),
    ).toBe('needs-install');
  });

  it('iOS 16.4 미만 홈 화면 앱 (PushManager 없음) → unsupported', () => {
    expect(
      detectPushSupport({ ...base, isIos: true, isStandalone: true, hasPushManager: false }),
    ).toBe('unsupported');
  });

  it('서비스 워커 없는 브라우저 → unsupported', () => {
    expect(detectPushSupport({ ...base, hasServiceWorker: false })).toBe('unsupported');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('base64url(패딩 없음)을 원래 바이트로 되돌린다', () => {
    const bytes = Buffer.from([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const encoded = bytes.toString('base64url');
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(Array.from(bytes));
  });

  it('VAPID 공개키 길이(65바이트)를 유지한다', () => {
    const key = Buffer.alloc(65, 4).toString('base64url');
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});
