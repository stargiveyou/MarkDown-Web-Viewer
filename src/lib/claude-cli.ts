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

/** CLI 응답 대기 상한(ms). 도구 호출이 섞이면 30초로는 부족해 기본값을 넉넉히 잡는다. */
const DEFAULT_TIMEOUT_MS = 120_000;

function getTimeoutMs(): number {
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

/** `--output-format json` 응답에서 실제 답변 텍스트를 뽑는다. */
function extractAnswer(raw: string): { answer: string; isError: boolean } | null {
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

  // CLI의 작업 디렉터리를 문서 루트로 고정한다 — 읽기 도구가 엉뚱한 곳(프로젝트 소스)을 뒤지지 않게.
  let cwd: string;
  try {
    cwd = getServerEnv().MARKDOWN_ROOT;
  } catch {
    cwd = process.cwd();
  }

  const timeoutMs = getTimeoutMs();

  return new Promise((resolve, reject) => {
    // Non-interactive print 모드로 claude CLI 실행.
    // --output-format json 은 종료코드만으로 알기 어려운 실패(is_error)를 구조적으로 알려준다.
    // 도구는 읽기 전용만 허용한다 — 이 패널은 조회용이고, 쓰기는 앱의 에디터 경로로만 일어나야 한다.
    //
    // ⚠️ `--allowed-tools` 는 variadic(`<tools...>`) 옵션이라
    // `--allowed-tools Read,Glob,Grep "<프롬프트>"` 로 띄어 쓰면 **프롬프트까지 도구 이름으로
    // 빨아들여** CLI가 "Input must be provided either through stdin or as a prompt argument"
    // 로 죽는다(실측). 반드시 `=` 형식으로 값을 고정한다.
    const args = [
      '--print',
      '--output-format',
      'json',
      '--allowed-tools=Read,Glob,Grep',
      promptContext,
    ];

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
      env: {
        ...process.env,
        PATH: augmentedPath(),
        // 비인터랙티브 터미널 힌트
        TERM: 'dumb',
      },
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
        settleReject(
          new ClaudeCliError(
            'EXIT_ERROR',
            `Claude CLI가 오류를 반환했습니다: ${parsed.answer.slice(0, 200)}`,
            detail,
          ),
        );
        return;
      }

      if (code !== 0) {
        const looksLikeAuth = /login|authenticat|credential|api key|oauth|expired/i.test(detail);
        settleReject(
          new ClaudeCliError(
            'EXIT_ERROR',
            looksLikeAuth
              ? 'Claude CLI 인증이 만료된 것으로 보입니다. Mac mini 터미널에서 claude 로그인 상태를 확인하세요.'
              : `Claude CLI가 비정상 종료했습니다(exit ${code}). 서버 로그를 확인하세요.`,
            detail,
          ),
        );
        return;
      }

      settleReject(
        new ClaudeCliError('EMPTY_OUTPUT', 'Claude CLI가 빈 응답을 반환했습니다.', detail),
      );
    });
  });
}
