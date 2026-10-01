/**
 * HTTP 헤더 처리 유틸리티.
 *
 * 서버 전용 — API 라우트에서만 사용한다.
 */

import 'server-only';

/**
 * `x-forwarded-proto` 헤더를 안전한 값으로 제한한다 (backlog P1-20).
 * 'http' 또는 'https'만 허용하며, 그 외(`javascript:` 등)는 'https'로 대체한다.
 */
export function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}
