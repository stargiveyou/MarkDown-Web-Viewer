/**
 * Claude CLI 연동 유틸 유닛 테스트.
 *
 * 실제 CLI를 실행하지 않는다 — 경로 해석, 인자 구성, 출력 해석, 실패 분류만 검증한다.
 * (CLI 호출 자체는 Mac mini 환경 의존이라 유닛 테스트 대상이 아니다.)
 *
 * 이 파일이 고정하는 것은 "항상 폴백으로 떨어지던" 실패 원인들이다 —
 * 근거는 docs/valid/backend-ai-panel-validation.md 및 커밋 ba6052a 참조.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// better-sqlite3 인덱스와 env 검증을 끌어오지 않도록 대체한다.
vi.mock('./search-index', () => ({ search: () => [] }));
vi.mock('./env', () => ({ getServerEnv: () => ({ MARKDOWN_ROOT: os.tmpdir() }) }));

import {
  buildCliArgs,
  childEnv,
  ClaudeCliError,
  describeFailure,
  extractAnswer,
  getClaudeCliStatus,
  getTimeoutMs,
  isAiPanelEnabled,
  queryClaudeCli,
  resetClaudeCliCacheForTest,
  resolveClaudeCli,
} from './claude-cli';

/** 테스트가 건드리는 env 키. 각 테스트 후 원복한다. */
const TOUCHED_ENV_KEYS = [
  'CLAUDE_CLI_PATH',
  'AI_CLI_TIMEOUT_MS',
  'AI_PANEL_ENABLED',
  'SESSION_SECRET',
  'SESSION_PASSWORD',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of TOUCHED_ENV_KEYS) originalEnv.set(key, process.env[key]);
  resetClaudeCliCacheForTest();
});

afterEach(() => {
  for (const key of TOUCHED_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetClaudeCliCacheForTest();
  vi.restoreAllMocks();
});

/** 실행 가능한 더미 파일을 만들어 경로를 돌려준다. */
function makeFakeCli(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-cli-test-'));
  const fake = path.join(dir, 'claude');
  writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return fake;
}

describe('buildCliArgs', () => {
  const PROMPT = '사용자 질문: "보안"\n\n관련 문서 검색 결과 (총 1건):';

  it('--allowed-tools를 `=` 형식 단일 토큰으로 넘긴다', () => {
    // 실측 회귀: `--allowed-tools Read,Glob,Grep "<프롬프트>"` 로 띄어 쓰면
    // variadic 옵션이 프롬프트까지 도구 이름으로 삼켜
    // "Input must be provided either through stdin or as a prompt argument" 로 죽는다.
    const args = buildCliArgs(PROMPT);

    expect(args).toContain('--allowed-tools=Read,Glob,Grep');
    expect(args).not.toContain('--allowed-tools');
    expect(args).not.toContain('Read,Glob,Grep');
  });

  it('프롬프트를 맨 마지막 단일 원소로 둔다', () => {
    const args = buildCliArgs(PROMPT);

    expect(args[args.length - 1]).toBe(PROMPT);
    // 공백·줄바꿈이 있어도 쪼개지지 않아야 한다.
    expect(args.filter((a) => a === PROMPT)).toHaveLength(1);
  });

  it('비인터랙티브 JSON 출력 모드로 실행한다', () => {
    const args = buildCliArgs(PROMPT);

    expect(args).toContain('--print');
    expect(args.indexOf('json')).toBe(args.indexOf('--output-format') + 1);
  });

  it('파일 도구를 작업 디렉터리로 봉쇄한다', () => {
    // 실측(2.1.220): --restricted 가 없으면 --allowed-tools=Read 만으로
    // cwd 바깥 절대경로가 그대로 읽힌다. 이 앱에서 cwd 는 MARKDOWN_ROOT 이고,
    // 봉쇄가 풀리면 서버의 .env.local 까지 읽힌다(보안 불변식 2).
    const args = buildCliArgs(PROMPT);

    expect(args).toContain('--restricted');
    expect(args).toContain('--strict-mcp-config');
  });

  it('쓰기 도구를 허용 목록에 넣지 않는다', () => {
    const joined = buildCliArgs(PROMPT).join(' ');

    for (const writeTool of ['Write', 'Edit', 'Bash', 'NotebookEdit']) {
      expect(joined).not.toContain(writeTool);
    }
  });
});

describe('childEnv', () => {
  it('앱이 소유한 시크릿을 자식 프로세스 env에서 제거한다', () => {
    process.env.SESSION_SECRET = 'super-secret-value';
    process.env.SESSION_PASSWORD = 'scrypt:16384:8:1:salt:hash';
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/secret';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/secret';

    const env = childEnv();

    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.SESSION_PASSWORD).toBeUndefined();
    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined();
    expect(env.SLACK_WEBHOOK_URL).toBeUndefined();

    // 값이 다른 키로 새어나가지도 않아야 한다.
    expect(Object.values(env).join('\n')).not.toContain('super-secret-value');
  });

  it('PATH를 보강하고 비인터랙티브 힌트를 준다', () => {
    const env = childEnv();

    expect(env.TERM).toBe('dumb');
    expect(env.PATH).toBeTruthy();
    // 표준 설치 경로가 덧붙는다.
    expect(env.PATH).toContain(path.join(os.homedir(), '.claude', 'local'));
  });
});

