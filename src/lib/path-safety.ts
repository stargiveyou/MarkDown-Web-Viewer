/**
 * 경로 안전 유틸 — 보안 불변식 2.
 *
 * 사용자 입력 경로를 `MARKDOWN_ROOT` 하위로 **가두는 단일 구현**이다.
 * `/api/files`, `/api/upload`, `/api/file-content`, `/api/thumbnail`은
 * 예외 없이 이 모듈을 경유한다. 우회하는 경로가 하나라도 있으면 검증 FAIL이다.
 *
 * 방어 대상:
 *   - `../` 상위 탈출
 *   - 절대 경로 주입 (`/etc/passwd`)
 *   - 인코딩 traversal (`%2e%2e%2f`)
 *   - 심볼릭 링크를 통한 루트 밖 탈출 (realpath 확인 필요)
 *
 * 2단 방어:
 *   1. `resolveUnderRoot`        — 문자열 / `path.resolve` 수준 (동기). 항상 먼저 호출한다.
 *   2. `assertRealPathUnderRoot` — 파일시스템 realpath 수준. 심볼릭 링크를 잡는다.
 *   둘은 대체재가 아니라 **모두** 통과해야 한다.
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현 + 유닛 테스트
 */

import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { getServerEnv } from './env';

/** 경로 검증 실패. 라우트 핸들러는 이를 400으로 변환한다(내부 경로를 노출하지 않는다). */
export class PathSafetyError extends Error {
  constructor(reason: string) {
    super(`unsafe path: ${reason}`);
    this.name = 'PathSafetyError';
  }
}

/**
 * 퍼센트 디코딩 반복 상한.
 *
 * Next는 쿼리스트링을 이미 1회 디코딩해서 넘겨준다. 공격자는 `%252e%252e%252f`처럼
 * **이중 인코딩**해 "프레임워크가 1회, 우리가 1회" 풀면 `../`가 되도록 노릴 수 있다.
 * 그래서 더 이상 변하지 않을 때까지 풀면서 **모든 중간 단계**를 검사한다.
 * 어느 단계에서든 traversal 징후가 보이면 거부한다.
 */
const MAX_DECODE_PASSES = 5;

/** 경로 문자열 전체 길이 상한. 비정상적으로 긴 입력을 조기에 끊는다. */
const MAX_PATH_LENGTH = 4096;

/** 파일명 길이 상한(바이트). 대부분의 파일시스템 한계가 255다. */
const MAX_FILENAME_BYTES = 255;

/** 제어문자(NUL·DEL 포함). 경로·파일명 어디에도 허용하지 않는다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * MARKDOWN_ROOT의 **정규화된** 절대 경로.
 *
 * `env.ts`는 값을 원본 그대로 보관하고(미들웨어 번들 트레이싱 문제), 정규화는 여기서 한다.
 * 후행 슬래시·중복 슬래시가 남아 있으면 아래 `isInside()`의 접두사 비교가 어긋나므로
 * 루트 표기를 확정하는 지점이 정확히 한 곳이어야 한다.
 */
function getRoot(): string {
  return path.resolve(getServerEnv().MARKDOWN_ROOT);
}

/** `child`가 `root` 자신이거나 그 하위인지. 접두사 비교의 경계 실수를 막는 단일 지점. */
function isInside(root: string, child: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(prefix);
}

/**
 * 디코딩 단계마다 적용하는 문자열 수준 검사.
 * 여기서 놓쳐도 최종 `path.resolve` 후 루트 포함 검사가 한 번 더 막는다(중복 방어).
 */
function assertNoTraversalSignals(candidate: string): void {
  if (CONTROL_CHARS.test(candidate)) {
    throw new PathSafetyError('control character');
  }
  // 백슬래시는 macOS에서 합법적인 파일명 문자지만, `..\` 우회 시도와 구분할 실익이 없다.
  if (candidate.includes('\\')) {
    throw new PathSafetyError('backslash separator');
  }
  if (candidate.startsWith('/') || path.isAbsolute(candidate)) {
    throw new PathSafetyError('absolute path');
  }
  // Windows 드라이브 표기(`C:\`, `C:/`)도 절대 경로 주입으로 본다.
  if (/^[a-zA-Z]:/.test(candidate)) {
    throw new PathSafetyError('drive-letter path');
  }
  if (candidate.split('/').some((segment) => segment === '..')) {
    throw new PathSafetyError('parent traversal');
  }
  if (path.normalize(candidate).startsWith('..')) {
    throw new PathSafetyError('normalizes above root');
  }
}

