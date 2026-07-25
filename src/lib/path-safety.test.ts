/**
 * 경로 안전 유틸 유닛 테스트 — 보안 불변식 2의 증거.
 *
 * CLAUDE.md가 요구하는 4종 공격을 모두 다룬다:
 *   1. `../` 상위 탈출 (중첩·혼합 형태 포함)
 *   2. 절대 경로 주입
 *   3. 인코딩 traversal (`%2e%2e%2f`, `..%2f`, 이중 인코딩)
 *   4. **심볼릭 링크 탈출** — 임시 디렉터리에 실제 심볼릭 링크를 만들어 검증한다
 *
 * 정상 경로가 통과하는지도 함께 확인한다. 전부 거부하는 유틸은 안전하지만 쓸모가 없다.
 *
 * 테스트는 `os.tmpdir()` 아래 실제 디렉터리를 만들어 돌린다.
 * macOS에서 `/tmp`는 `/private/tmp`로 가는 심볼릭 링크이므로,
 * 루트 자체가 심볼릭 링크인 상황까지 자연스럽게 커버된다.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetServerEnvCacheForTest } from '@/lib/env';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  sanitizeFilename,
  toSubpath,
} from '@/lib/path-safety';

/** 루트 안 */
let root = '';
/** 루트 밖 — 탈출에 성공하면 도달하게 되는 디렉터리 */
let outside = '';

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mdws-pathsafety-'));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);

  // --- 루트 안의 정상 구조 ---
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'hello.md'), '# hello\n', 'utf8');
  await fs.mkdir(path.join(root, '2026-Travel', 'Jeju'), { recursive: true });

  // --- 루트 밖의 표적 ---
  await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET\n', 'utf8');

  // --- 심볼릭 링크 3종 ---
  // (a) 루트 밖 파일을 가리키는 링크
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape-file.md'));
  // (b) 루트 밖 디렉터리를 가리키는 링크
  await fs.symlink(outside, path.join(root, 'escape-dir'));
  // (c) 루트 안을 가리키는 정상 링크 — 이건 허용돼야 한다
  await fs.symlink(path.join(root, 'notes'), path.join(root, 'notes-alias'));

  // 경로 유틸이 참조하는 env를 임시 루트로 갈아끼운다.
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