describe('getTimeoutMs', () => {
  it('기본값은 120초다 — 실측상 정상 응답도 30초를 넘긴다', () => {
    delete process.env.AI_CLI_TIMEOUT_MS;
    expect(getTimeoutMs()).toBe(120_000);
  });

  it('환경변수로 상한을 올릴 수 있다', () => {
    process.env.AI_CLI_TIMEOUT_MS = '180000';
    expect(getTimeoutMs()).toBe(180_000);
  });

  it('너무 짧거나 형식이 틀린 값은 무시하고 기본값을 쓴다', () => {
    for (const bad of ['1000', '0', '-5000', 'abc', '12.5', '']) {
      process.env.AI_CLI_TIMEOUT_MS = bad;
      expect(getTimeoutMs()).toBe(120_000);
    }
  });
});

describe('extractAnswer', () => {
  it('--output-format json 응답에서 result를 꺼낸다', () => {
    const raw = JSON.stringify({ is_error: false, result: '  안녕하세요  ', duration_ms: 1838 });

    expect(extractAnswer(raw)).toEqual({ answer: '안녕하세요', isError: false });
  });

  it('종료 코드가 0이어도 is_error가 true면 실패로 표시한다', () => {
    const raw = JSON.stringify({ is_error: true, result: 'Credit balance too low' });

    expect(extractAnswer(raw)?.isError).toBe(true);
  });

  it('JSON이 아니거나 result가 비면 null을 돌려준다', () => {
    expect(extractAnswer('그냥 텍스트 응답')).toBeNull();
    expect(extractAnswer('')).toBeNull();
    expect(extractAnswer('{ 깨진 json')).toBeNull();
    expect(extractAnswer(JSON.stringify({ is_error: false, result: '   ' }))).toBeNull();
    expect(extractAnswer(JSON.stringify({ is_error: false }))).toBeNull();
  });
});

describe('describeFailure', () => {
  it('CLI 오류 원문을 그대로 노출하지 않는다', () => {
    // 보안 불변식 8 — 절대경로·API 응답 본문이 사용자에게 새면 안 된다.
    const raw = 'Error at /Users/husky/MarkdownDocs/.env.local: invalid token sk-ant-xxx';
    const hint = describeFailure(raw, 1);

    expect(hint).not.toContain('/Users/husky');
    expect(hint).not.toContain('sk-ant-xxx');
  });

  it('인증 실패는 로그인 확인을 안내한다', () => {
    for (const raw of ['Invalid credentials', 'OAuth token expired', 'Unauthorized']) {
      expect(describeFailure(raw, 1)).toContain('로그인');
    }
  });

  it('사용량 한도는 재시도를 안내한다', () => {
    for (const raw of ['Credit balance too low', 'usage limit reached', 'Overloaded']) {
      expect(describeFailure(raw, 1)).toContain('사용량');
    }
  });

  it('분류되지 않으면 종료 코드만 알려준다', () => {
    expect(describeFailure('무언가 알 수 없는 실패', 137)).toContain('exit 137');
    expect(describeFailure('무언가 알 수 없는 실패')).not.toContain('exit');
  });
});

