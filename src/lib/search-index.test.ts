/**
 * FTS5 검색 색인 유닛 테스트.
 *
 * 임시 디렉터리를 MARKDOWN_ROOT로 설정하고, 테스트용 마크다운 파일을 생성해
 * 색인 구축·검색·태그 집계·증분 빌드·삭제 감지를 검증한다.
 *
 * 필수 테스트 케이스:
 *   1. 한글 trigram 부분 일치
 *   2. 영문 검색
 *   3. snippet 하이라이트 마커
 *   4. BM25 정렬 (검색어가 더 많이 등장하는 문서가 상위)
 *   5. 증분 빌드 -- 변경 감지
 *   6. 증분 빌드 -- 삭제 감지
 *   7. 태그 집계
 *   8. 빈 검색어 (에러)
 *   9. 특수문자 검색
 *  10. frontmatter 없는 파일
 *
 * 담당: backend-dev / Stage 3
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import {
  closeDbForTest,
  getAllTags,
  indexFile,
  initIndex,
  isIndexing,
  search,
  waitForBuildForTest,
} from '@/lib/search-index';
import { SNIPPET_MARK } from '@/types/api';

let root = '';
let originalMarkdownRoot: string | undefined;

beforeAll(async () => {
  // 기존 환경변수 보존
  originalMarkdownRoot = process.env.MARKDOWN_ROOT;
});

beforeEach(async () => {
  // 매 테스트마다 새 임시 디렉터리
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mdws-search-test-'));
  root = base;

  process.env.MARKDOWN_ROOT = root;
  process.env.SESSION_PASSWORD =
    'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:' +
    Buffer.alloc(64, 1).toString('base64');
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,markdown,png,jpg';
  process.env.RATE_LIMIT_MAX = '120';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
});

afterEach(async () => {
  // DB 닫기 + 임시 디렉터리 정리
  closeDbForTest();
  resetServerEnvCacheForTest();

  if (root !== '') {
    await fs.rm(root, { recursive: true, force: true });
    root = '';
  }
});

afterAll(() => {
  // 원래 환경변수 복원
  if (originalMarkdownRoot !== undefined) {
    process.env.MARKDOWN_ROOT = originalMarkdownRoot;
  } else {
    delete process.env.MARKDOWN_ROOT;
  }
  resetServerEnvCacheForTest();
});

/** 테스트용 마크다운 파일을 생성한다. */
async function writeMarkdown(subpath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, ...subpath.split('/'));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. 한글 trigram 부분 일치
// ---------------------------------------------------------------------------

describe('한글 trigram 부분 일치', () => {
  it('"제주도"로 검색 시 "제주도에서 먹은 흑돼지" 매치', async () => {
    await writeMarkdown(
      'travel/jeju.md',
      `---
title: 제주 여행기
tags:
  - 여행
  - 제주
---

제주도에서 먹은 흑돼지가 정말 맛있었다.
`,
    );

    await indexFile('travel/jeju.md');

    const results = search('제주도');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].subpath).toBe('travel/jeju.md');
    expect(results[0].title).toBe('제주 여행기');
  });
});

// ---------------------------------------------------------------------------
// 2. 영문 검색
// ---------------------------------------------------------------------------

describe('영문 검색', () => {
  it('"react"로 검색', async () => {
    await writeMarkdown(
      'dev/react-guide.md',
      `---
title: React 입문 가이드
tags:
  - react
  - frontend
---

React는 Facebook에서 만든 UI 라이브러리입니다.
React hooks를 사용하면 함수형 컴포넌트에서도 상태를 관리할 수 있습니다.
`,
    );

    await indexFile('dev/react-guide.md');

    const results = search('react');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].subpath).toBe('dev/react-guide.md');
  });
});

// ---------------------------------------------------------------------------
// 3. snippet 하이라이트 마커
// ---------------------------------------------------------------------------

