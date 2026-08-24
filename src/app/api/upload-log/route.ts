/**
 * `GET /api/upload-log?limit=` — 서버에 기록된 최근 업로드 이력을 돌려준다.
 *
 * 웹 UI 업로드와 API 직접 호출(curl 등)이 같은 테이블에 쌓이므로,
 * 어느 경로로 올렸든 Upload Log 패널에 동일하게 나타난다.
 *
 * 세션 보호는 미들웨어가 처리한다(보안 불변식 1).
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { listUploads, type UploadCursor } from '@/lib/upload-history';
import type { UploadLogResponse } from '@/types/api';

export const runtime = 'nodejs';

/** 기본 조회 건수 — 우측 패널이 보여 주는 최근 목록 크기. */
const DEFAULT_LIMIT = 30;

/** 한 번에 가져갈 수 있는 최대 건수 (날짜별 이력 탭 용도). */
const MAX_LIMIT = 500;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return apiError(400, `limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    limit = parsed;
  }

  // 이어 읽기 커서 — 날짜별 이력 탭의 "더 보기"가 쓴다.
  // 한 요청으로 기록된 배치는 `at`이 같으므로 id까지 받아야 경계에서 누락되지 않는다.
  const beforeAtParam = searchParams.get('beforeAt');
  const beforeIdParam = searchParams.get('beforeId');
  let before: UploadCursor | undefined;

  if (beforeAtParam !== null || beforeIdParam !== null) {
    const at = Number(beforeAtParam);
    const id = Number(beforeIdParam);
    if (!Number.isInteger(at) || at < 0 || !Number.isInteger(id) || id < 0) {
      return apiError(400, 'beforeAt and beforeId must both be non-negative integers.');
    }
    before = { at, id: String(id) };
  }

  try {
    const body: UploadLogResponse = { entries: listUploads(limit, before) };
    return NextResponse.json(body, {
      // 항상 최신 상태여야 한다(다른 클라이언트가 올린 파일을 바로 보여 준다).
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return internalError('upload-log', error);
  }
}
