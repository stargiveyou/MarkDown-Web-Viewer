/**
 * `GET /api/search?q=` -- FTS5 MATCH 검색.
 *
 * 쿼리:
 *   - `q` (필수) : 검색어. 2자 이상이어야 한다.
 *
 * 응답: `SearchResponse` = `{ query, results, indexing? }`
 *   - `results`는 BM25 관련도 순.
 *   - `snippet()`에 `SNIPPET_MARK.open/close`를 마커로 사용한다.
 *   - 색인 구축 중이면 `indexing: true`를 포함한다.
 *
 * 보안 불변식 2, 8이 적용된다.
 * 인증은 middleware에서 처리된다.
 *
 * 담당: backend-dev / Stage 3
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { isIndexing, search } from '@/lib/search-index';
import type { SearchResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.trim().length < 2) {
    return apiError(400, 'Search query must be at least 2 characters.');
  }

  try {
    const results = search(q.trim());
    const response: SearchResponse = {
      query: q.trim(),
      results,
      ...(isIndexing() ? { indexing: true } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('search', error);
  }
}