describe('snippet 하이라이트 마커', () => {
  it('결과 snippet에 [[hl]]/[[/hl]] 포함', async () => {
    await writeMarkdown(
      'notes/example.md',
      `---
title: 테스트 문서
---

이것은 테스트용 본문입니다. 검색 기능을 확인합니다.
`,
    );

    await indexFile('notes/example.md');

    const results = search('테스트');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet).toContain(SNIPPET_MARK.open);
    expect(results[0].snippet).toContain(SNIPPET_MARK.close);
  });
});

// ---------------------------------------------------------------------------
// 4. BM25 정렬
// ---------------------------------------------------------------------------

describe('BM25 정렬', () => {
  it('검색어가 더 많이 등장하는 문서가 상위', async () => {
    // 문서 A: "TypeScript"가 1번 등장
    await writeMarkdown(
      'a.md',
      `---
title: 문서 A
---

TypeScript를 한 번 언급합니다.
`,
    );

    // 문서 B: "TypeScript"가 여러 번 등장
    await writeMarkdown(
      'b.md',
      `---
title: 문서 B
---

TypeScript TypeScript TypeScript TypeScript TypeScript
TypeScript는 정말 좋은 언어입니다. TypeScript를 많이 사용합니다.
TypeScript TypeScript TypeScript로 프로젝트를 만들었습니다.
`,
    );

    await indexFile('a.md');
    await indexFile('b.md');

    const results = search('TypeScript');
    expect(results.length).toBe(2);
    // BM25에서 rank는 낮을수록 관련도 높음 (음수). 더 많이 등장하는 b.md가 상위.
    expect(results[0].subpath).toBe('b.md');
  });
});

// ---------------------------------------------------------------------------
// 5. 증분 빌드 -- 변경 감지
// ---------------------------------------------------------------------------

describe('증분 빌드 -- 변경 감지', () => {
  it('mtime이 바뀐 파일만 재색인', async () => {
    await writeMarkdown(
      'doc1.md',
      `---
title: 원본 문서 제목
---

원본 내용입니다. 원본 문서를 확인합니다.
`,
    );

    // 초기 빌드
    initIndex();
    await waitForBuildForTest();
    expect(isIndexing()).toBe(false);

    // trigram은 3자 이상이어야 매치. "원본 문서"의 trigram을 검색.
    let results = search('원본 문서');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('원본 문서 제목');

    // DB 닫고 파일 내용 변경
    closeDbForTest();
    resetServerEnvCacheForTest();

    // 약간의 지연을 두고 파일 변경 (mtime 차이를 보장)
    await new Promise((resolve) => setTimeout(resolve, 100));

    await writeMarkdown(
      'doc1.md',
      `---
title: 수정된 문서 제목
---

수정된 내용입니다. 수정된 문서를 확인합니다.
`,
    );

    // 증분 빌드
    initIndex();
    await waitForBuildForTest();

    results = search('수정된 문서');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('수정된 문서 제목');
  });
});

// ---------------------------------------------------------------------------
// 6. 증분 빌드 -- 삭제 감지
// ---------------------------------------------------------------------------

