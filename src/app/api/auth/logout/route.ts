/**
 * `POST /api/auth/logout` — 세션 쿠키 제거.
 *
 * 세션은 stateless HMAC 토큰이라 서버에 지울 상태가 없다.
 * 쿠키만 즉시 만료시키면 브라우저는 더 이상 토큰을 보내지 않는다.
 *
 * 한계: 이미 발급된 토큰 자체는 만료(12시간) 전까지 유효하다.
 * 전면 강제 로그아웃이 필요하면 `SESSION_SECRET`을 교체한다
 * (docs/complete-work/stage-1-security-complete.md §2).
 *
 * 이 라우트도 보호 대상이다 — 미인증 요청은 미들웨어가 401로 막는다.
 *
 * 담당: backend-dev / Stage 1 Wave 2
 */

import { NextResponse } from 'next/server';

import { clearSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true } as const);
  clearSessionCookie(response.cookies);
  return response;
}
