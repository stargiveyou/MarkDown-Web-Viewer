/**
 * 폴더 ZIP 다운로드 통합 테스트 — `GET /api/download?path=<폴더>`.
 *
 * 임시 디렉터리를 MARKDOWN_ROOT로 세우고 라우트 핸들러를 직접 호출한다.
 * ZIP 본문은 라이브러리 없이 로컬 파일 헤더(`PK\x03\x04`)를 직접 훑어
 * 엔트리 이름 목록을 뽑아 검증한다 — 저장 이름은 압축되지 않으므로 그대로 읽힌다.
 *
 * 확인 대상:
 *   - 폴더 → 200 + application/zip + `Content-Disposition` 에 `<폴더명>.zip`
 *   - 중첩 폴더가 `/` 구분자 상대 경로로 담긴다 (Windows에서 `\`가 새지 않는다)
 *   - 한글 폴더명이 RFC 5987 `filename*`으로 보존된다
 *   - 숨김 항목(`.mdws` 등)은 제외된다
 *   - 루트를 벗어나는 심볼릭 링크는 **건너뛰되** 폴더 전체를 실패시키지 않는다
 *   - traversal 경로는 400
 *   - 파일 경로는 ZIP이 아니라 원본 바이너리로 내려간다
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import { resetRateLimitForTest } from '@/lib/rate-limit';

import { GET } from './route';

let base = '';
let root = '';
let outside = '';
/** Windows에서 **파일** symlink는 관리자 권한이 필요하다. 실패하면 관련 단정을 건너뛴다. */
let symlinkCreated = false;
/** 디렉터리 링크는 Windows에서도 junction으로 만들 수 있다. */
let dirLinkCreated = false;

/** 테스트 요청. rate limit 키가 IP 기반이라 호출마다 다른 IP를 준다. */
let ipCounter = 0;
function req(subpath: string): Request {
  ipCounter += 1;
  return new Request(
    `https://example.test/api/download?path=${encodeURIComponent(subpath)}`,
    { headers: { 'x-forwarded-for': `10.0.0.${ipCounter % 250}` } },
  );
}

/**
 * ZIP 버퍼에서 로컬 파일 헤더를 훑어 엔트리 이름을 수집한다.
 * 헤더 레이아웃: 시그니처(4) … 압축크기(18) 원본크기(22) 이름길이(26) extra길이(28) 이름(30…)
 */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 30 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLen = buf.readUInt16LE(i + 26);
    if (nameLen === 0 || i + 30 + nameLen > buf.length) continue;
    names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'));
  }
  return names;
}

