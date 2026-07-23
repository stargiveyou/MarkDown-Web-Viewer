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
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현 + 유닛 테스트
 */

import 'server-only';

/** 경로 검증 실패. 라우트 핸들러는 이를 400으로 변환한다(내부 경로를 노출하지 않는다). */
export class PathSafetyError extends Error {
  constructor(reason: string) {
    super(`unsafe path: ${reason}`);
    this.name = 'PathSafetyError';
  }
}

/**
 * MARKDOWN_ROOT 기준 상대 경로를 검증된 절대 경로로 변환한다.
 *
 * @param userPath 클라이언트가 보낸 상대 경로 (`subpath`, `path`, `filePath`, `targetPath`)
 * @returns MARKDOWN_ROOT 하위임이 보장된 절대 경로
 * @throws {PathSafetyError} 루트를 벗어나거나 형식이 부적절한 경우
 */
export function resolveUnderRoot(userPath: string): string {
  throw new Error('NOT_IMPLEMENTED: resolveUnderRoot — Stage 1 / security-auth');
}

/**
 * 심볼릭 링크까지 해석해 실제 대상이 루트 안에 있는지 확인한다.
 * 이미 존재하는 파일을 읽거나 덮어쓸 때 사용한다.
 * (`resolveUnderRoot`는 문자열 수준, 이 함수는 파일시스템 수준 검증이다.)
 */
export async function assertRealPathUnderRoot(absolutePath: string): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: assertRealPathUnderRoot — Stage 1 / security-auth');
}

/**
 * 절대 경로를 클라이언트에 노출 가능한 상대 경로로 되돌린다.
 * 응답에 서버 파일시스템 구조를 흘리지 않기 위한 역변환이다(보안 불변식 8).
 */
export function toSubpath(absolutePath: string): string {
  throw new Error('NOT_IMPLEMENTED: toSubpath — Stage 1 / security-auth');
}

/** 업로드 파일명 새니타이즈 — 경로 구분자·제어문자·선행 점 제거(보안 불변식 3). */
export function sanitizeFilename(name: string): string {
  throw new Error('NOT_IMPLEMENTED: sanitizeFilename — Stage 1 / security-auth');
}
