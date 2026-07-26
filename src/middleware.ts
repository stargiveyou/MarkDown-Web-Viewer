/**
 * 인증 미들웨어 — 보안 불변식 1.
 *
 * **모든** 페이지와 `/api` 라우트를 세션으로 보호한다.
 * 예외는 단 두 가지다:
 *   1. `/login` 페이지
 *   2. `POST /api/auth/login`   ← 메서드까지 일치해야 한다. `GET /api/auth/login`은 보호 대상이다.
 *
 * 미인증 처리:
 *   - `/api/*`  → 401 + `ApiError` JSON (프론트 `fetcher`가 이 형태를 기대한다)
 *   - 그 외 페이지 → `/login?next=<원래경로>` 리다이렉트
 *
 * ## 런타임
 * `export const runtime = 'nodejs'`가 **필수**다.
 * 세션 검증이 `node:crypto`의 `createHmac`/`timingSafeEqual`을 쓰고,
 * `getServerEnv()`가 `process.env`를 읽기 때문이다(Edge 런타임에서는 둘 다 불가).
 * Next 16은 middleware의 Node 런타임을 정식 지원한다.
 *
 * 담당: security-auth / Stage 1
 */

import { NextResponse, type NextRequest } from 'next/server';

import type { ApiError } from '@/types/api';
import { SESSION_COOKIE, verifySessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

/** 로그인 페이지 경로. 무인증 접근을 허용하는 유일한 페이지. */
const LOGIN_PAGE = '/login';

/** 무인증 API — 메서드까지 일치해야 통과한다. */
const PUBLIC_API: ReadonlyArray<{ method: string; pathname: string }> = [
  { method: 'POST', pathname: '/api/auth/login' },
];

/** 상태를 바꾸는 메서드. CSRF 방어(Origin 확인) 대상이다. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 모든 응답에 얹는 최소 보안 헤더.
 * 인터넷에 노출되는 앱이므로 기본값에 기대지 않는다.
 */
function withSecurityHeaders<T extends NextResponse>(response: T): T {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

/** `ApiError` 형태의 JSON 응답. 내부 정보를 담지 않는다(보안 불변식 8). */
function apiError(code: ApiError['code'], message: string): NextResponse {
  const body: ApiError = { code, message };
  return withSecurityHeaders(NextResponse.json(body, { status: code }));
}

function isPublicApi(request: NextRequest, pathname: string): boolean {
  return PUBLIC_API.some(
    (entry) => entry.pathname === pathname && entry.method === request.method,
  );
}

/**
 * 동일 출처 확인 — CSRF 2차 방어.
 *
 * 1차 방어는 쿠키의 `SameSite=Lax`다(크로스 사이트 POST에는 쿠키가 실리지 않는다).
 * 여기서는 `Origin` 헤더가 **있는데 호스트가 다른** 경우만 거부한다.
 * 헤더가 없는 요청(curl 등 비브라우저)은 통과시킨다 — 브라우저가 아니면 CSRF가 성립하지 않고,
 * 검증 에이전트의 curl 재현 절차를 막지 않기 위해서다.
 */
function isCrossSiteRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const host = request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host !== host;
  } catch {
    // Origin이 URL로 파싱되지 않으면 정상 브라우저가 아니다.
    return true;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname === '/api' || pathname.startsWith('/api/');

  // --- 1. 무인증 허용 경로 ---------------------------------------------------
  if (pathname === LOGIN_PAGE) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (isPublicApi(request, pathname)) {
    if (isCrossSiteRequest(request)) {
      return apiError(400, 'Cross-site request rejected.');
    }
    return withSecurityHeaders(NextResponse.next());
  }

  // --- 2. 세션 검증 ----------------------------------------------------------
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifySessionCookie(token);

  if (!authenticated) {
    if (isApi) {
      return apiError(401, 'Authentication required.');
    }

    const redirect = request.nextUrl.clone();
    redirect.pathname = LOGIN_PAGE;
    redirect.search = '';
    // 로그인 후 원래 가려던 곳으로 돌려보낸다.
    // 프론트의 `safeNext()`가 이 값을 한 번 더 검사한다(오픈 리다이렉트 방어).
    redirect.searchParams.set('next', `${pathname}${search}`);

    const response = NextResponse.redirect(redirect);
    // 만료·위조 쿠키가 남아 매 요청 검증 비용을 물지 않도록 정리한다.
    if (token !== undefined) {
      response.cookies.delete(SESSION_COOKIE);
    }
    return withSecurityHeaders(response);
  }

  // --- 3. 인증된 요청의 CSRF 확인 --------------------------------------------
  if (UNSAFE_METHODS.has(request.method) && isCrossSiteRequest(request)) {
    return isApi
      ? apiError(400, 'Cross-site request rejected.')
      : withSecurityHeaders(new NextResponse(null, { status: 400 }));
  }

  return withSecurityHeaders(NextResponse.next());
}

/**
 * 매처 — **기본은 전부 보호**, 정적 자산만 제외한다.
 *
 * 제외 대상:
 *   - `_next/static`, `_next/image` : 빌드 산출물. 시크릿이 없고 미들웨어를 태우면 느려진다.
 *   - `monaco/` : self-host한 Monaco 에디터 정적 자산(public/monaco/vs). 공개 라이브러리라 시크릿이 없다.
 *   - `favicon.ico` / `*.svg|png|...` : public/ 정적 파일
 *
 * 주의:
 *   - `/api/thumbnail`은 이미지를 반환하지만 **경로에 확장자가 없으므로** 아래 패턴에 걸리지 않는다.
 *     즉 썸네일은 계속 보호된다(원본 파일이 인증 없이 새어 나가면 안 되므로 의도된 동작이다).
 *   - 사용자 콘텐츠는 전부 `/api/*`를 통해서만 나가고 `public/`에 두지 않는다.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|monaco/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff|woff2)$).*)',
  ],
};
