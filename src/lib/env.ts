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

import { isScryptRecord } from './password-hash';

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
 * env 설정 오류. **메시지에 값을 절대 담지 않는다** — 키 이름과 사유만 담는다.
 * (로그가 유출돼도 시크릿이 새지 않도록. 보안 불변식 6/8)
 */
export class EnvConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `환경변수 설정 오류 (${problems.length}건):\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n.env.local.example을 참고해 .env.local을 채우세요.',
    );
    this.name = 'EnvConfigError';
  }
}

/** 세션 서명 키 최소 길이(문자). 32바이트 랜덤을 hex로 쓰면 64자가 된다. */
const SESSION_SECRET_MIN_LENGTH = 32;

/**
 * 검증 결과 캐시. 요청마다 재검증할 이유가 없고, 검증 실패를 매 요청 반복 로깅하지도 않는다.
 * (프로세스 수명 동안 env는 바뀌지 않는다.)
 */
let cached: ServerEnv | null = null;

function readRequired(name: string, problems: string[]): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    problems.push(`${name} 미설정 (필수)`);
    return '';
  }
  return raw.trim();
}

function readPositiveInt(name: string, problems: string[]): number {
  const raw = readRequired(name, problems);
  if (raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    problems.push(`${name}: 양의 정수여야 합니다`);
    return 0;
  }
  return value;
}

function readOptionalWebhook(name: string, problems: string[]): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${name}: URL 형식이 아닙니다`);
    return undefined;
  }
  // Webhook URL 자체가 시크릿이므로 평문 http는 허용하지 않는다.
  if (parsed.protocol !== 'https:') {
    problems.push(`${name}: https URL이어야 합니다`);
    return undefined;
  }
  return value;
}

/**
 * 필수 env를 검증해 반환한다. 하나라도 없으면 부팅 시점에 throw한다.
 * (런타임 중간에 조용히 undefined로 흐르는 것보다 기동 실패가 안전하다.)
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const problems: string[] = [];

  // --- 저장소 루트 -----------------------------------------------------------
  const rootRaw = readRequired('MARKDOWN_ROOT', problems);
  let markdownRoot = '';
  if (rootRaw !== '') {
    if (!rootRaw.startsWith('/')) {
      problems.push('MARKDOWN_ROOT: 절대 경로여야 합니다');
    } else {
      // 여기서는 **정규화하지 않고** 원본을 그대로 보관한다.
      // 후행 슬래시 제거 등 정규화는 경로 안전 유틸이 단독으로 책임진다
      // (`src/lib/path-safety.ts`의 `getRoot()`).
      //
      // 이 모듈은 미들웨어 번들에 포함되는데, 여기서 `path.resolve()`를 호출하면
      // Next의 파일 트레이싱이 "프로젝트 전체가 동적으로 참조된다"고 판단해
      // 미들웨어 번들에 프로젝트 전체를 끌어들인다(빌드 경고 + 번들 비대).
      markdownRoot = rootRaw;
    }
  }

  // --- 인증 (보안 불변식 1) ---------------------------------------------------
  const sessionPassword = readRequired('SESSION_PASSWORD', problems);
  if (sessionPassword !== '' && !isScryptRecord(sessionPassword)) {
    problems.push(
      'SESSION_PASSWORD: 평문이 아니라 scrypt 해시여야 합니다 ' +
        '(`npm run hash-password`로 생성한 `scrypt:N:r:p:salt:hash` 형식)',
    );
  }

  const sessionSecret = readRequired('SESSION_SECRET', problems);
  if (sessionSecret !== '' && sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
    problems.push(`SESSION_SECRET: ${SESSION_SECRET_MIN_LENGTH}자 이상이어야 합니다`);
  }

  // --- 업로드 정책 (보안 불변식 3) -------------------------------------------
  const uploadMaxBytes = readPositiveInt('UPLOAD_MAX_BYTES', problems);

  const extensionsRaw = readRequired('ALLOWED_EXTENSIONS', problems);
  const allowedExtensions = extensionsRaw
    .split(',')
    .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
    .filter((ext) => ext !== '');
  if (extensionsRaw !== '' && allowedExtensions.length === 0) {
    problems.push('ALLOWED_EXTENSIONS: 최소 1개 이상이어야 합니다');
  }
  if (allowedExtensions.some((ext) => !/^[a-z0-9]+$/.test(ext))) {
    problems.push('ALLOWED_EXTENSIONS: 영숫자 확장자만 허용합니다 (점 없이, 쉼표 구분)');
  }

  // --- Rate limit (보안 불변식 7) --------------------------------------------
  const rateLimitMax = readPositiveInt('RATE_LIMIT_MAX', problems);
  const rateLimitWindowSec = readPositiveInt('RATE_LIMIT_WINDOW_SEC', problems);

  // --- 선택 항목 -------------------------------------------------------------
  const discordWebhookUrl = readOptionalWebhook('DISCORD_WEBHOOK_URL', problems);
  const slackWebhookUrl = readOptionalWebhook('SLACK_WEBHOOK_URL', problems);

  if (problems.length > 0) {
    throw new EnvConfigError(problems);
  }

  cached = Object.freeze({
    MARKDOWN_ROOT: markdownRoot,
    SESSION_PASSWORD: sessionPassword,
    SESSION_SECRET: sessionSecret,
    UPLOAD_MAX_BYTES: uploadMaxBytes,
    ALLOWED_EXTENSIONS: Object.freeze(allowedExtensions) as string[],
    RATE_LIMIT_MAX: rateLimitMax,
    RATE_LIMIT_WINDOW_SEC: rateLimitWindowSec,
    ...(discordWebhookUrl ? { DISCORD_WEBHOOK_URL: discordWebhookUrl } : {}),
    ...(slackWebhookUrl ? { SLACK_WEBHOOK_URL: slackWebhookUrl } : {}),
  });

  return cached;
}

/**
 * 캐시 무효화 — **유닛 테스트 전용**.
 * 테스트가 임시 디렉터리를 MARKDOWN_ROOT로 갈아끼울 수 있어야 해서 존재한다.
 * 프로덕션 코드에서는 호출하지 않는다.
 */
export function resetServerEnvCacheForTest(): void {
  cached = null;
}
