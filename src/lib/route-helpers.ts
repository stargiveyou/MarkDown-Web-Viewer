/**
 * API 라우트 공용 헬퍼.
 *
 * 12개 이상의 라우트에서 반복되는 catch 패턴과 에러 타입 가드를 통합한다.
 * 서버 전용 — API 라우트에서만 사용한다.
 */

import 'server-only';

import { type NextResponse } from 'next/server';
import { apiError, internalError } from '@/lib/api-response';
import { PathSafetyError } from '@/lib/path-safety';

/**
 * API 라우트의 공용 catch 핸들러.
 *
 * - `PathSafetyError` → 400 "Invalid path." + console.error
 * - 그 외 → `internalError(prefix, error)` (500)
 *
 * 사용 예:
 * ```ts
 * } catch (error) {
 *   return handleRouteError('file-content:GET', error);
 * }
 * ```
 */
export function handleRouteError(prefix: string, error: unknown): NextResponse {
  if (error instanceof PathSafetyError) {
    console.error(`[${prefix}] path rejected:`, error.message);
    return apiError(400, 'Invalid path.');
  }
  return internalError(prefix, error);
}

/**
 * `NodeJS.ErrnoException.code === 'ENOENT'` 타입 가드.
 *
 * ```ts
 * catch (err) {
 *   if (!isEnoent(err)) throw err;
 *   // ENOENT → 정상 진행
 * }
 * ```
 */
export function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
