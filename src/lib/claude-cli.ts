/**
 * Mac mini의 Claude CLI 연동 유틸리티.
 *
 * Mac mini에 로그인된 `claude` (Claude Code / Claude Max CLI)를 `child_process.spawn`으로 실행하여
 * 디스크 내 파일 관련 자연어 검색 및 문맥 질의응답을 수행한다.
 *
 * 보안 및 성능:
 * 1. FTS5 검색 인덱스(`src/lib/search-index.ts`)로 1차 연관 문서를 선별하여 Prompt Context로 제공.
 * 2. 타임아웃(기본 120초, `AI_CLI_TIMEOUT_MS`로 조정) 및 프로세스 에러 처리.
 * 3. CLI의 파일 접근은 읽기 전용 도구(Read/Glob/Grep)로 제한하고 cwd를 `MARKDOWN_ROOT`로 고정한다.
 */

import 'server-only';

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getServerEnv } from './env';
import { search } from './search-index';

export interface AiChatResult {
  answer: string;
  relatedFiles: Array<{
    path: string;
    snippet?: string;
  }>;
}

/** 폴백 사유 분류. 프론트에 그대로 노출해도 안전한 값만 쓴다(스택트레이스 금지). */
export type ClaudeCliFailureCode =
  | 'DISABLED'
  | 'CLI_NOT_FOUND'
  | 'SPAWN_FAILED'
  | 'TIMEOUT'
  | 'EXIT_ERROR'
  | 'EMPTY_OUTPUT';

/**
 * CLI 호출 실패. `code`와 `hint`는 사용자에게 노출 가능한 요약이며,
 * 원본 stderr는 `detail`에 담아 **서버 로그 전용**으로만 쓴다(보안 불변식 8).
 */
export class ClaudeCliError extends Error {
  readonly code: ClaudeCliFailureCode;
  readonly hint: string;
  readonly detail?: string;

  constructor(code: ClaudeCliFailureCode, hint: string, detail?: string) {
    super(`${code}: ${hint}`);
    this.name = 'ClaudeCliError';
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }
}

/**
 * AI 패널 기능 스위치. **기본 off.**
 *
 * 이 기능은 앱이 통제하지 못하는 외부 상태(맥미니의 CLI 설치·로그인·사용량)에 의존한다.
 * 문제가 생겼을 때 재배포 없이 끌 수 있어야 한다.
 * 경로 봉쇄 실측이 끝난 환경에서만 `AI_PANEL_ENABLED=true`로 켠다.
 */
export function isAiPanelEnabled(): boolean {
  return process.env.AI_PANEL_ENABLED?.trim().toLowerCase() === 'true';
}

/** CLI 응답 대기 상한(ms). 도구 호출이 섞이면 30초로는 부족해 기본값을 넉넉히 잡는다. */
const DEFAULT_TIMEOUT_MS = 120_000;

export function getTimeoutMs(): number {
  const raw = process.env.AI_CLI_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 5_000 ? value : DEFAULT_TIMEOUT_MS;
}

/**
 * CLI가 설치될 수 있는 표준 위치들.
 *
 * `next start`가 launchd·pm2·GUI 앱 등으로 기동되면 로그인 셸의 PATH를 물려받지 못해
 * `spawn('claude')`가 ENOENT로 죽는다 — 가장 흔한 실패 원인이라 PATH에만 의존하지 않는다.
 */
function candidatePaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH 검색용으로 표준 설치 경로를 덧붙인 PATH 값. */
function augmentedPath(): string {
  const extra = candidatePaths().map((p) => path.dirname(p));
  const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return Array.from(new Set([...current, ...extra])).join(path.delimiter);
}

/**
 * 자식 프로세스에 넘기지 않을 환경변수.
 *
 * CLI 는 이 값들이 전혀 필요 없는데, 자식 프로세스의 env 는 `ps -E` 같은 수단으로
 * 읽히기 쉽다. 앱이 소유한 시크릿을 남의 프로세스 주소공간에 복사할 이유가 없다(보안 불변식 6).
 *
 * `src/lib/env.ts`의 `ServerEnv`에 시크릿을 추가하면 여기에도 추가한다.
 */
