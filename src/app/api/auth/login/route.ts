/**
 * `POST /api/auth/login` — 단일 패스워드 로그인 (보안 불변식 1 / ADR-005).
 *
 * **이 앱에서 유일한 무인증 라우트다.** 미들웨어는 `POST /api/auth/login`만 예외로 통과시키므로
 * 같은 경로의 `GET`은 자동으로 401이 된다(메서드 핸들러를 추가하지 않는 이유).
 *
 * 흐름: rate limit(무차별 대입 방지) → 입력 파싱 → timing-safe 패스워드 비교 → 세션 쿠키 발급.
 *
 * 응답 계약: 성공 `LoginResponse`, 실패 `ApiError`.
 * 실패 사유(형식 오류 / 패스워드 불일치)를 구분해 알려주지 않는다 — 전부 401로 접는다.
 *
 * 담당: backend-dev / Stage 1 Wave 2
 */

import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api-response';
import { RATE_LIMIT_POLICY, checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';
import { applySessionCookie, verifyPassword } from '@/lib/session';
import type { LoginRequest, LoginResponse } from '@/types/api';

export const runtime = 'nodejs';

/**
 * 로그인 바디 크기 상한(바이트).
 *
 * 라우트 핸들러의 `request.json()`은 바디를 통째로 메모리에 올린다.
 * 무인증 라우트라서 거대한 바디로 메모리를 소모시키는 시도를 파싱 전에 끊는다.
 * 정상 요청은 `{"password":"..."}` 수준이라 4KB로 충분하다.
 */
const MAX_LOGIN_BODY_BYTES = 4096;

export async function POST(request: Request): Promise<NextResponse> {
  // --- 1. 무차별 대입 방지 (5분 10회) -----------------------------------------
  // 미인증 라우트라 키는 IP 폴백이 된다(위조 가능 — 위협 모델 T-5). 그래도 성실한 폭주는 막는다.
  const limit = checkRateLimit(rateLimitKeyFor(request, 'login'), RATE_LIMIT_POLICY.login);
  if (!limit.allowed) {
    return apiError(429, 'Too many attempts. Try again later.', {
      'Retry-After': String(limit.retryAfterSec),
    });
  }

  // --- 2. 바디 크기 선검사 -----------------------------------------------------
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) {
    return apiError(400, 'Invalid request.');
  }

  // --- 3. 입력 파싱 ------------------------------------------------------------
  // 형식 오류도 401로 접어 "패스워드가 틀렸다"와 구분되지 않게 한다.
  let password = '';
  try {
    const body = (await request.json()) as LoginRequest | null;
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    password = '';
  }

  // --- 4. timing-safe 비교 -----------------------------------------------------
  // 빈 입력도 KDF를 한 번 돌리고 나서 기각된다(응답 시간 차이 제거).
  if (!(await verifyPassword(password))) {
    return apiError(401, 'Invalid password.');
  }

  // --- 5. 세션 쿠키 발급 -------------------------------------------------------
  // httpOnly / SameSite=Lax / Secure(프로덕션) / 12시간 만료가 전부 이 함수 안에 있다.
  const body: LoginResponse = { ok: true };
  const response = NextResponse.json(body);
  await applySessionCookie(response.cookies);
  return response;
}
