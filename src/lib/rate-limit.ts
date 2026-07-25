/**
 * Rate limiter — 보안 불변식 7.
 *
 * 대상: `POST /api/upload`, `POST /api/share/notify`, 그리고 `POST /api/auth/login`
 * (로그인은 유일한 무인증 라우트라 무차별 대입 표면이 된다 — 여기서도 막는다).
 * 단일 상주 Node 프로세스이므로 인메모리 구현으로 충분하다.
 *
 * ⚠️ ngrok 뒤에서는 `X-Forwarded-For`를 클라이언트가 위조할 수 있다.
 * 따라서 IP 단독 키는 신뢰 경계가 아니며, **세션 식별자를 우선 키로** 사용한다.
 * (엣지의 Basic Auth가 1차 관문이라는 전제와 함께 문서화된 한계다.)
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import 'server-only';

import { getServerEnv } from './env';
import { readSessionCookie, sessionIdentifier } from './session';

export interface RateLimitResult {
  allowed: boolean;
  /** 남은 허용 횟수. */
  remaining: number;
  /** 차단 시 재시도까지 남은 초. 429 응답의 Retry-After에 싣는다. */
  retryAfterSec: number;
}

/** 윈도 상태. `resetAt`은 epoch ms. */
interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 버킷 저장소 상한.
 *
 * ⚠️ 여기가 메모리 DoS 지점이다. `X-Forwarded-For`는 위조 가능하므로
 * 공격자가 헤더만 바꿔 가며 버킷을 무한히 만들 수 있다.
 * 상한을 두고 초과 시 만료분부터 정리한다. 그래도 넘치면 가장 오래된 항목을 버린다.
 */
const MAX_BUCKETS = 10_000;

const buckets = new Map<string, Bucket>();

/**
 * 라우트별 정책.
 *
 * `RATE_LIMIT_MAX` env는 **업로드 기준**으로 잡혀 있다.
 * 프론트가 "파일 1개 = 요청 1개"로 순차 전송하기 때문이다
 * (docs/agent-work/frontend-stage-1-client-contract.md §1).
 * 반면 webhook 발화와 로그인 시도는 훨씬 촘촘히 제한해야 하므로 별도 상수를 쓴다.
 */
export const RATE_LIMIT_POLICY = {
  /** 업로드: env 값을 그대로 따른다(다중 파일 드롭을 막지 않기 위함). */
  upload: null,
  /** 공유 알림: 외부 webhook을 때리므로 보수적으로. */
  shareNotify: { max: 10, windowSec: 60 },
  /** 로그인: 무차별 대입 방지. 5분에 10회. */
  login: { max: 10, windowSec: 300 },
} as const;

export type RateLimitOverride = { max: number; windowSec: number } | null | undefined;

/** 만료된 버킷을 정리하고, 그래도 상한을 넘으면 오래된 것부터 버린다. */
function evictIfNeeded(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Map은 삽입 순서를 유지하므로 앞에서부터 지우면 오래된 것부터 사라진다.
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

/**
 * 윈도 내 요청 수를 세고 허용 여부를 반환한다.
 * `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SEC` env를 따른다.
 *
 * @param key 세션 식별자 우선, 없으면 IP 폴백. `rateLimitKeyFor()`로 만든다.
 * @param override 라우트별 정책. 생략하면 env 기본값(= 업로드 기준).
 */
export function checkRateLimit(key: string, override?: RateLimitOverride): RateLimitResult {
  const env = getServerEnv();
  const max = override?.max ?? env.RATE_LIMIT_MAX;
  const windowSec = override?.windowSec ?? env.RATE_LIMIT_WINDOW_SEC;

  const now = Date.now();
  const windowMs = windowSec * 1000;

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    evictIfNeeded(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, max - bucket.count),
    // 허용된 요청에도 창이 언제 리셋되는지는 알려 준다(헤더에 실을 수 있게).
    retryAfterSec,
  };
}

/**
 * 요청에서 rate limit 키를 만든다.
 *
 * 우선순위:
 *   1. **세션 식별자** — 로그인한 사용자를 식별한다. 위조하려면 유효 서명이 필요하므로 신뢰할 수 있다.
 *   2. **IP 폴백** — 로그인 전(`/api/auth/login`)에는 이것밖에 없다.
 *
 * ⚠️ **`X-Forwarded-For`는 클라이언트가 위조할 수 있다.**
 *    앱은 ngrok 터널 뒤에 있고, 요청은 항상 로컬 프록시에서 오므로 소켓 주소는 언제나 127.0.0.1이다.
 *    따라서 IP는 XFF 헤더에서 읽을 수밖에 없는데, 이 헤더는 원격 클라이언트가 임의로 채워 보낼 수 있다.
 *    → IP 기반 제한은 **성실한 클라이언트의 폭주를 막는 안전장치**일 뿐, 작정한 공격자에게는 우회된다.
 *    → 실질적인 1차 관문은 ngrok 엣지의 Basic Auth이고, 2차는 세션 인증이다.
 *    → 로그인 라우트의 IP 제한이 우회 가능하다는 점을 감안해 패스워드 자체를 강하게 유지해야 한다.
 *    (docs/valid/security-stage-1-validation.md의 위협 모델 T-5 참조)
 *
 * @param scope 라우트 이름. 라우트끼리 예산을 공유하지 않도록 키에 섞는다.
 */
export function rateLimitKeyFor(request: Request, scope: string): string {
  const session = sessionIdentifier(readSessionCookie(request));
  if (session) return `${scope}:s:${session}`;

  return `${scope}:ip:${clientIpFromHeaders(request)}`;
}

/**
 * 요청 헤더에서 클라이언트 IP를 추정한다.
 * **신뢰할 수 없는 값이다** — 위 주의사항 참조. 로깅·rate limit 용도로만 쓴다.
 */
export function clientIpFromHeaders(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // 첫 항목이 원 클라이언트라는 관례를 따르되, 어차피 위조 가능하다.
    const first = forwarded.split(',')[0]?.trim();
    // 길이를 제한해 헤더 하나로 거대한 키를 만들지 못하게 한다.
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim().slice(0, 64);
  return 'unknown';
}

/** 저장소 초기화 — **유닛 테스트 전용**. */
export function resetRateLimitForTest(): void {
  buckets.clear();
}