const SECRET_ENV_KEYS: readonly string[] = [
  'SESSION_SECRET',
  'SESSION_PASSWORD',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
];

/** 시크릿을 뺀 자식 프로세스용 환경변수. */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];

  env.PATH = augmentedPath();
  // 비인터랙티브 터미널 힌트
  env.TERM = 'dumb';
  return env;
}

let resolvedCli: string | null | undefined;

/**
 * 실행할 `claude` 바이너리의 절대경로를 찾는다. 못 찾으면 `null`.
 *
 * 우선순위: `CLAUDE_CLI_PATH` → 표준 설치 경로 → PATH 탐색(augmented).
 * 결과는 프로세스 수명 동안 캐시한다.
 */
export function resolveClaudeCli(): string | null {
  if (resolvedCli !== undefined) return resolvedCli;

  const explicit = process.env.CLAUDE_CLI_PATH?.trim();
  if (explicit) {
    // 명시 설정은 오타를 조용히 넘기지 않는다 — 존재하지 않으면 그대로 실패시킨다.
    resolvedCli = isExecutable(explicit) ? explicit : null;
    if (resolvedCli === null) {
      console.error(`[claude-cli] CLAUDE_CLI_PATH가 실행 가능한 파일이 아닙니다: ${explicit}`);
    }
    return resolvedCli;
  }

  for (const candidate of candidatePaths()) {
    if (isExecutable(candidate)) {
      resolvedCli = candidate;
      return resolvedCli;
    }
  }

  // 표준 경로에 없으면 PATH에 맡긴다(심볼릭 링크·버전 매니저 등).
  const dirs = augmentedPath().split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'claude');
    if (isExecutable(candidate)) {
      resolvedCli = candidate;
      return resolvedCli;
    }
  }

  resolvedCli = null;
  return resolvedCli;
}

/** 테스트용 캐시 리셋. */
export function resetClaudeCliCacheForTest(): void {
  resolvedCli = undefined;
}

/** CLI가 준비되어 있는지 확인한다(진단용). */
export function getClaudeCliStatus(): { available: boolean; path: string | null } {
  const cli = resolveClaudeCli();
  return { available: cli !== null, path: cli };
}

/**
 * CLI 실패 원문을 보고 **고정 문구**로 된 조치 안내를 고른다.
 *
 * 원문에는 절대경로나 API 응답 본문이 섞일 수 있어 그대로 노출하지 않는다(보안 불변식 8).
 * 대신 흔한 실패 유형만 판별해 사용자가 실제로 취할 수 있는 행동을 알려준다.
 */
export function describeFailure(raw: string, exitCode?: number | null): string {
  if (/login|authenticat|credential|oauth|expired|unauthorized|api key/i.test(raw)) {
    return 'Claude CLI 인증이 만료된 것으로 보입니다. Mac mini 터미널에서 claude 로그인 상태를 확인하세요.';
  }
  if (/balance|credit|quota|usage limit|rate.?limit|overloaded/i.test(raw)) {
    return 'Claude 사용량 한도 또는 과부하로 보입니다. 잠시 후 다시 시도하거나 잔여 사용량을 확인하세요.';
  }
  return exitCode === undefined || exitCode === null
    ? 'Claude CLI가 오류를 반환했습니다. 서버 로그를 확인하세요.'
    : `Claude CLI가 비정상 종료했습니다(exit ${exitCode}). 서버 로그를 확인하세요.`;
}

/**
 * CLI에 넘길 argv를 만든다.
 *
 * ⚠️ `--allowed-tools`는 variadic(`<tools...>`) 옵션이라
 * `--allowed-tools Read,Glob,Grep "<프롬프트>"`처럼 띄어 쓰면 **프롬프트까지 도구 이름으로
 * 빨아들여** CLI가 "Input must be provided either through stdin or as a prompt argument"로
 * 죽는다(실측). 반드시 `=` 형식으로 값을 고정하고, 프롬프트는 맨 마지막 단일 원소로 둔다.
 *
 * 도구는 읽기 전용만 허용한다 — 이 패널은 조회용이고, 쓰기는 앱의 에디터 경로로만 일어나야 한다.
 */
