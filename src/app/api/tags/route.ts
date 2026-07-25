/**
 * `GET /api/tags` -- frontmatter 태그 집계.
 *
 * 응답: `TagsResponse` = `{ tags: TagCount[] }`
 *   - 태그는 개수(count) 내림차순 정렬.
 *   - 색인이 미완성이면 빈 배열을 반환한다(에러가 아님).
 *
 * 보안 불변식 8이 적용된다.
 * 인증은 middleware에서 처리된다.
 *
 * 담당: backend-dev / Stage 3
 */

import { NextResponse } from 'next/server';

import { internalError } from '@/lib/api-response';
import { getAllTags } from '@/lib/search-index';
import type { TagsResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const tags = getAllTags();
    const response: TagsResponse = { tags };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('tags', error);
  }
}
