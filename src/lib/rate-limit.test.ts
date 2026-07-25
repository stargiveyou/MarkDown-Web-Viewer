/**
 * Rate limiter 유닛 테스트 — 보안 불변식 7의 증거.
 *
 * 특히 확인하는 것: **세션 키가 IP보다 우선**한다는 점.
 * `X-Forwarded-For`는 위조 가능하므로, 로그인한 사용자를 IP로 식별하면
 * 헤더 하나만 바꿔도 제한을 빠져나갈 수 있다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import { checkRateLimit, clientIpFromHeaders, rateLimitKeyFor, resetRateLimitForTest } from '@/lib/rate-limit';
import { SESSION_COOKIE, createSessionCookie, sessionIdentifier } from '@/lib/session';

beforeAll(() => {
  process.env.MARKDOWN_ROOT = '/tmp/mdws-ratelimit-test';
  process.env.SESSION_PASSWORD = `scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:${Buffer.alloc(64, 7).toString('base64')}`;
  process.env.SESSION_SECRET = 'c'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,png';
  process.env.RATE_LIMIT_MAX = '3';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
});

afterEach(() => {
  resetRateLimitForTest();
});

afterAll(() => {
  resetServerEnvCacheForTest();
});

describe('checkRateLimit', () => {
  it('env의 RATE_LIMIT_MAX까지 허용하고 그다음을 차단한다', () => {
    expect(checkRateLimit('k').allowed).toBe(true);
    expect(checkRateLimit('k').allowed).toBe(true);
    const third = checkRateLimit('k');
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = checkRateLimit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('키가 다르면 예산을 공유하지 않는다', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('a');
    expect(checkRateLimit('a').allowed).toBe(false);
    expect(checkRateLimit('b').allowed).toBe(true);
  });

  it('라우트별 override가 env 기본값을 덮는다', () => {
    const policy = { max: 1, windowSec: 60 };
    expect(checkRateLimit('n', policy).allowed).toBe(true);
    expect(checkRateLimit('n', policy).allowed).toBe(false);
  });

  it('창이 지나면 리셋된다', async () => {
    const policy = { max: 1, windowSec: 1 };
    expect(checkRateLimit('w', policy).allowed).toBe(true);
    expect(checkRateLimit('w', policy).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(checkRateLimit('w', policy).allowed).toBe(true);
  });
});

describe('rateLimitKeyFor', () => {
  it('세션 쿠키가 있으면 세션 식별자를 키로 쓴다 (IP 헤더를 무시)', async () => {
    const token = await createSessionCookie();
    const id = sessionIdentifier(token);

    const request = new Request('https://example.test/api/upload', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-forwarded-for': '9.9.9.9' },
    });

    const key = rateLimitKeyFor(request, 'upload');
    expect(key).toBe(`upload:s:${id}`);
    expect(key).not.toContain('9.9.9.9');
  });

  it('세션 쿠키가 없으면 IP로 폴백한다', () => {
    const request = new Request('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });
    expect(rateLimitKeyFor(request, 'login')).toBe('login:ip:203.0.113.7');
  });

  it('IP 정보가 전혀 없으면 unknown으로 묶는다', () => {
    const request = new Request('https://example.test/api/auth/login', { method: 'POST' });
    expect(rateLimitKeyFor(request, 'login')).toBe('login:ip:unknown');
  });

  it('scope가 다르면 예산을 공유하지 않는다', () => {
    const request = new Request('https://example.test/', {
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(rateLimitKeyFor(request, 'upload')).not.toBe(rateLimitKeyFor(request, 'shareNotify'));
  });
});

describe('clientIpFromHeaders', () => {
  it('X-Forwarded-For의 첫 항목을 쓴다 — 다만 위조 가능한 값이다', () => {
    const request = new Request('https://example.test/', {
      headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' },
    });
    expect(clientIpFromHeaders(request)).toBe('1.2.3.4');
  });

  it('거대한 헤더로 키를 부풀리지 못한다', () => {
    const request = new Request('https://example.test/', {
      headers: { 'x-forwarded-for': 'x'.repeat(5000) },
    });
    expect(clientIpFromHeaders(request).length).toBeLessThanOrEqual(64);
  });
});
