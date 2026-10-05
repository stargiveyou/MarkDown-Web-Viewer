/**
 * `GET /api/graph?path=&depth=&tags=` — 문서 링크 그래프.
 *
 *   - `path` 없음 → 전체 그래프 (노드 상한 `GRAPH_MAX_NODES`, 넘으면 `truncated: true`)
 *   - `path` 있음 → 그 문서 중심 로컬 그래프, `depth` 1~3 (기본 1)
 *   - `tags=1`   → frontmatter 태그를 노드로 포함
 *
 * 응답: `GraphResponse`. 색인만 읽는다(ADR-007).
 * 보안: 세션 보호(middleware), `path`는 경로 안전 유틸 경유(불변식 2), 내부 오류 비노출(불변식 8).
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { GRAPH_MAX_DEPTH, getGraph } from '@/lib/link-graph';
import { PathSafetyError, resolveUnderRoot, toSubpath } from '@/lib/path-safety';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const rawPath = params.get('path');
  const rawDepth = params.get('depth');

  let center: string | undefined;
  if (rawPath) {
    try {
      center = toSubpath(resolveUnderRoot(rawPath));
    } catch (error) {
      if (error instanceof PathSafetyError) return apiError(400, 'Invalid path.');
      return internalError('graph', error);
    }
  }

  let depth = 1;
  if (rawDepth !== null) {
    depth = Number(rawDepth);
    if (!Number.isInteger(depth) || depth < 1 || depth > GRAPH_MAX_DEPTH) {
      return apiError(400, `depth must be an integer between 1 and ${GRAPH_MAX_DEPTH}.`);
    }
  }

  try {
    return NextResponse.json(
      getGraph({ center, depth, includeTags: params.get('tags') === '1' }),
    );
  } catch (error) {
    return internalError('graph', error);
  }
}
