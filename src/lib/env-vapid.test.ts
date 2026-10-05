/**
 * env — VAPID(Web Push) 설정 검증.
 *
 * 셋 다 비면 비활성, 일부만 있으면 기동 실패(조용히 꺼지면 "알림이 안 온다"를 원인 없이 겪는다),
 * 키 길이·subject 형식이 틀려도 기동 실패. 오류 메시지에 키 값이 실리지 않는다(불변식 6/8).
 */

import webpush from 'web-push';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { EnvConfigError, getServerEnv, resetServerEnvCacheForTest } from '@/lib/env';
import { hashPassword } from '@/lib/password-hash';

const VAPID_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
const real = webpush.generateVAPIDKeys();

beforeAll(async () => {
  process.env.MARKDOWN_ROOT = '/tmp/mdws-env-vapid-test';
  process.env.SESSION_PASSWORD = await hashPassword('pw-for-test', { N: 1024, r: 8, p: 1, keylen: 32 });
  process.env.SESSION_SECRET = 'y'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '1024';
  process.env.ALLOWED_EXTENSIONS = 'md';
  process.env.RATE_LIMIT_MAX = '10';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
});

afterEach(() => {
  for (const k of VAPID_KEYS) delete process.env[k];
  resetServerEnvCacheForTest();
});

function setVapid(pub: string, priv: string, subject: string): void {
  process.env.VAPID_PUBLIC_KEY = pub;
  process.env.VAPID_PRIVATE_KEY = priv;
  process.env.VAPID_SUBJECT = subject;
  resetServerEnvCacheForTest();
}

describe('VAPID env', () => {
  it('셋 다 비면 푸시 비활성 (VAPID 없음)', () => {
    resetServerEnvCacheForTest();
    expect(getServerEnv().VAPID).toBeUndefined();
  });

  it('web-push가 생성한 실제 키 + mailto → 활성', () => {
    setVapid(real.publicKey, real.privateKey, 'mailto:ops@example.com');
    expect(getServerEnv().VAPID).toEqual({
      publicKey: real.publicKey,
      privateKey: real.privateKey,
      subject: 'mailto:ops@example.com',
    });
  });

  it('https subject도 허용', () => {
    setVapid(real.publicKey, real.privateKey, 'https://example.com/contact');
    expect(getServerEnv().VAPID?.subject).toBe('https://example.com/contact');
  });

  it('일부만 설정하면 기동 실패', () => {
    process.env.VAPID_PUBLIC_KEY = real.publicKey;
    resetServerEnvCacheForTest();
    expect(() => getServerEnv()).toThrow(EnvConfigError);
  });

  it.each([
    ['공개키/개인키 뒤바뀜', () => setVapid(real.privateKey, real.publicKey, 'mailto:a@b.c')],
    ['subject 형식 오류', () => setVapid(real.publicKey, real.privateKey, 'ops@example.com')],
    ['http subject', () => setVapid(real.publicKey, real.privateKey, 'http://example.com')],
  ])('%s → 기동 실패, 메시지에 키 값 없음', (_label, apply) => {
    apply();
    let message = '';
    try {
      getServerEnv();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvConfigError);
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(real.privateKey);
    expect(message).not.toContain(real.publicKey);
  });
});
