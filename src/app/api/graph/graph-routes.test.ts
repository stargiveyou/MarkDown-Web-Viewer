/**
 * `GET /api/links`, `GET /api/graph` 라우트 계약 테스트.
 * 세션 보호(401)는 미들웨어 책임이라 실서버 curl로 확인한다.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import { resetLinkGraphCacheForTest } from '@/lib/link-graph';
import { closeDbForTest, indexFile, initIndex, waitForBuildForTest } from '@/lib/search-index';

import { GET as graphGET } from './route';
import { GET as linksGET } from '../links/route';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdws-graph-route-'));
  process.env.MARKDOWN_ROOT = root;
  process.env.SESSION_PASSWORD =
    'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:' + Buffer.alloc(64, 1).toString('base64');
  process.env.SESSION_SECRET = 'a'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md';
  process.env.RATE_LIMIT_MAX = '120';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
  resetLinkGraphCacheForTest();

  await fs.writeFile(path.join(root, 'a.md'), '[[b]]');
  await fs.writeFile(path.join(root, 'b.md'), '# B');
  initIndex();
  await waitForBuildForTest();
  await indexFile('a.md');
});

afterEach(async () => {
  closeDbForTest();
  resetServerEnvCacheForTest();
  await fs.rm(root, { recursive: true, force: true });
});

const req = (url: string) => new Request(`http://localhost${url}`);

describe('GET /api/links', () => {
  it('백링크를 돌려준다', async () => {
    const res = await linksGET(req('/api/links?path=b.md'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backlinks.map((b: { source: string }) => b.source)).toEqual(['a.md']);
  });

  it.each([
    ['path 없음', '/api/links'],
    ['상위 탈출', '/api/links?path=../etc/passwd'],
    ['절대 경로', '/api/links?path=/etc/passwd'],
    ['인코딩 우회', `/api/links?path=${encodeURIComponent('..%2F..%2Fx.md')}`],
  ])('%s → 400, 내부 경로 비노출', async (_label, url) => {
    const res = await linksGET(req(url));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(root);
  });
});

describe('GET /api/graph', () => {
  it('path 없으면 전체, 있으면 로컬', async () => {
    const all = await (await graphGET(req('/api/graph'))).json();
    expect(all.nodes).toHaveLength(2);
    expect(all.center).toBeUndefined();

    const local = await (await graphGET(req('/api/graph?path=b.md&depth=1'))).json();
    expect(local.center).toBe('b.md');
    expect(local.edges).toEqual([{ source: 'a.md', target: 'b.md' }]);
  });

  it.each(['0', '4', 'abc', '1.5'])('depth=%s → 400', async (depth) => {
    expect((await graphGET(req(`/api/graph?path=b.md&depth=${depth}`))).status).toBe(400);
  });

  it('경로 탈출 → 400', async () => {
    expect((await graphGET(req('/api/graph?path=../x.md'))).status).toBe(400);
  });
});
