/**
 * 링크 색인 + 그래프 통합 테스트 (실제 SQLite 색인, 임시 MARKDOWN_ROOT).
 *
 * 확인 대상:
 *   - 색인 시 링크 저장 → 백링크·나가는 링크 해석
 *   - 아직 없는 문서(ghost) → 나중에 업로드되면 재색인 없이 연결
 *   - 문서 삭제 시 링크 제거, 캐시 무효화
 *   - 로컬 그래프 깊이, 태그 노드, 전체 그래프의 고립 노드
 *   - 링크 테이블 도입 전 색인(마이그레이션)을 한 번 전부 다시 읽어 채움
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import { getGraph, getLinksFor, resetLinkGraphCacheForTest } from '@/lib/link-graph';
import {
  closeDbForTest,
  indexFile,
  initIndex,
  removeFromIndex,
  waitForBuildForTest,
} from '@/lib/search-index';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdws-graph-test-'));
  process.env.MARKDOWN_ROOT = root;
  process.env.SESSION_PASSWORD =
    'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:' + Buffer.alloc(64, 1).toString('base64');
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,png';
  process.env.RATE_LIMIT_MAX = '120';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
  resetLinkGraphCacheForTest();
});

afterEach(async () => {
  closeDbForTest();
  resetServerEnvCacheForTest();
  resetLinkGraphCacheForTest();
  await fs.rm(root, { recursive: true, force: true });
});

async function write(subpath: string, content: string): Promise<void> {
  const abs = path.join(root, ...subpath.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/** 파일을 쓰고 색인한다 (업로드 라우트가 하는 일과 같다). */
async function put(subpath: string, content: string): Promise<void> {
  await write(subpath, content);
  await indexFile(subpath);
}

async function buildIndex(): Promise<void> {
  initIndex();
  await waitForBuildForTest();
}

describe('백링크와 나가는 링크', () => {
  it('위키링크·md 링크를 해석하고 백링크에 문맥을 싣는다', async () => {
    await buildIndex();
    await put('proj/설계.md', '# 렌더링 설계\n본문');
    await put('proj/작업-1005.md', '# 10월 5일\n오늘 [[설계]]를 반영했다\n[다음](./todo.md)');
    await put('proj/todo.md', '# 할 일\n- [ ] [[설계]] 검토');

    const design = getLinksFor('proj/설계.md');
    expect(design.indexed).toBe(true);
    expect(design.backlinks).toEqual([
      { source: 'proj/작업-1005.md', title: '10월 5일', context: '오늘 [[설계]]를 반영했다' },
      { source: 'proj/todo.md', title: '할 일', context: '- [ ] [[설계]] 검토' },
    ].sort((a, b) => a.title.localeCompare(b.title, 'ko')));

    const work = getLinksFor('proj/작업-1005.md');
    expect(work.outgoing).toEqual([
      { kind: 'wiki', raw: '설계', resolved: 'proj/설계.md', title: '렌더링 설계' },
      { kind: 'md', raw: 'proj/todo.md', resolved: 'proj/todo.md', title: '할 일' },
    ]);
  });

  it('없는 문서는 ghost — 나중에 그 문서가 올라오면 원본 재색인 없이 연결된다', async () => {
    await buildIndex();
    await put('a.md', '[[미래 문서]]');

    expect(getLinksFor('a.md').outgoing[0].resolved).toBeNull();
    expect(getGraph().nodes.find((n) => n.id === 'ghost:미래 문서')?.type).toBe('ghost');

    await put('미래 문서.md', '# 이제 있음');
    expect(getLinksFor('a.md').outgoing[0].resolved).toBe('미래 문서.md');
    expect(getLinksFor('미래 문서.md').backlinks.map((b) => b.source)).toEqual(['a.md']);
    expect(getGraph().nodes.some((n) => n.type === 'ghost')).toBe(false);
  });

  it('원본 문서를 지우면 그 링크도 사라진다 (캐시 무효화 포함)', async () => {
    await buildIndex();
    await put('b.md', '# B');
    await put('a.md', '[[b]]');
    expect(getLinksFor('b.md').backlinks).toHaveLength(1);

    removeFromIndex('a.md');
    expect(getLinksFor('b.md').backlinks).toHaveLength(0);
  });

  it('자기 자신을 가리키는 링크와 같은 쌍의 중복은 한 번만 센다', async () => {
    await buildIndex();
    await put('b.md', '# B');
    await put('a.md', '[[a]] [[b]] [B](./b.md)');
    expect(getLinksFor('b.md').backlinks).toHaveLength(1);
    expect(getGraph().edges).toEqual([{ source: 'a.md', target: 'b.md' }]);
  });
});