/**
 * 퍼센트 인코딩을 더 이상 변하지 않을 때까지 풀고, 매 단계를 검사한다.
 * @returns 완전히 디코딩된 경로 문자열
 */
function decodeAndScreen(input: string): string {
  let current = input;
  assertNoTraversalSignals(current);

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (!current.includes('%')) return current;

    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // `%zz` 같은 깨진 인코딩. 해석을 시도하지 않고 거부한다.
      throw new PathSafetyError('malformed percent-encoding');
    }

    if (decoded === current) return current;
    assertNoTraversalSignals(decoded);
    current = decoded;
  }

  // 5회를 넘겨도 안 끝나는 입력은 정상 경로일 수 없다.
  throw new PathSafetyError('excessive encoding depth');
}

/**
 * MARKDOWN_ROOT 기준 상대 경로를 검증된 절대 경로로 변환한다.
 *
 * @param userPath 클라이언트가 보낸 상대 경로 (`subpath`, `path`, `filePath`, `targetPath`)
 * @returns MARKDOWN_ROOT 하위임이 보장된 절대 경로
 * @throws {PathSafetyError} 루트를 벗어나거나 형식이 부적절한 경우
 */
export function resolveUnderRoot(userPath: string): string {
  if (typeof userPath !== 'string') {
    throw new PathSafetyError('not a string');
  }
  if (userPath.length > MAX_PATH_LENGTH) {
    throw new PathSafetyError('too long');
  }

  const root = getRoot();

  // 빈 값·`.`·`./`는 루트 자신을 가리키는 정상 입력이다(목록 조회의 기본값).
  const trimmed = userPath.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === './') {
    return root;
  }

  const decoded = decodeAndScreen(trimmed.normalize('NFC'));

  // 선행 `/`는 위 검사에서 이미 거부됐으므로 여기 오는 것은 순수 상대 경로뿐이다.
  const resolved = path.resolve(root, decoded);

  // 최후의 관문. 문자열 검사를 모두 빠져나온 입력도 여기서 걸린다.
  if (!isInside(root, resolved)) {
    throw new PathSafetyError('escapes root');
  }

  return resolved;
}

/**
 * 심볼릭 링크까지 해석해 실제 대상이 루트 안에 있는지 확인한다.
 * 이미 존재하는 파일을 읽거나 덮어쓸 때 사용한다.
 * (`resolveUnderRoot`는 문자열 수준, 이 함수는 파일시스템 수준 검증이다.)
 *
 * 아직 존재하지 않는 경로(업로드 대상)도 안전하게 다룬다 —
 * **존재하는 최근접 조상**까지 거슬러 올라가 realpath를 구한 뒤 남은 세그먼트를 얹어 판정한다.
 * 조상 중 하나가 루트 밖을 가리키는 심볼릭 링크면 여기서 걸린다.
 */
export async function assertRealPathUnderRoot(absolutePath: string): Promise<void> {
  if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
    throw new PathSafetyError('not an absolute path');
  }

  const root = getRoot();

  // 루트 자체가 심볼릭 링크일 수 있다(예: macOS의 /tmp → /private/tmp).
  // 비교 기준을 realpath로 맞추지 않으면 정상 경로까지 전부 거부된다.
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw new PathSafetyError('markdown root is not accessible');
  }

  // 문자열 수준 판정을 먼저 통과해야 한다(2단 방어의 1단을 건너뛰지 않도록).
  const target = path.resolve(absolutePath);
  if (!isInside(root, target) && !isInside(realRoot, target)) {
    throw new PathSafetyError('escapes root');
  }

  let current = target;
  const pending: string[] = [];

  for (;;) {
    let real: string;
    try {
      real = await fs.realpath(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // ENOENT/ENOTDIR = 아직 만들어지지 않은 경로. 한 단계 위로 올라가 다시 시도한다.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new PathSafetyError('realpath failed');
      }
      const parent = path.dirname(current);
      if (parent === current) {
        // 파일시스템 루트까지 올라갔는데도 존재하지 않는다 = 판정 불가.
        throw new PathSafetyError('no existing ancestor');
      }
      pending.unshift(path.basename(current));
      current = parent;
      continue;
    }

    // 존재하는 조상의 실제 위치 + 아직 없는 나머지 세그먼트.
    const effective = pending.length > 0 ? path.resolve(real, ...pending) : real;
    if (!isInside(realRoot, effective)) {
      throw new PathSafetyError('symlink escapes root');
    }
    return;
  }
}

/**
 * 절대 경로를 클라이언트에 노출 가능한 상대 경로로 되돌린다.
 * 응답에 서버 파일시스템 구조를 흘리지 않기 위한 역변환이다(보안 불변식 8).
 *
 * @returns POSIX 구분자(`/`)를 쓰는 상대 경로. 루트 자신이면 빈 문자열.
 */