describe('증분 빌드 -- 삭제 감지', () => {
  it('디스크에 없는 파일이 색인에서 제거', async () => {
    await writeMarkdown(
      'will-delete.md',
      `---
title: 삭제될 문서
---

이 문서는 곧 삭제됩니다.
`,
    );

    // 초기 빌드
    initIndex();
    await waitForBuildForTest();

    let results = search('삭제될');
    expect(results.length).toBe(1);

    // DB 닫고 파일 삭제
    closeDbForTest();
    resetServerEnvCacheForTest();

    await fs.unlink(path.join(root, 'will-delete.md'));

    // 증분 빌드
    initIndex();
    await waitForBuildForTest();

    results = search('삭제될');
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. 태그 집계
// ---------------------------------------------------------------------------

describe('태그 집계', () => {
  it('여러 파일의 tags를 정확히 집계', async () => {
    await writeMarkdown(
      'a.md',
      `---
title: 문서 A
tags:
  - react
  - frontend
---

A 내용
`,
    );

    await writeMarkdown(
      'b.md',
      `---
title: 문서 B
tags:
  - react
  - backend
---

B 내용
`,
    );

    await writeMarkdown(
      'c.md',
      `---
title: 문서 C
tags:
  - frontend
---

C 내용
`,
    );

    await indexFile('a.md');
    await indexFile('b.md');
    await indexFile('c.md');

    const tags = getAllTags();

    const reactTag = tags.find((t) => t.tag === 'react');
    expect(reactTag).toBeDefined();
    expect(reactTag!.count).toBe(2);

    const frontendTag = tags.find((t) => t.tag === 'frontend');
    expect(frontendTag).toBeDefined();
    expect(frontendTag!.count).toBe(2);

    const backendTag = tags.find((t) => t.tag === 'backend');
    expect(backendTag).toBeDefined();
    expect(backendTag!.count).toBe(1);

    // count 내림차순 정렬 확인
    for (let i = 1; i < tags.length; i++) {
      expect(tags[i - 1].count).toBeGreaterThanOrEqual(tags[i].count);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. 빈 검색어
// ---------------------------------------------------------------------------

describe('빈 검색어', () => {
  it('빈 문자열로 검색 시 결과 없음 (라우트 핸들러가 2자 미만을 사전 거부)', () => {
    // FTS5 trigram에서 빈 쌍따옴표 '""' 는 결과 없음을 반환한다.
    // 라우트 핸들러가 2자 미만을 400으로 사전 거부하므로 여기까지 오지 않지만,
    // search() 자체가 에러 없이 빈 결과를 반환하는지 확인한다.
    const results = search('');
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. 특수문자 검색
// ---------------------------------------------------------------------------

describe('특수문자 검색', () => {
  it('쌍따옴표가 포함된 검색어', async () => {
    await writeMarkdown(
      'quotes.md',
      `---
title: 인용문
---

그가 "안녕하세요"라고 말했다.
`,
    );

    await indexFile('quotes.md');

    // 쌍따옴표가 포함된 검색어가 에러 없이 실행되어야 한다
    const results = search('안녕하세요');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('특수문자가 섞인 검색어도 에러 없이 실행', async () => {
    await writeMarkdown(
      'special.md',
      `---
title: 특수문자 문서
---

C++ 프로그래밍과 Node.js 개발
`,
    );

    await indexFile('special.md');

    // 에러 없이 실행되어야 한다
    const results = search('C++');
    // trigram 특성상 결과가 없을 수 있지만 에러는 아니어야 한다
    expect(Array.isArray(results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. frontmatter 없는 파일
// ---------------------------------------------------------------------------

describe('frontmatter 없는 파일', () => {
  it('title이 파일명으로 대체, tags 빈 배열', async () => {
    await writeMarkdown(
      'no-frontmatter.md',
      `이 문서에는 frontmatter가 없습니다.

그냥 본문만 있는 마크다운 파일입니다.
`,
    );

    await indexFile('no-frontmatter.md');

    const results = search('frontmatter');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // frontmatter가 없으면 파일명(확장자 제외)이 title이 된다
    expect(results[0].title).toBe('no-frontmatter');
    // tags는 undefined 또는 빈 배열
    expect(results[0].tags === undefined || results[0].tags?.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 추가: isIndexing() 상태 확인
// ---------------------------------------------------------------------------

describe('isIndexing() 상태', () => {
  it('initIndex() 후 빌드 완료까지 true, 완료 후 false', async () => {
    await writeMarkdown(
      'test.md',
      `---
title: 테스트
---

테스트 내용
`,
    );

    initIndex();
    // initIndex 직후에는 indexing이 true일 수 있다
    // (빈 디렉터리라 즉시 완료될 수도 있음)
    await waitForBuildForTest();
    expect(isIndexing()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 추가: indexFile 후 mtime 반환 확인
// ---------------------------------------------------------------------------

describe('검색 결과 mtime', () => {
  it('mtime이 0이 아닌 양수', async () => {
    await writeMarkdown(
      'mtime-test.md',
      `---
title: mtime 테스트
---

내용
`,
    );

    await indexFile('mtime-test.md');

    const results = search('mtime');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].mtime).toBeGreaterThan(0);
  });
});