describe('이전 버전 파일', () => {
  it('저장 시 남는 버전 백업(이름_YYYYMMDD-HHmmss.md)은 노드·백링크에 넣지 않는다', async () => {
    await buildIndex();
    await put('b.md', '# B');
    await put('a.md', '[[b]] 새 버전');
    // 에디터 저장이 남기는 백업 — 증분 빌드가 디스크에서 찾아 색인한다
    await put('a_20261005-120000.md', '[[b]] 옛 버전');

    expect(getLinksFor('b.md').backlinks.map((b) => b.source)).toEqual(['a.md']);
    expect(getGraph().nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md']);
  });
});

describe('그래프', () => {
  async function chain(): Promise<void> {
    // a → b → c → d,  e는 고립
    await buildIndex();
    await put('a.md', '---\ntags: [설계]\n---\n[[b]]');
    await put('b.md', '[[c]]');
    await put('c.md', '---\ntags: [설계]\n---\n[[d]]');
    await put('d.md', '# D');
    await put('e.md', '# 고립');
  }

  it('전체 그래프에는 고립 문서도 점으로 들어간다', async () => {
    await chain();
    const g = getGraph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
    expect(g.nodes.find((n) => n.id === 'e.md')?.degree).toBe(0);
    expect(g.edges).toHaveLength(3);
  });

  it('로컬 그래프는 깊이만큼 양방향으로 넓힌다', async () => {
    await chain();
    const ids = (depth: number) =>
      getGraph({ center: 'b.md', depth }).nodes.map((n) => n.id).sort();
    expect(ids(1)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(ids(2)).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
  });

  it('태그 노드는 요청할 때만 넣고, 로컬 그래프에서 태그를 거쳐 퍼지지 않는다', async () => {
    await chain();
    expect(getGraph().nodes.some((n) => n.type === 'tag')).toBe(false);

    const withTags = getGraph({ includeTags: true });
    expect(withTags.nodes.find((n) => n.id === 'tag:설계')).toMatchObject({
      label: '#설계',
      degree: 2,
    });

    // d의 1단계 이웃은 c뿐. c의 태그로 a까지 번지면 안 된다 (깊이 2라도 태그는 통로가 아니다)
    const local = getGraph({ center: 'd.md', depth: 2, includeTags: true });
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['b.md', 'c.md', 'd.md', 'tag:설계']);
  });
});

describe('마이그레이션 — 링크 테이블 도입 전 색인', () => {
  it('links_version이 없으면 기존 문서를 전부 다시 읽어 링크를 채운다', async () => {
    await write('b.md', '# B');
    await write('a.md', '[[b]]');
    await buildIndex();
    expect(getLinksFor('b.md').backlinks).toHaveLength(1);

    // 옛 색인 흉내: 링크와 버전 기록을 지운다 (docs_meta의 mtime은 그대로 → 증분 빌드는 건너뛸 상황)
    closeDbForTest();
    resetLinkGraphCacheForTest();
    const raw = new Database(path.join(root, '.mdws', 'search.db'));
    raw.exec("DELETE FROM doc_links; DELETE FROM index_meta WHERE key = 'links_version';");
    raw.close();

    await buildIndex();
    expect(getLinksFor('b.md').backlinks.map((b) => b.source)).toEqual(['a.md']);

    // 버전이 기록되어 다음 기동에서는 다시 전부 읽지 않는다
    const check = new Database(path.join(root, '.mdws', 'search.db'));
    const row = check.prepare("SELECT value FROM index_meta WHERE key = 'links_version'").get();
    check.close();
    expect(row).toEqual({ value: '1' });
  });
});
