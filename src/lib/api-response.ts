/**
 * 공유 API 응답 헬퍼.
 *
 * 모든 라우트 핸들러가 동일한 에러 형태를 반환하도록 한 곳에서 관리한다.
 * 내부 정보(스택트레이스·절대경로)는 절대 응답에 담지 않는다(보안 불변식 8).
 */

import 'server-only';

import { NextResponse } from 'next/server';

import type { ApiError } from '@/types/api';

/** `ApiError` 형태의 JSON 응답. */
export function apiError(
  code: ApiError['code'],
  message: string,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ code, message } satisfies ApiError, {
    status: code,
    headers,
  });
}

/** 예기치 못한 서버 오류 응답. 사유는 서버에만 로깅한다. */
export function internalError(logPrefix: string, error: unknown): NextResponse {
  console.error(`[${logPrefix}]`, error);
  return apiError(500, 'Internal server error.');
}
