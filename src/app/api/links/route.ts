/**
 * `GET /api/links?path=` — 문서 하나의 나가는 링크와 백링크.
 *
 * 응답: `LinksResponse`
 *
 * 보안:
 *   1. 세션 보호 — middleware.
 *   2. `path`는 경로 안전 유틸(`resolveUnderRoot`)을 경유해 검증한다. 이 라우트는 파일을 읽지 않고
 *      색인만 조회하지만, 모든 `path` 파라미터는 같은 관문을 지난다는 불변식을 지킨다.
 *   8. 내부 오류는 서버 로그에만.
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { getLinksFor } from '@/lib/link-graph';
import { PathSafetyError, resolveUnderRoot, toSubpath } from '@/lib/path-safety';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const raw = new URL(request.url).searchParams.get('path');
  if (!raw) return apiError(400, 'path is required.');

  let subpath: string;
  try {
    subpath = toSubpath(resolveUnderRoot(raw));
  } catch (error) {
    if (error instanceof PathSafetyError) return apiError(400, 'Invalid path.');
    return internalError('links', error);
  }

  try {
    return NextResponse.json(getLinksFor(subpath));
  } catch (error) {
    return internalError('links', error);
  }
}
