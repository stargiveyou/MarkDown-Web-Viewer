/**
 * 서버 전용 환경변수 접근 계층.
 *
 * - **서버 코드에서만** import한다. 클라이언트 컴포넌트에서 import하면 빌드가 깨져야 정상이다.
 * - `NEXT_PUBLIC_` 접두사를 쓰지 않는다 — 붙는 순간 클라이언트 번들에 인라인된다(보안 불변식 6).
 * - `MARKDOWN_ROOT`에 `os.homedir()` 같은 하드코딩 폴백을 두지 않는다. 미설정이면 즉시 실패한다.
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import 'server-only';

export interface ServerEnv {
  MARKDOWN_ROOT: string;
  SESSION_PASSWORD: string;
  SESSION_SECRET: string;
  UPLOAD_MAX_BYTES: number;
  ALLOWED_EXTENSIONS: string[];
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW_SEC: number;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
}

/**
 * 필수 env를 검증해 반환한다. 하나라도 없으면 부팅 시점에 throw한다.
 * (런타임 중간에 조용히 undefined로 흐르는 것보다 기동 실패가 안전하다.)
 */
export function getServerEnv(): ServerEnv {
  throw new Error('NOT_IMPLEMENTED: getServerEnv — Stage 1 / security-auth');
}
