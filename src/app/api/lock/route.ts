/**
 * `POST /api/lock` — 파일/폴더에 삭제 Lock을 걸거나 해제한다.
 *
 * 요청 바디: `{ path: string, locked: boolean }`
 *   - `path`   : MARKDOWN_ROOT 기준 상대 경로. 루트 자신은 잠글 수 없다.
 *   - `locked` : true면 잠금, false면 해제.
 *
 * 잠금은 `DELETE /api/files`에서 강제된다 — UI의 버튼 비활성화는 편의일 뿐이고,
 * 실제 거부는 서버가 한다.
 *
 * 보안 불변식 2·8이 적용된다.
 */

import fs from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { setDeleteLock } from '@/lib/delete-lock';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';
import type { LockRequest, LockResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { path: userPath, locked } = (body ?? {}) as Partial<LockRequest>;

  if (typeof userPath !== 'string' || userPath.trim() === '') {
    return apiError(400, 'path is required.');
  }
  if (typeof locked !== 'boolean') {
    return apiError(400, 'locked must be a boolean.');
  }

  try {
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    // 존재하지 않는 경로에 잠금을 남기면 영구히 뜨는 유령 기록이 된다.
    try {
      await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'Path not found.');
    }

    const subpath = toSubpath(absolutePath);
    if (subpath === '') {
      return apiError(400, 'Cannot lock the root directory.');
    }

    setDeleteLock(subpath, locked);

    const response: LockResponse = { ok: true, subpath, locked };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[lock] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('lock', error);
  }
}