export function toSubpath(absolutePath: string): string {
  if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
    throw new PathSafetyError('not an absolute path');
  }

  const root = getRoot();
  const resolved = path.resolve(absolutePath);

  if (!isInside(root, resolved)) {
    throw new PathSafetyError('escapes root');
  }

  const relative = path.relative(root, resolved);
  if (relative === '') return '';
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathSafetyError('escapes root');
  }

  return relative.split(path.sep).join('/');
}

/** 업로드 파일명 새니타이즈 — 경로 구분자·제어문자·선행 점 제거(보안 불변식 3). */
export function sanitizeFilename(name: string): string {
  if (typeof name !== 'string') {
    throw new PathSafetyError('filename is not a string');
  }

  // 브라우저·프록시에 따라 `webkitRelativePath` 형태로 디렉터리가 섞여 들어온다.
  // 경로 성분은 전부 버리고 마지막 성분만 남긴다.
  let result = name.normalize('NFC').replace(/\\/g, '/');
  result = result.slice(result.lastIndexOf('/') + 1);

  // 인코딩된 구분자가 파일명 안에 숨어 있을 수 있으므로 한 번 풀어본다.
  try {
    result = decodeURIComponent(result);
  } catch {
    // 깨진 인코딩이면 원본을 그대로 정제한다.
  }
  result = result.replace(/\\/g, '/');
  result = result.slice(result.lastIndexOf('/') + 1);

  result = result
    // 제어문자 제거
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // 파일시스템·셸에서 의미를 갖는 문자 치환
    .replace(/[<>:"|?*]/g, '_')
    // 공백류 정리
    .replace(/\s+/g, ' ')
    .trim();

  // 선행 점 제거 — 숨김 파일(`.env`) 생성과 `..` 형태를 동시에 막는다.
  result = result.replace(/^\.+/, '');
  // 후행 점·공백 제거 (`foo.` 같은 이름은 플랫폼별 처리가 갈린다)
  result = result.replace(/[.\s]+$/, '');

  if (result === '') {
    throw new PathSafetyError('filename is empty after sanitization');
  }

  // 길이 제한: 확장자를 보존하면서 base만 자른다.
  if (Buffer.byteLength(result, 'utf8') > MAX_FILENAME_BYTES) {
    const ext = path.extname(result);
    let base = result.slice(0, result.length - ext.length);
    while (Buffer.byteLength(base + ext, 'utf8') > MAX_FILENAME_BYTES && base.length > 0) {
      base = base.slice(0, -1);
    }
    if (base === '') {
      throw new PathSafetyError('filename too long');
    }
    result = base + ext;
  }

  return result;
}

/**
 * 업로드 대상 폴더 경로의 각 세그먼트를 정규화한다 — Windows 한글 깨짐 방지.
 *
 * Windows에서 전송된 폴더명은 NFC/NFD가 불일치하거나, 브라우저·프록시 경유 시
 * 인코딩이 깨질 수 있다. 각 세그먼트를:
 *   1. NFC 정규화
 *   2. 제어문자 제거
 *   3. 파일시스템 위험 문자 치환
 *   4. U+FFFD(replacement character) 제거 — 이미 깨진 바이트의 잔재
 *   5. 선행/후행 점·공백 정리
 *
 * `resolveUnderRoot`를 통과한 뒤, mkdir 직전에 호출한다.
 */
export function sanitizeFolderPath(rawPath: string): string {
  if (typeof rawPath !== 'string') {
    throw new PathSafetyError('folder path is not a string');
  }

  const normalized = rawPath.normalize('NFC');
  const segments = normalized.split('/').filter((s) => s.length > 0);

  const sanitized = segments.map((seg) => {
    let s = seg
      // 제어문자 제거
      .replace(/[\u0000-\u001f\u007f]/g, '')
      // U+FFFD (replacement character) 제거 — 인코딩 실패의 잔재
      .replace(/\uFFFD/g, '')
      // 파일시스템·셸 위험 문자 치환
      .replace(/[<>:"|?*\\]/g, '_')
      // 공백류 정리
      .replace(/\s+/g, ' ')
      .trim();

    // 선행 점 제거 (숨김 폴더 방지)
    s = s.replace(/^\.+/, '');
    // 후행 점·공백 제거
    s = s.replace(/[.\s]+$/, '');

    return s;
  });

  // 빈 세그먼트 제거 (sanitize 후 빈 문자열이 된 경우)
  const result = sanitized.filter((s) => s.length > 0).join('/');
  return result;
}
