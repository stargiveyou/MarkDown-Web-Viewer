/**
 * 단일 패스워드 세션 — 보안 불변식 1 (ADR-005).
 *
 * `POST /api/auth/login`을 제외한 모든 페이지·API가 이 모듈로 세션을 검증한다.
 * 엣지의 ngrok Basic Auth와 함께 이중 관문을 구성한다.
 *
 * 설계 요약
 * ---------
 * - 패스워드: scrypt 해시(`SESSION_PASSWORD`) + `timingSafeEqual` 비교.
 *   bcrypt/argon2 같은 네이티브 의존성은 쓰지 않는다(Node 내장 crypto만).
 * - 쿠키: **stateless HMAC 서명 토큰**. 서버에 세션 저장소를 두지 않는다.
 *   단일 사용자·단일 프로세스이므로 저장소를 두면 재시작마다 로그아웃될 뿐 이득이 없다.
 *   대신 "발급된 토큰은 만료 전까지 무효화할 수 없다"는 한계가 있다
 *   → 강제 전면 로그아웃이 필요하면 `SESSION_SECRET`을 교체한다(문서화됨).
 *
 * 토큰 형식: `v1.<발급시각>.<만료시각>.<nonce>.<HMAC-SHA256>`  (모두 base64url / 10진수)
 *   서명 대상은 앞의 4개 필드를 `.`으로 이은 문자열이다.
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from './env';
import { parseScryptRecord, verifyPasswordAgainstRecord } from './password-hash';

/** 세션 쿠키 이름. 미들웨어·라우트가 같은 상수를 참조한다. */
export const SESSION_COOKIE = 'mdws_session';

/** 세션 유효 기간(초). 12시간 — 하루 작업 세션을 덮되 방치된 브라우저를 무한정 열어두지 않는다. */
export const SESSION_TTL_SEC = 12 * 60 * 60;

/** 토큰 버전 태그. 형식이 바뀌면 올려서 구 토큰을 일괄 무효화한다. */
const TOKEN_VERSION = 'v1';

/** 토큰 문자열 길이 상한. 비정상적으로 긴 쿠키로 HMAC 연산을 유도하지 못하게 한다. */
const MAX_TOKEN_LENGTH = 512;

/** 발급 시각이 미래로 찍혀 있어도 허용할 오차(초). 시계 보정 여유. */
const CLOCK_SKEW_SEC = 60;

/**
 * 쿠키 속성. 라우트 핸들러가 `Set-Cookie`를 만들 때 그대로 펼쳐 쓴다.
 * Next의 `ResponseCookies.set()` / `cookies().set()` 인자와 호환되는 형태다.
 */
export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

/**
 * 쿠키를 쓸 수 있는 최소 인터페이스.
 * `NextResponse.cookies`와 `await cookies()` 양쪽이 이 형태를 만족하므로,
 * 이 모듈이 next/server에 직접 의존하지 않아도 된다(테스트도 쉬워진다).
 */
