/**
 * 단일 패스워드 세션 — 보안 불변식 1 (ADR-005).
 *
 * `POST /api/auth/login`을 제외한 모든 페이지·API가 이 모듈로 세션을 검증한다.
 * 엣지의 ngrok Basic Auth와 함께 이중 관문을 구성한다.
 *
 * 담당: security-auth / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import 'server-only';

/** 세션 쿠키 이름. 미들웨어·라우트가 같은 상수를 참조한다. */
export const SESSION_COOKIE = 'mdws_session';

/**
 * 입력 패스워드를 `SESSION_PASSWORD` 해시와 **timing-safe**하게 비교한다.
 * 조기 반환(early return)하는 문자열 비교를 쓰지 않는다.
 */
export async function verifyPassword(input: string): Promise<boolean> {
  throw new Error('NOT_IMPLEMENTED: verifyPassword — Stage 1 / security-auth');
}

/**
 * 서명된 세션 쿠키 값을 생성한다.
 * 쿠키 속성: httpOnly, SameSite=Lax, Secure(프로덕션), 합리적 만료.
 */
export async function createSessionCookie(): Promise<string> {
  throw new Error('NOT_IMPLEMENTED: createSessionCookie — Stage 1 / security-auth');
}

/**
 * 쿠키 서명과 만료를 검증한다.
 * 미들웨어와 각 라우트 핸들러가 공통으로 호출한다.
 */
export async function verifySessionCookie(value: string | undefined): Promise<boolean> {
  throw new Error('NOT_IMPLEMENTED: verifySessionCookie — Stage 1 / security-auth');
}