describe('isAiPanelEnabled', () => {
  it('기본값은 off다 — 외부 상태에 의존하는 기능이라 명시적으로 켜야 한다', () => {
    delete process.env.AI_PANEL_ENABLED;
    expect(isAiPanelEnabled()).toBe(false);
  });

  it('true 일 때만 켜진다', () => {
    for (const on of ['true', 'TRUE', ' true ']) {
      process.env.AI_PANEL_ENABLED = on;
      expect(isAiPanelEnabled()).toBe(true);
    }
    for (const off of ['1', 'yes', 'on', 'false', '']) {
      process.env.AI_PANEL_ENABLED = off;
      expect(isAiPanelEnabled()).toBe(false);
    }
  });
});

describe('resolveClaudeCli', () => {
  it('CLAUDE_CLI_PATH가 존재하지 않는 경로면 null을 반환한다', () => {
    process.env.CLAUDE_CLI_PATH = path.join(os.tmpdir(), 'definitely-not-a-real-claude-binary');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(resolveClaudeCli()).toBeNull();
    expect(getClaudeCliStatus().available).toBe(false);
  });

  it('CLAUDE_CLI_PATH가 실제 파일이면 그 경로를 그대로 쓴다', () => {
    const fake = makeFakeCli();
    process.env.CLAUDE_CLI_PATH = fake;

    expect(resolveClaudeCli()).toBe(fake);
    expect(getClaudeCliStatus()).toEqual({ available: true, path: fake });
  });

  it('한 번 해석한 결과를 캐시한다', () => {
    const fake = makeFakeCli();
    process.env.CLAUDE_CLI_PATH = fake;
    expect(resolveClaudeCli()).toBe(fake);

    // 캐시를 비우지 않은 채 env만 바꿔도 이전 결과가 유지되어야 한다.
    process.env.CLAUDE_CLI_PATH = path.join(path.dirname(fake), 'other');
    expect(resolveClaudeCli()).toBe(fake);
  });
});

describe('queryClaudeCli', () => {
  it('기능이 꺼져 있으면 CLI를 실행하지 않고 DISABLED로 떨어진다', async () => {
    delete process.env.AI_PANEL_ENABLED;

    await expect(queryClaudeCli('테스트 질문')).rejects.toMatchObject({
      name: 'ClaudeCliError',
      code: 'DISABLED',
    });
  });

  it('CLI를 찾지 못하면 CLI_NOT_FOUND로 분류된 오류를 던진다', async () => {
    process.env.AI_PANEL_ENABLED = 'true';
    process.env.CLAUDE_CLI_PATH = path.join(os.tmpdir(), 'definitely-not-a-real-claude-binary');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(queryClaudeCli('테스트 질문')).rejects.toMatchObject({
      name: 'ClaudeCliError',
      code: 'CLI_NOT_FOUND',
    });
  });

  it('빈 질문은 실행 전에 거절한다', async () => {
    await expect(queryClaudeCli('   ')).rejects.toBeInstanceOf(Error);
  });

  it('ClaudeCliError는 stderr 원문을 message가 아니라 detail에만 담는다', () => {
    const err = new ClaudeCliError('EXIT_ERROR', '사용자 안내 문구', '/Users/me/secret/path: boom');

    expect(err.message).not.toContain('/Users/me/secret/path');
    expect(err.detail).toContain('/Users/me/secret/path');
  });
});
