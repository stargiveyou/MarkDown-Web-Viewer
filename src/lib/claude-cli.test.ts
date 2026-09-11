/**
 * Claude CLI 연동 유틸 유닛 테스트.
 *
 * 실제 CLI를 실행하지 않는다 — 경로 해석과 실패 분류만 검증한다.
 * (CLI 호출 자체는 Mac mini 환경 의존이라 유닛 테스트 대상이 아니다.)
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// better-sqlite3 인덱스와 env 검증을 끌어오지 않도록 대체한다.
vi.mock('./search-index', () => ({ search: () => [] }));
vi.mock('./env', () => ({ getServerEnv: () => ({ MARKDOWN_ROOT: os.tmpdir() }) }));

import {
  ClaudeCliError,
  getClaudeCliStatus,
  queryClaudeCli,
  resetClaudeCliCacheForTest,
  resolveClaudeCli,
} from './claude-cli';

const originalCliPath = process.env.CLAUDE_CLI_PATH;

beforeEach(() => {
  resetClaudeCliCacheForTest();
});

afterEach(() => {
  if (originalCliPath === undefined) {
    delete process.env.CLAUDE_CLI_PATH;
  } else {
    process.env.CLAUDE_CLI_PATH = originalCliPath;
  }
  resetClaudeCliCacheForTest();
  vi.restoreAllMocks();
});

describe('resolveClaudeCli', () => {
  it('CLAUDE_CLI_PATH가 존재하지 않는 경로면 null을 반환한다', () => {
    process.env.CLAUDE_CLI_PATH = path.join(os.tmpdir(), 'definitely-not-a-real-claude-binary');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(resolveClaudeCli()).toBeNull();
    expect(getClaudeCliStatus().available).toBe(false);
  });

  it('CLAUDE_CLI_PATH가 실제 파일이면 그 경로를 그대로 쓴다', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-cli-test-'));
    const fake = path.join(dir, 'claude');
    writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    process.env.CLAUDE_CLI_PATH = fake;

    expect(resolveClaudeCli()).toBe(fake);
    expect(getClaudeCliStatus()).toEqual({ available: true, path: fake });
  });

  it('한 번 해석한 결과를 캐시한다', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-cli-test-'));
    const fake = path.join(dir, 'claude');
    writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    process.env.CLAUDE_CLI_PATH = fake;
    expect(resolveClaudeCli()).toBe(fake);

    // 캐시를 비우지 않은 채 env만 바꿔도 이전 결과가 유지되어야 한다.
    process.env.CLAUDE_CLI_PATH = path.join(dir, 'other');
    expect(resolveClaudeCli()).toBe(fake);
  });
});

describe('queryClaudeCli', () => {
  it('CLI를 찾지 못하면 CLI_NOT_FOUND로 분류된 오류를 던진다', async () => {
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