export interface CookieWriter {
  set(options: { name: string; value: string } & SessionCookieOptions): unknown;
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** HMAC-SHA256 서명. 키는 `SESSION_SECRET`이며 절대 응답에 실리지 않는다(보안 불변식 6). */
function sign(payload: string): string {
  const secret = getServerEnv().SESSION_SECRET;
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

/**
 * 입력 패스워드를 `SESSION_PASSWORD` 해시와 **timing-safe**하게 비교한다.
 * 조기 반환(early return)하는 문자열 비교를 쓰지 않는다.
 */
export async function verifyPassword(input: string): Promise<boolean> {
  // 해시 레코드는 env 검증 단계에서 형식이 보장된다. 여기서 실패하면 설정 오류다.
  const record = parseScryptRecord(getServerEnv().SESSION_PASSWORD);
  // 입력이 문자열이 아니어도 KDF를 한 번 돌리고 나서 기각한다(응답 시간 차이 제거).
  return verifyPasswordAgainstRecord(typeof input === 'string' ? input : '', record);
}

/**
 * 서명된 세션 쿠키 값을 생성한다.
 * 쿠키 속성: httpOnly, SameSite=Lax, Secure(프로덕션), 합리적 만료.
 *
 * @returns 쿠키 **값**(토큰) 문자열. 속성은 `sessionCookieOptions()`가 제공한다.
 */
export async function createSessionCookie(): Promise<string> {
  const issuedAt = nowSec();
  const expiresAt = issuedAt + SESSION_TTL_SEC;
  // nonce는 토큰을 매번 다르게 만들고, rate limit의 세션 식별자 재료가 된다.
  const nonce = base64url(randomBytes(16));
  const payload = `${TOKEN_VERSION}.${issuedAt}.${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * 쿠키 서명과 만료를 검증한다.
 * 미들웨어와 각 라우트 핸들러가 공통으로 호출한다.
 *
 * 서명 검증은 `timingSafeEqual`로 수행한다. 검증 순서상 형식 검사가 먼저지만,
 * 형식은 비밀이 아니므로(누구나 유효한 형식을 만들 수 있다) 타이밍 정보가 되지 않는다.
 */
export async function verifySessionCookie(value: string | undefined): Promise<boolean> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TOKEN_LENGTH) {
    return false;
  }

  const parts = value.split('.');
  if (parts.length !== 5) return false;

  const [version, issuedRaw, expiresRaw, nonce, signature] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (nonce.length === 0 || signature.length === 0) return false;

  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return false;

  const expected = sign(`${version}.${issuedRaw}.${expiresRaw}.${nonce}`);
  const given = Buffer.from(signature, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  if (!timingSafeEqual(given, want)) return false;

  // 서명이 맞아도 만료됐으면 거부한다. (서명 검증 뒤에 확인하는 편이 정보 노출이 적다.)
  const current = nowSec();
  if (expiresAt <= current) return false;
  if (issuedAt > current + CLOCK_SKEW_SEC) return false;
  // 위조된 TTL(예: 10년짜리 만료)을 서명과 함께 재사용하지 못하도록 상한을 강제한다.
  if (expiresAt - issuedAt > SESSION_TTL_SEC) return false;

  return true;
}

/** 세션 쿠키 속성. 로그인 응답에서 사용한다. */
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // ngrok이 TLS를 종단하므로 브라우저가 보는 스킴은 https다.
    // 개발(localhost:3000)은 http라서 Secure를 켜면 쿠키가 저장되지 않는다.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  };
}

/** 로그아웃용 쿠키 속성. 값은 빈 문자열, 즉시 만료. */
export function clearedSessionCookieOptions(): SessionCookieOptions {
  return { ...sessionCookieOptions(), maxAge: 0 };
}

/** 응답에 세션 쿠키를 심는다. `POST /api/auth/login`에서 사용한다. */
export async function applySessionCookie(writer: CookieWriter): Promise<void> {
  writer.set({
    name: SESSION_COOKIE,
    value: await createSessionCookie(),
    ...sessionCookieOptions(),
  });
}

/** 응답에서 세션 쿠키를 지운다. `POST /api/auth/logout`에서 사용한다. */
export function clearSessionCookie(writer: CookieWriter): void {
  writer.set({ name: SESSION_COOKIE, value: '', ...clearedSessionCookieOptions() });
}

/**
 * 표준 `Request`의 Cookie 헤더에서 세션 토큰을 꺼낸다.
 * (`next/headers` 없이 라우트 핸들러·rate limiter가 공통으로 쓸 수 있게.)
 */
export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;

  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index === -1) continue;
    if (chunk.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const raw = chunk.slice(index + 1).trim();
    return raw === '' ? undefined : raw;
  }
  return undefined;
}

/**
 * 토큰에서 rate limit용 세션 식별자를 뽑는다.
 *
 * 토큰 전체를 키로 쓰면 로그가 있는 그대로 시크릿을 담게 되므로 nonce만 쓴다.
 * nonce는 그 자체로는 권한이 없고(서명 없이는 쓸모없다), 세션 단위 구분에는 충분하다.
 *
 * @returns 세션 식별자. 형식이 맞지 않으면 `null`(호출부가 IP 폴백으로 내려간다).
 */
export function sessionIdentifier(token: string | undefined): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return null;
  const nonce = parts[3];
  if (nonce.length === 0 || nonce.length > 64) return null;
  return nonce;
}
