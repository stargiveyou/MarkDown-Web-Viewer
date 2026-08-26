/**
 * `GET /api/upload-log` — 서버에 기록된 업로드 이력을 돌려준다.
 *
 * 두 가지 조회 방식이 있다.
 * - `?limit=&beforeAt=&beforeId=` — 최신순 N건 + 이어 읽기 (우측 패널, 날짜별 창)
 * - `?from=&to=` — 기간 조회 (캘린더의 한 달)
 *
 * 웹 UI 업로드와 API 직접 호출(curl 등)이 같은 테이블에 쌓이므로,
 * 어느 경로로 올렸든 같은 목록에 나타난다.
 *
 * 세션 보호는 미들웨어가 처리한다(보안 불변식 1).
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { isMarkdownName } from '@/lib/doc-title';
import { getTitles } from '@/lib/search-index';
import {
  ensureUploadHistoryBackfilled,
  listUploads,
  listUploadsInRange,
  type UploadCursor,
} from '@/lib/upload-history';
import type { UploadHistoryEntry, UploadLogResponse } from '@/types/api';

export const runtime = 'nodejs';

/** 기본 조회 건수 — 우측 패널이 보여 주는 최근 목록 크기. */
const DEFAULT_LIMIT = 30;

/** 한 번에 가져갈 수 있는 최대 건수 (날짜별 이력 탭 용도). */
const MAX_LIMIT = 500;

/** 기간 조회 상한 — 한 번에 훑을 수 있는 길이(약 1년). */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * 마크다운 문서에 제목을 붙인다.
 *
 * 제목은 검색 색인이 이미 갖고 있으므로 파일을 다시 읽지 않고 한 번의 조회로 끝낸다.
 * 이미지 등은 제목 개념이 없어 건드리지 않는다 — 화면은 파일명을 그대로 쓴다.
 */
function withTitles(entries: UploadHistoryEntry[]): UploadHistoryEntry[] {
  const titles = getTitles(
    entries.filter((entry) => isMarkdownName(entry.name)).map((entry) => entry.subpath),
  );

  return entries.map((entry) => {
    const title = isMarkdownName(entry.name) ? titles.get(entry.subpath) : undefined;
    return title ? { ...entry, title } : entry;
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');

  // --- 기간 조회 (캘린더) ---------------------------------------------------
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  if (fromParam !== null || toParam !== null) {
    const from = Number(fromParam);
    const to = Number(toParam);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
      return apiError(400, 'from and to must be integers with from < to.');
    }
    if (to - from > MAX_RANGE_MS) {
      return apiError(400, 'Requested range is too long.');
    }

    try {
      // 이력 기록 이전에 올라간 파일은 여기서 한 번 채운다(완료 후에는 no-op).
      ensureUploadHistoryBackfilled();

      const body: UploadLogResponse = { entries: withTitles(listUploadsInRange(from, to)) };
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return internalError('upload-log', error);
    }
  }

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
    // 날짜별 이력 창도 제목을 보여주므로 최근 목록에도 함께 붙인다.
    const body: UploadLogResponse = { entries: withTitles(listUploads(limit, before)) };
    return NextResponse.json(body, {
      // 항상 최신 상태여야 한다(다른 클라이언트가 올린 파일을 바로 보여 준다).
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return internalError('upload-log', error);
  }
}
