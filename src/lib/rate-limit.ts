/**
 * Rate limiter — 보안 불변식 7.
 *
 * 대상: `POST /api/upload`, `POST /api/share/notify`.
 * 단일 상주 Node 프로세스이므로 인메모리 구현으로 충분하다.
 *
 * ⚠️ ngrok 뒤에서는 `X-Forwarded-For`를 클라이언트가 위조할 수 있다.
 * 따라서 IP 단독 키는 신뢰 경계가 아니며, **세션 식별자를 우선 키로** 사용한다.
 * (엣지의 Basic Auth가 1차 관문이라는 전제와 함께 문서화된 한계다.)
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import 'server-only';

export interface RateLimitResult {
  allowed: boolean;
  /** 남은 허용 횟수. */
  remaining: number;
  /** 차단 시 재시도까지 남은 초. 429 응답의 Retry-After에 싣는다. */
  retryAfterSec: number;
}

/**
 * 윈도 내 요청 수를 세고 허용 여부를 반환한다.
 * `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SEC` env를 따른다.
 *
 * @param key 세션 식별자 우선, 없으면 IP 폴백
 */
export function checkRateLimit(key: string): RateLimitResult {
  throw new Error('NOT_IMPLEMENTED: checkRateLimit — Stage 1 / security-auth');
}
