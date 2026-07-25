/**
 * 세션 유닛 테스트 — 보안 불변식 1의 증거.
 *
 * 확인 대상:
 *   - scrypt 해시 검증이 올바른 패스워드만 통과시킨다
 *   - 서명 쿠키가 위조·변조·만료에 대해 닫혀 있다
 *   - 쿠키 속성(httpOnly / SameSite / path / 만료)이 계약대로다
 */

import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import { hashPassword } from '@/lib/password-hash';
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  clearedSessionCookieOptions,
  createSessionCookie,
  readSessionCookie,
  sessionCookieOptions,
  sessionIdentifier,
  verifyPassword,
  verifySessionCookie,
} from '@/lib/session';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'f'.repeat(64);

/** 테스트에서 임의 만료 시각의 **유효 서명** 토큰을 만든다. */
function forgeToken(issuedAt: number, expiresAt: number, nonce = 'testnonce'): string {
  const payload = `v1.${issuedAt}.${expiresAt}.${nonce}`;
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

beforeAll(async () => {
  process.env.MARKDOWN_ROOT = '/tmp/mdws-session-test';
  process.env.SESSION_PASSWORD = await hashPassword(PASSWORD, {
    // 테스트에서는 비용을 낮춘다. 검증 로직은 레코드에 담긴 파라미터를 그대로 쓴다.
    N: 4096,
    r: 8,
    p: 1,
    keylen: 64,
  });
  process.env.SESSION_SECRET = SECRET;
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,png';
  process.env.RATE_LIMIT_MAX = '120';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
});

afterAll(() => {
  resetServerEnvCacheForTest();
});

describe('verifyPassword', () => {
  it('올바른 패스워드를 통과시킨다', async () => {
    await expect(verifyPassword(PASSWORD)).resolves.toBe(true);
  });

  it('틀린 패스워드를 거부한다', async () => {
    await expect(verifyPassword('wrong password here')).resolves.toBe(false);
    await expect(verifyPassword('')).resolves.toBe(false);
    // 1글자 차이
    await expect(verifyPassword(`${PASSWORD} `)).resolves.toBe(false);
  });

  it('과도하게 긴 입력을 거부한다 (KDF 폭주 방지)', async () => {
    await expect(verifyPassword('x'.repeat(100_000))).resolves.toBe(false);
  });
});

describe('세션 쿠키', () => {
  it('발급한 쿠키는 검증을 통과한다', async () => {
    const token = await createSessionCookie();
    await expect(verifySessionCookie(token)).resolves.toBe(true);
  });

  it('없거나 형식이 틀린 값을 거부한다', async () => {
    await expect(verifySessionCookie(undefined)).resolves.toBe(false);
    await expect(verifySessionCookie('')).resolves.toBe(false);
    await expect(verifySessionCookie('garbage')).resolves.toBe(false);
    await expect(verifySessionCookie('v1.1.2.3')).resolves.toBe(false);
    await expect(verifySessionCookie('x'.repeat(1000))).resolves.toBe(false);
  });

  it('서명이 한 글자라도 다르면 거부한다', async () => {
    const token = await createSessionCookie();
    const parts = token.split('.');
    const last = parts[4];
    parts[4] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1);
    await expect(verifySessionCookie(parts.join('.'))).resolves.toBe(false);
  });

  it('만료 시각만 늘려 붙인 토큰을 거부한다 (서명 불일치)', async () => {
    const token = await createSessionCookie();
    const parts = token.split('.');
    parts[2] = String(Number(parts[2]) + 86_400);
    await expect(verifySessionCookie(parts.join('.'))).resolves.toBe(false);
  });

  it('서명이 유효해도 만료됐으면 거부한다', async () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    await expect(verifySessionCookie(forgeToken(past, past + 60))).resolves.toBe(false);
  });

  it('서명이 유효해도 TTL 상한을 넘긴 토큰을 거부한다', async () => {
    // SESSION_SECRET이 유출된 뒤 100년짜리 토큰을 만드는 시나리오는 막지 못하지만,
    // 서버가 발급하지 않는 TTL을 통과시키지 않는다는 사실 자체를 고정해 둔다.
    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifySessionCookie(forgeToken(now, now + SESSION_TTL_SEC * 10)),
    ).resolves.toBe(false);
  });

  it('발급 시각이 미래인 토큰을 거부한다', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await expect(verifySessionCookie(forgeToken(future, future + 60))).resolves.toBe(false);
  });
});

describe('쿠키 속성', () => {
  it('httpOnly · SameSite=Lax · path=/ · 만료가 설정된다', () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(SESSION_TTL_SEC);
    // 개발 환경(NODE_ENV=test)에서는 Secure가 꺼져야 localhost 로그인이 된다.
    expect(options.secure).toBe(process.env.NODE_ENV === 'production');
  });

  it('로그아웃 옵션은 즉시 만료다', () => {
    expect(clearedSessionCookieOptions().maxAge).toBe(0);
    expect(clearedSessionCookieOptions().httpOnly).toBe(true);
  });
});

describe('요청 헤더 파싱', () => {
  it('Cookie 헤더에서 세션 토큰을 꺼낸다', async () => {
    const token = await createSessionCookie();
    const request = new Request('https://example.test/api/upload', {
      headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}; other=1` },
    });
    expect(readSessionCookie(request)).toBe(token);
  });

  it('쿠키가 없으면 undefined', () => {
    expect(readSessionCookie(new Request('https://example.test/'))).toBeUndefined();
  });

  it('세션 식별자는 nonce만 노출한다 (토큰 전체를 로그 키로 쓰지 않는다)', async () => {
    const token = await createSessionCookie();
    const id = sessionIdentifier(token);
    expect(id).not.toBeNull();
    expect(token).toContain(id as string);
    expect(id).not.toContain('.');
    expect(sessionIdentifier(undefined)).toBeNull();
    expect(sessionIdentifier('garbage')).toBeNull();
  });
});
