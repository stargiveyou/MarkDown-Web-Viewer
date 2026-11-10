/**
 * 삭제 Lock 저장소 유닛 테스트.
 *
 * 검증 항목:
 *   1. 잠금 설정·해제
 *   2. 목록 일괄 조회
 *   3. 폴더 하위 잠긴 항목 탐지 (재귀 삭제 차단 근거)
 *   4. 와일드카드 문자(`%`, `_`)가 든 폴더명에서 오탐이 없는지
 *   5. 삭제 후 잠금 기록 정리
 *   6. 이동 시 잠금이 새 경로로 따라가는지 (이동→삭제 우회 차단)
 *
 * MARKDOWN_ROOT는 POSIX 절대 경로 문자열로 준다 — `getServerEnv()`가 `/` 시작을
 * 요구하기 때문이다(맥미니 상주 기준). 실제 디스크 경로는 `path.resolve()`로 얻어
 * 윈도우 개발 환경에서도 같은 테스트가 돈다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeLocksDbForTest,
  findLockedDescendant,
  getLockedSubpaths,
  isDeleteLocked,
  moveDeleteLocks,
  removeDeleteLocks,
  setDeleteLock,
} from '@/lib/delete-lock';
import { resetServerEnvCacheForTest } from '@/lib/env';

let rootPosix = '';
let rootReal = '';
let originalMarkdownRoot: string | undefined;

beforeEach(async () => {
  originalMarkdownRoot = process.env.MARKDOWN_ROOT;

  rootPosix = `/tmp/mdws-lock-test-${randomUUID()}`;
  rootReal = path.resolve(rootPosix);
  await fs.mkdir(rootReal, { recursive: true });

  process.env.MARKDOWN_ROOT = rootPosix;
  process.env.SESSION_PASSWORD =
    'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:' + Buffer.alloc(64, 1).toString('base64');
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,markdown,png,jpg';
  process.env.RATE_LIMIT_MAX = '120';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
  closeLocksDbForTest();
});

afterEach(async () => {
  closeLocksDbForTest();
  if (originalMarkdownRoot === undefined) {
    delete process.env.MARKDOWN_ROOT;
  } else {
    process.env.MARKDOWN_ROOT = originalMarkdownRoot;
  }
  resetServerEnvCacheForTest();
  await fs.rm(rootReal, { recursive: true, force: true });
});

describe('삭제 Lock 저장소', () => {
  it('잠금을 걸고 해제한다', () => {
    expect(isDeleteLocked('docs/a.md')).toBe(false);

    setDeleteLock('docs/a.md', true);
    expect(isDeleteLocked('docs/a.md')).toBe(true);

    setDeleteLock('docs/a.md', false);
    expect(isDeleteLocked('docs/a.md')).toBe(false);
  });

  it('여러 경로의 잠금 여부를 한 번에 조회한다', () => {
    setDeleteLock('docs/a.md', true);
    setDeleteLock('docs', true);

    const locked = getLockedSubpaths(['docs', 'docs/a.md', 'docs/b.md']);
    expect(locked).toEqual(new Set(['docs', 'docs/a.md']));
  });

  it('빈 목록 조회는 빈 Set을 돌려준다', () => {
    expect(getLockedSubpaths([])).toEqual(new Set());
  });

  it('폴더 하위의 잠긴 항목을 찾는다', () => {
    setDeleteLock('docs/nested/keep.md', true);

    expect(findLockedDescendant('docs')).toBe('docs/nested/keep.md');
    expect(findLockedDescendant('docs/nested')).toBe('docs/nested/keep.md');
    expect(findLockedDescendant('other')).toBeNull();
  });

  it('잠긴 항목 자신은 하위 항목으로 잡히지 않는다', () => {
    setDeleteLock('docs', true);
    expect(findLockedDescendant('docs')).toBeNull();
  });

  it('접두사가 겹치는 다른 폴더를 하위로 오인하지 않는다', () => {
    setDeleteLock('docs-backup/a.md', true);
    expect(findLockedDescendant('docs')).toBeNull();
  });

  it('와일드카드 문자가 든 폴더명에서 오탐하지 않는다', () => {
    setDeleteLock('100%_report/a.md', true);

    // LIKE를 쓰면 `_`·`%`가 와일드카드로 해석돼 엉뚱한 경로가 걸린다.
    expect(findLockedDescendant('1005xreport')).toBeNull();
    expect(findLockedDescendant('100%_report')).toBe('100%_report/a.md');
  });

  it('파일 삭제 후 잠금 기록을 지운다', () => {
    setDeleteLock('docs/a.md', true);
    removeDeleteLocks('docs/a.md', false);
    expect(isDeleteLocked('docs/a.md')).toBe(false);
  });

  it('폴더 삭제 후 하위 잠금 기록까지 지운다', () => {
    setDeleteLock('docs', true);
    setDeleteLock('docs/a.md', true);
    setDeleteLock('other/b.md', true);

    removeDeleteLocks('docs', true);

    expect(isDeleteLocked('docs')).toBe(false);
    expect(isDeleteLocked('docs/a.md')).toBe(false);
    expect(isDeleteLocked('other/b.md')).toBe(true);
  });

  it('파일을 이동하면 잠금이 새 경로로 따라간다', () => {
    setDeleteLock('docs/a.md', true);

    moveDeleteLocks('docs/a.md', 'archive/a.md', false);

    expect(isDeleteLocked('docs/a.md')).toBe(false);
    expect(isDeleteLocked('archive/a.md')).toBe(true);
  });

  it('폴더를 이동하면 하위 잠금 경로까지 갱신된다', () => {
    setDeleteLock('docs', true);
    setDeleteLock('docs/nested/keep.md', true);

    moveDeleteLocks('docs', 'archive/docs', true);

    expect(isDeleteLocked('archive/docs')).toBe(true);
    expect(isDeleteLocked('archive/docs/nested/keep.md')).toBe(true);
    expect(findLockedDescendant('docs')).toBeNull();
    expect(findLockedDescendant('archive')).not.toBeNull();
  });

  it('잠금이 없는 항목의 이동은 아무 기록도 만들지 않는다', () => {
    moveDeleteLocks('docs/a.md', 'archive/a.md', false);
    expect(isDeleteLocked('archive/a.md')).toBe(false);
  });
});