afterAll(async () => {
  resetServerEnvCacheForTest();
  if (root !== '') {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 1. `../` 상위 탈출
// ---------------------------------------------------------------------------

describe('resolveUnderRoot — 상위 디렉터리 traversal', () => {
  const attacks = [
    '../../etc/passwd',
    '..',
    '../',
    '../outside/secret.txt',
    'notes/../../outside/secret.txt',
    'notes/../../../../../../etc/passwd',
    './../../etc/passwd',
    'a/b/c/../../../../etc/passwd',
    'notes/./../../outside/secret.txt',
    'notes/subdir/../../../outside/secret.txt',
  ];

  it.each(attacks)('거부한다: %s', (attack) => {
    expect(() => resolveUnderRoot(attack)).toThrow(PathSafetyError);
  });

  it('루트로 되돌아오는 형태도 세그먼트 단계에서 거부한다', () => {
    // 최종 결과는 루트 안이지만, `..`를 허용하면 검증 로직이 순서 의존적이 된다.
    // 애초에 `..` 세그먼트 자체를 금지하는 편이 감사하기 쉽다.
    expect(() => resolveUnderRoot('notes/../notes/hello.md')).toThrow(PathSafetyError);
  });
});

// ---------------------------------------------------------------------------
// 2. 절대 경로 주입
// ---------------------------------------------------------------------------

describe('resolveUnderRoot — 절대 경로 주입', () => {
  const attacks = [
    '/etc/passwd',
    '/',
    '//etc/passwd',
    '/Users/husky/.ssh/id_rsa',
    'C:\\Windows\\System32',
    'C:/Windows/System32',
    '\\\\server\\share',
  ];

  it.each(attacks)('거부한다: %s', (attack) => {
    expect(() => resolveUnderRoot(attack)).toThrow(PathSafetyError);
  });

  it('루트 절대 경로를 그대로 넣어도 거부한다 (상대 경로 계약 위반)', () => {
    expect(() => resolveUnderRoot(path.join(root, 'notes/hello.md'))).toThrow(PathSafetyError);
  });
});

// ---------------------------------------------------------------------------
// 3. 인코딩 traversal
// ---------------------------------------------------------------------------

describe('resolveUnderRoot — 인코딩 traversal', () => {
  const attacks = [
    '%2e%2e%2f%2e%2e%2fetc/passwd', // ../../etc/passwd
    '%2e%2e/%2e%2e/etc/passwd',
    '..%2f..%2fetc%2fpasswd',
    'notes%2f..%2f..%2foutside%2fsecret.txt',
    '%2E%2E%2Fetc%2Fpasswd', // 대문자 인코딩
    '%252e%252e%252fetc', // 이중 인코딩 — 프레임워크가 1회 더 풀어도 막혀야 한다
    '%2fetc%2fpasswd', // 인코딩된 절대 경로
    'notes/%00hello.md', // NUL 주입
    'notes/%2e%2e%5c', // 인코딩된 백슬래시
    '%zz', // 깨진 인코딩
  ];

  it.each(attacks)('거부한다: %s', (attack) => {
    expect(() => resolveUnderRoot(attack)).toThrow(PathSafetyError);
  });

  it('디코딩을 과도하게 반복해야 하는 입력을 거부한다', () => {
    let nested = '../';
    for (let i = 0; i < 8; i += 1) nested = encodeURIComponent(nested);
    expect(() => resolveUnderRoot(nested)).toThrow(PathSafetyError);
  });
});

// ---------------------------------------------------------------------------
// 4. 심볼릭 링크 탈출 — 실제 링크를 만들어 검증
// ---------------------------------------------------------------------------

describe('assertRealPathUnderRoot — 심볼릭 링크 탈출', () => {
  it('루트 밖 파일을 가리키는 심볼릭 링크를 거부한다', async () => {
    // 문자열 수준으로는 완전히 정상인 경로다. 여기가 realpath 검사가 필요한 이유다.
    const resolved = resolveUnderRoot('escape-file.md');
    expect(resolved).toBe(path.join(root, 'escape-file.md'));

    await expect(assertRealPathUnderRoot(resolved)).rejects.toThrow(PathSafetyError);
  });

  it('루트 밖 디렉터리를 가리키는 심볼릭 링크 하위 경로를 거부한다', async () => {
    const resolved = resolveUnderRoot('escape-dir/secret.txt');
    await expect(assertRealPathUnderRoot(resolved)).rejects.toThrow(PathSafetyError);
  });

  it('링크 하위의 아직 존재하지 않는 경로(업로드 대상)도 거부한다', async () => {
    // 업로드는 "아직 없는 파일"을 만든다. 존재하지 않는다고 검사를 건너뛰면
    // 심볼릭 링크된 디렉터리에 파일을 써 넣을 수 있게 된다.
    const resolved = resolveUnderRoot('escape-dir/planted.md');
    await expect(assertRealPathUnderRoot(resolved)).rejects.toThrow(PathSafetyError);
  });

  it('루트 안을 가리키는 심볼릭 링크는 허용한다', async () => {
    const resolved = resolveUnderRoot('notes-alias/hello.md');
    await expect(assertRealPathUnderRoot(resolved)).resolves.toBeUndefined();
  });

  it('루트 밖 절대 경로를 직접 넣으면 거부한다', async () => {
    await expect(assertRealPathUnderRoot(path.join(outside, 'secret.txt'))).rejects.toThrow(
      PathSafetyError,
    );
  });

  it('상대 경로를 넣으면 거부한다 (resolveUnderRoot를 건너뛴 호출)', async () => {
    await expect(assertRealPathUnderRoot('notes/hello.md')).rejects.toThrow(PathSafetyError);
  });
});

// ---------------------------------------------------------------------------
// 5. 정상 경로는 통과해야 한다
// ---------------------------------------------------------------------------

describe('resolveUnderRoot — 정상 경로', () => {
  it('빈 문자열은 루트를 가리킨다', () => {
    expect(resolveUnderRoot('')).toBe(root);
    expect(resolveUnderRoot('.')).toBe(root);
    expect(resolveUnderRoot('./')).toBe(root);
  });

  it('하위 파일 경로를 절대 경로로 변환한다', () => {
    expect(resolveUnderRoot('notes/hello.md')).toBe(path.join(root, 'notes', 'hello.md'));
  });

  it('중첩 폴더와 공백·한글·퍼센트 인코딩된 정상 파일명을 처리한다', () => {
    expect(resolveUnderRoot('2026-Travel/Jeju')).toBe(path.join(root, '2026-Travel', 'Jeju'));
    expect(resolveUnderRoot('회의록/2026 상반기.md')).toBe(
      path.join(root, '회의록', '2026 상반기.md'),
    );
    // 프론트가 encodeURIComponent로 감싸 보내도 같은 경로로 풀린다.
    expect(resolveUnderRoot(encodeURIComponent('회의록') + '/note.md')).toBe(
      path.join(root, '회의록', 'note.md'),
    );
  });

  it('아직 존재하지 않는 업로드 대상도 통과한다', async () => {
    const resolved = resolveUnderRoot('2026-Travel/Jeju/new-photo.png');
    await expect(assertRealPathUnderRoot(resolved)).resolves.toBeUndefined();
  });

  it('실제 존재하는 파일도 통과한다', async () => {
    await expect(assertRealPathUnderRoot(resolveUnderRoot('notes/hello.md'))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. toSubpath — 절대 경로 역노출 방지 (보안 불변식 8)
// ---------------------------------------------------------------------------

describe('toSubpath', () => {
  it('루트 기준 상대 경로로 되돌린다', () => {
    expect(toSubpath(path.join(root, 'notes', 'hello.md'))).toBe('notes/hello.md');
  });

  it('루트 자신은 빈 문자열이다', () => {
    expect(toSubpath(root)).toBe('');
  });

  it('루트 밖 경로는 거부한다 — 절대 경로가 응답에 새지 않는다', () => {
    expect(() => toSubpath(path.join(outside, 'secret.txt'))).toThrow(PathSafetyError);
    expect(() => toSubpath('/etc/passwd')).toThrow(PathSafetyError);
  });

  it('루트와 접두사만 같은 형제 디렉터리를 루트 하위로 오인하지 않는다', () => {
    // `/tmp/x/root` 와 `/tmp/x/root-evil` — 단순 startsWith 비교의 고전적 함정.
    expect(() => toSubpath(`${root}-evil/secret.txt`)).toThrow(PathSafetyError);
  });
});

// ---------------------------------------------------------------------------
// 7. sanitizeFilename — 업로드 파일명 (보안 불변식 3)
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('경로 성분을 제거하고 파일명만 남긴다', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\evil.md')).toBe('evil.md');
    expect(sanitizeFilename('folder/sub/photo.png')).toBe('photo.png');
  });

  it('인코딩된 구분자도 제거한다', () => {
    expect(sanitizeFilename('..%2f..%2fpasswd')).toBe('passwd');
    expect(sanitizeFilename('%2e%2e%2fnote.md')).toBe('note.md');
  });

  it('선행 점을 제거해 숨김 파일 생성을 막는다', () => {
    expect(sanitizeFilename('.env')).toBe('env');
    expect(sanitizeFilename('...hidden.md')).toBe('hidden.md');
  });

  it('제어문자와 위험 문자를 제거·치환한다', () => {
    expect(sanitizeFilename('no\u0000te.md')).toBe('note.md');
    expect(sanitizeFilename('a<b>c:d.md')).toBe('a_b_c_d.md');
  });

  it('정상 파일명은 그대로 둔다', () => {
    expect(sanitizeFilename('2026 회의록.md')).toBe('2026 회의록.md');
    expect(sanitizeFilename('photo-01.png')).toBe('photo-01.png');
  });

  it('정제 후 비면 거부한다', () => {
    expect(() => sanitizeFilename('..')).toThrow(PathSafetyError);
    expect(() => sanitizeFilename('/')).toThrow(PathSafetyError);
    expect(() => sanitizeFilename('   ')).toThrow(PathSafetyError);
  });

  it('과도하게 긴 파일명은 확장자를 지키며 자른다', () => {
    const long = `${'가'.repeat(300)}.md`;
    const result = sanitizeFilename(long);
    expect(result.endsWith('.md')).toBe(true);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255);
  });

  it('새니타이즈 결과는 항상 resolveUnderRoot를 통과한다', () => {
    // 업로드 경로 조립의 실제 사용 형태: targetPath + sanitizeFilename(name)
    const name = sanitizeFilename('../../evil.md');
    expect(resolveUnderRoot(`2026-Travel/${name}`)).toBe(
      path.join(root, '2026-Travel', 'evil.md'),
    );
  });
});
