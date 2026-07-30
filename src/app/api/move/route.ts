/**
 * `POST /api/move` — 파일 또는 폴더를 다른 위치로 이동한다.
 *
 * 요청 바디: `{ sourcePath: string, destinationPath: string }`
 *   - `sourcePath`      : 이동할 원본의 MARKDOWN_ROOT 기준 상대 경로.
 *   - `destinationPath` : 이동 대상 부모 폴더의 MARKDOWN_ROOT 기준 상대 경로. 빈 문자열이면 루트.
 *
 * 원본의 이름을 유지한 채 대상 폴더 아래로 이동한다.
 * 같은 파일시스템 내 `fs.rename`으로 원자적 이동이며,
 * 이동 후 검색 색인을 best-effort로 갱신한다.
 *
 * 보안 불변식 2·8이 적용된다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';
import { reindexAfterMove } from '@/lib/search-index';
import type { MoveRequest, MoveResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  // --- 1. 요청 바디 파싱 ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { sourcePath, destinationPath } = (body ?? {}) as Partial<MoveRequest>;

  if (typeof sourcePath !== 'string' || typeof destinationPath !== 'string') {
    return apiError(400, 'sourcePath and destinationPath are required.');
  }

  if (sourcePath.trim() === '') {
    return apiError(400, 'Cannot move root directory.');
  }

  try {
    // --- 2. 원본 경로 검증 (보안 불변식 2) ---
    const absoluteSource = resolveUnderRoot(sourcePath);
    await assertRealPathUnderRoot(absoluteSource);

    // 원본 존재 확인
    let sourceStat;
    try {
      sourceStat = await fs.stat(absoluteSource);
    } catch {
      return apiError(400, 'Source not found.');
    }

    const isDirectory = sourceStat.isDirectory();

    // --- 3. 대상 경로 검증 ---
    const absoluteDestDir = resolveUnderRoot(destinationPath);
    await assertRealPathUnderRoot(absoluteDestDir);

    // 대상이 존재하고 디렉터리인지 확인
    let destStat;
    try {
      destStat = await fs.stat(absoluteDestDir);
    } catch {
      return apiError(400, 'Destination path not found.');
    }
    if (!destStat.isDirectory()) {
      return apiError(400, 'Destination is not a directory.');
    }

    // --- 4. 최종 이동 경로 계산 ---
    const sourceName = path.basename(absoluteSource);
    const destSubpath = toSubpath(absoluteDestDir);
    const newSubpath = destSubpath
      ? `${destSubpath}/${sourceName}`
      : sourceName;
    const absoluteFinalDest = resolveUnderRoot(newSubpath);
    await assertRealPathUnderRoot(absoluteFinalDest);

    // --- 5. 같은 위치 이동 방지 ---
    if (absoluteFinalDest === absoluteSource) {
      return apiError(400, 'Already in this location.');
    }

    // --- 6. 순환 이동 방지 (폴더를 자신의 하위로 이동) ---
    if (isDirectory) {
      const sourceSubpath = toSubpath(absoluteSource);
      if (
        destinationPath === sourceSubpath ||
        destinationPath.startsWith(sourceSubpath + '/')
      ) {
        return apiError(400, 'Cannot move a folder into itself.');
      }
    }

    // --- 7. 대상 위치 충돌 확인 ---
    try {
      await fs.stat(absoluteFinalDest);
      // stat 성공 = 이미 존재
      return apiError(409, 'A file or folder with this name already exists at the destination.');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // ENOENT = 존재하지 않으므로 이동 가능
    }

    // --- 8. 이동 수행 ---
    const oldSubpath = toSubpath(absoluteSource);

    await fs.rename(absoluteSource, absoluteFinalDest);

    // --- 9. 검색 색인 갱신 (best-effort) ---
    const finalSubpath = toSubpath(absoluteFinalDest);
    try {
      await reindexAfterMove(oldSubpath, finalSubpath, isDirectory);
    } catch (indexError) {
      console.error('[move] search index update failed:', indexError);
    }

    const response: MoveResponse = {
      ok: true,
      newSubpath: finalSubpath,
      name: sourceName,
    };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[move] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('move', error);
  }
}