export function buildCliArgs(promptContext: string): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    // `--restricted`는 파일 도구를 **작업 디렉터리(= MARKDOWN_ROOT) 안으로 봉쇄**하고,
    // 명령 실행 계열 도구와 WebFetch를 제거하며, user/project/local 설정 파일을 무시한다.
    //
    // 실측(2.1.220): 이 플래그가 없으면 `--allowed-tools=Read`만으로 cwd 바깥 절대경로가
    // 그대로 읽힌다. 있으면 permission_denials에 기록되고 차단된다.
    // 이 앱은 인터넷에 노출돼 있고 서버 프로세스가 `.env.local`을 읽을 수 있는 위치에서
    // 돌기 때문에, 봉쇄는 선택이 아니라 전제다(보안 불변식 2).
    '--restricted',
    // 외부 MCP 서버 설정을 일절 끌어오지 않는다 — 앱이 통제하지 못하는 도구 표면을 막는다.
    '--strict-mcp-config',
    '--allowed-tools=Read,Glob,Grep',
    promptContext,
  ];
}

/** `--output-format json` 응답에서 실제 답변 텍스트를 뽑는다. */
export function extractAnswer(raw: string): { answer: string; isError: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { result?: unknown; is_error?: unknown };
    const result = typeof parsed.result === 'string' ? parsed.result.trim() : '';
    if (!result) return null;
    return { answer: result, isError: parsed.is_error === true };
  } catch {
    return null;
  }
}

/**
 * 사용자 질문을 받아 FTS5 1차 검색 결과를 바탕으로 맥미니 Claude CLI를 실행하여 답변을 생성한다.
 */