beforeAll(async () => {
  // `env.ts`는 MARKDOWN_ROOT가 `/`로 시작할 것을 요구한다(POSIX 전제).
  // 그래서 `os.tmpdir()`를 그대로 쓰면 Windows(`C:\...`)에서 env 검증에 걸린다.
  // `/`로 시작하는 경로를 만들고 `path.resolve`로 실제 위치를 잡으면 양쪽에서 돈다.
  // macOS의 `/tmp` → `/private/tmp` 심볼릭 링크도 경로 유틸이 이미 처리한다.
  const posixBase = `/tmp/mdws-folderzip-${process.pid}-${Date.now()}`;
  base = path.resolve(posixBase);
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET\n', 'utf8');

  // --- 압축 대상 폴더 (중첩 + 숨김 + 한글명) ---
  const docs = path.join(root, '2026-회고');
  await fs.mkdir(path.join(docs, 'images'), { recursive: true });
  await fs.mkdir(path.join(docs, '.mdws'), { recursive: true });
  await fs.writeFile(path.join(docs, 'index.md'), '# 회고\n본문\n', 'utf8');
  await fs.writeFile(path.join(docs, 'images', 'shot.md'), 'nested\n', 'utf8');
  await fs.writeFile(path.join(docs, '.mdws', 'state.json'), '{}', 'utf8');

  // 루트 밖을 가리키는 링크 — 건너뛰어야 하되 폴더 전체를 깨뜨리면 안 된다.
  // (Windows에서 권한이 없으면 생성이 실패하므로 그 경우는 조용히 넘긴다.)
  try {
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(docs, 'escape.md'));
    symlinkCreated = true;
  } catch {
    /* symlink 권한 없음 — 해당 단정은 아래에서 건너뛴다 */
  }

  // 루트 밖 디렉터리를 가리키는 링크. Windows에서는 junction이 권한 없이도 만들어지므로
  // `isSymbolicLink()` 건너뛰기 경로를 양쪽 플랫폼에서 실제로 태울 수 있다.
  try {
    await fs.symlink(outside, path.join(docs, 'escape-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    dirLinkCreated = true;
  } catch {
    /* 링크 생성 불가 — 해당 단정은 아래에서 건너뛴다 */
  }

  // --- 빈 폴더 ---
  await fs.mkdir(path.join(root, 'empty'));

  // --- 단일 파일 ---
  await fs.writeFile(path.join(root, 'solo.md'), '# solo\n', 'utf8');

  process.env.MARKDOWN_ROOT = `${posixBase}/root`;
  process.env.SESSION_PASSWORD =
    'scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:' + Buffer.alloc(64, 3).toString('base64');
  process.env.SESSION_SECRET = 'd'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,markdown,png,jpg';
  process.env.RATE_LIMIT_MAX = '500';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
});

afterAll(async () => {
  resetServerEnvCacheForTest();
  if (base !== '') await fs.rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimitForTest();
});

describe('폴더 ZIP 다운로드', () => {
  it('폴더 요청 시 200 + application/zip 으로 응답한다', async () => {
    const res = await GET(req('2026-회고'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
  });

  it('Content-Disposition에 한글 폴더명을 RFC 5987로 보존한다', async () => {
    const res = await GET(req('2026-회고'));
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe('2026-회고.zip');
  });

  it('본문이 ZIP 시그니처로 시작한다', async () => {
    const res = await GET(req('2026-회고'));
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('중첩 파일을 `/` 구분자 상대 경로로 담는다', async () => {
    const res = await GET(req('2026-회고'));
    const names = zipEntryNames(Buffer.from(await res.arrayBuffer()));
    expect(names).toContain('index.md');
    expect(names).toContain('images/shot.md');
    // 어떤 엔트리 이름에도 백슬래시가 없어야 한다.
    expect(names.filter((n) => n.includes('\\'))).toEqual([]);
  });

  it('숨김 항목(.mdws)은 제외한다', async () => {
    const res = await GET(req('2026-회고'));
    const names = zipEntryNames(Buffer.from(await res.arrayBuffer()));
    expect(names.some((n) => n.includes('.mdws'))).toBe(false);
  });

  // 링크 생성 가능 여부는 beforeAll에서야 정해지므로 수집 시점 `skipIf`로는 판정할 수 없다.
  // (수집은 beforeAll보다 먼저 돈다 — 그래서 런타임에 건너뛴다.)
  it('루트를 벗어나는 파일 심볼릭 링크는 건너뛰되 폴더 전체는 성공한다', async (ctx) => {
    if (!symlinkCreated) ctx.skip();
    const res = await GET(req('2026-회고'));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(zipEntryNames(buf).some((n) => n.includes('escape'))).toBe(false);
    // 링크 대상 내용이 새어 나오지 않는다.
    expect(buf.includes(Buffer.from('TOP SECRET'))).toBe(false);
  });

  it(
    '루트를 벗어나는 디렉터리 링크를 따라가지 않고 폴더 전체는 성공한다',
    async (ctx) => {
      if (!dirLinkCreated) ctx.skip();
      const res = await GET(req('2026-회고'));
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(zipEntryNames(buf).some((n) => n.includes('escape-dir'))).toBe(false);
      expect(buf.includes(Buffer.from('TOP SECRET'))).toBe(false);
    },
  );

  it('파일이 없는 폴더는 400을 반환한다', async () => {
    const res = await GET(req('empty'));
    expect(res.status).toBe(400);
  });
});

describe('폴더 다운로드 — 경로 안전성 (보안 불변식 2)', () => {
  const attacks = [
    '../outside',
    '../../etc',
    '2026-회고/../../outside',
    '%2e%2e%2foutside',
    '/etc',
  ];

  for (const attack of attacks) {
    it(`traversal 거부: ${attack}`, async () => {
      const res = await GET(req(attack));
      expect(res.status).toBe(400);
      const body = await res.text();
      expect(body).not.toContain('TOP SECRET');
    });
  }

  it('빈 path는 400 (루트 전체 압축을 허용하지 않는다)', async () => {
    const res = await GET(req(''));
    expect(res.status).toBe(400);
  });
});

describe('파일 다운로드는 ZIP으로 감싸지 않는다', () => {
  it('단일 .md는 text/markdown 원본으로 내려간다', async () => {
    const res = await GET(req('solo.md'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await res.text()).toBe('# solo\n');
  });
});
