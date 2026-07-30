/**
 * `POST /api/mark-read` — 파일을 "읽음"으로 표시한다.
 *
 * 요청 바디: `{ path: string }`
 *   - `path`: MARKDOWN_ROOT 기준 상대 경로.
 *
 * 파일의 현재 mtime을 read_at으로 저장하여,
 * 이후 업데이트가 없으면 unread 배지가 사라진다.
 *
 * 보안 불변식 2·8이 적용된다.
 */

import fs from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';
import { markAsRead } from '@/lib/read-tracker';
import type { MarkReadRequest, MarkReadResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { path: userPath } = (body ?? {}) as Partial<MarkReadRequest>;

  if (typeof userPath !== 'string' || userPath.trim() === '') {
    return apiError(400, 'path is required.');
  }

  try {
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'File not found.');
    }

    const subpath = toSubpath(absolutePath);
    const mtime = Math.round(stat.mtimeMs);

    markAsRead(subpath, mtime);

    const response: MarkReadResponse = { ok: true };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[mark-read] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('mark-read', error);
  }
}