export async function queryClaudeCli(userQuery: string): Promise<AiChatResult> {
  const trimmedQuery = userQuery.trim();
  if (!trimmedQuery) {
    throw new Error('검색어를 입력해 주세요.');
  }

  if (!isAiPanelEnabled()) {
    throw new ClaudeCliError(
      'DISABLED',
      'AI 응답 기능이 꺼져 있습니다. 문서 검색 결과만 제공합니다.',
    );
  }

  // 1. FTS5 인덱스를 통해 관련도 높은 마크다운 파일 1차 탐색
  const ftsResults = search(trimmedQuery);
  const relatedFiles = ftsResults.slice(0, 5).map((r) => ({
    path: r.subpath,
    snippet: r.snippet,
  }));

  // 2. Claude CLI에 전달할 Prompt 구성
  let promptContext = `사용자 질문: "${trimmedQuery}"\n\n`;

  if (relatedFiles.length > 0) {
    promptContext += `관련 문서 검색 결과 (총 ${relatedFiles.length}건):\n`;
    relatedFiles.forEach((file, index) => {
      promptContext += `${index + 1}. 파일 경로: ${file.path}\n`;
      if (file.snippet) {
        // HTML 태그 제거된 스니펫
        const cleanSnippet = file.snippet.replace(/<[^>]*>/g, '');
        promptContext += `   내용 요약: ${cleanSnippet}\n`;
      }
    });
    promptContext += `\n위 관련 문서 정보 및 파일 시스템 지식을 바탕으로 사용자의 질문에 친절하고 정확하게 한국어로 답변해 주세요. 관련 파일 경로가 언급되면 답변 내에 [파일경로] 형식으로 명확히 포함해 주세요.`;
  } else {
    promptContext += `현재 검색어와 직접 매칭되는 문서를 찾지 못했습니다. 파일 구조나 일반 마크다운 파일 관련 질문이라면 친절하게 안내해 주세요.`;
  }

  // 3. 실행할 Claude CLI 경로 확인
  const cliExecutable = resolveClaudeCli();
  if (!cliExecutable) {
    throw new ClaudeCliError(
      'CLI_NOT_FOUND',
      'Mac mini에서 claude 실행 파일을 찾지 못했습니다. .env.local에 CLAUDE_CLI_PATH를 절대경로로 지정하고 서버를 재시작하세요.',
    );
  }

  // CLI의 작업 디렉터리를 문서 루트로 고정한다.
  //
  // `--restricted` 하에서 cwd는 단순한 시작 위치가 아니라 **파일 도구의 봉쇄 경계**다.
  // 여기에 `process.cwd()` 폴백을 두면 경계가 `.env.local`이 있는 프로젝트 루트로
  // 내려앉는다 — 정확히 막으려던 것을 열어주는 폴백이다. CLAUDE.md의 "하드코딩 폴백
  // 금지"에도 어긋나므로, 환경변수가 잘못됐으면 폴백 없이 실패시킨다.
  let cwd: string;
  try {
    cwd = getServerEnv().MARKDOWN_ROOT;
  } catch {
    throw new ClaudeCliError('SPAWN_FAILED', '서버 환경변수가 올바르지 않습니다.');
  }

  const timeoutMs = getTimeoutMs();

  return new Promise((resolve, reject) => {
    // Non-interactive print 모드로 claude CLI 실행 (인자 구성 근거는 buildCliArgs 참고).
    const args = buildCliArgs(promptContext);

    // ⚠️ shell: true 를 쓰지 않는다. shell 을 켜면 command+args 가 따옴표 없이
    // 한 줄로 이어붙어, 공백·줄바꿈이 있는 promptContext 가 셸에서 단어 분리되어
    // 첫 토큰(예: "사용자")만 전달된다(실제 관측된 버그). 또한 사용자 입력이
    // 그대로 셸에 들어가 command injection 위험이 있다(보안 불변식 8/일반 원칙).
    //
    // stdin 은 'ignore' 로 닫는다. 파이프로 열어두면 CLI 가 파이프 입력을 기다리며
    // 호출마다 3초를 그냥 버린다("no stdin data received in 3s").
    const child = spawn(cliExecutable, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    });

    let stdoutData = '';
    let stderrData = '';
    let isSettled = false;

    const settleReject = (error: ClaudeCliError) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      reject(error);
    };

    const timeoutTimer = setTimeout(() => {
      if (isSettled) return;
      child.kill('SIGTERM');
      // SIGTERM 을 무시하는 경우를 대비한 강제 종료 — 좀비 프로세스를 남기지 않는다.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2_000);
      settleReject(
        new ClaudeCliError(
          'TIMEOUT',
          `Claude CLI 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다. AI_CLI_TIMEOUT_MS로 상한을 늘릴 수 있습니다.`,
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'ENOENT'
          ? 'claude 실행 파일을 찾지 못했습니다(PATH 누락). .env.local의 CLAUDE_CLI_PATH에 절대경로를 지정하세요.'
          : err.code === 'EACCES'
            ? 'claude 실행 파일에 실행 권한이 없습니다(chmod +x 확인).'
            : 'Claude CLI 프로세스를 시작하지 못했습니다.';
      settleReject(new ClaudeCliError('SPAWN_FAILED', hint, err.message));
    });

    child.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);

      const parsed = extractAnswer(stdoutData);

      if (parsed && !parsed.isError) {
        resolve({ answer: parsed.answer, relatedFiles });
        return;
      }

      // json 파싱이 실패해도 text 출력이 있으면 그대로 쓴다(포맷 변경 대비).
      const plain = stdoutData.trim();
      if (code === 0 && plain && !plain.startsWith('{')) {
        resolve({ answer: plain, relatedFiles });
        return;
      }

      const detail = (stderrData || plain).slice(0, 2_000);

      if (parsed?.isError) {
        // CLI가 만든 오류 원문에는 절대경로·API 응답 본문이 섞일 수 있다.
        // 그대로 내보내지 않고 분류된 고정 문구만 노출한다(보안 불변식 8). 원문은 detail로.
        settleReject(
          new ClaudeCliError(
            'EXIT_ERROR',
            describeFailure(parsed.answer),
            `${parsed.answer.slice(0, 1_000)}\n${detail}`,
          ),
        );
        return;
      }

      if (code !== 0) {
        settleReject(
          new ClaudeCliError('EXIT_ERROR', describeFailure(detail, code), detail),
        );
        return;
      }

      settleReject(
        new ClaudeCliError('EMPTY_OUTPUT', 'Claude CLI가 빈 응답을 반환했습니다.', detail),
      );
    });
  });
}
