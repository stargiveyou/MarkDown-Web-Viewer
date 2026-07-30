/**
 * `POST /api/folder` — 새 폴더를 생성한다.
 *
 * 요청 바디: `{ parentPath: string, name: string }`
 *   - `parentPath` : 부모 폴더의 MARKDOWN_ROOT 기준 상대 경로. 빈 문자열이면 루트.
 *   - `name`       : 새 폴더 이름 (단일 세그먼트, 경로 구분자 불허).
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
  sanitizeFilename,
  toSubpath,
} from '@/lib/path-safety';
import type { CreateFolderRequest, CreateFolderResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  // --- 1. 요청 바디 파싱 ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { parentPath, name } = (body ?? {}) as Partial<CreateFolderRequest>;

  if (typeof parentPath !== 'string' || typeof name !== 'string') {
    return apiError(400, 'parentPath and name are required.');
  }

  // --- 2. 폴더 이름 검증 ---
  const trimmedName = name.trim();
  if (trimmedName === '') {
    return apiError(400, 'Folder name is required.');
  }

  // 경로 구분자가 포함되면 거부 (단일 세그먼트만 허용)
  if (trimmedName.includes('/') || trimmedName.includes('\\')) {
    return apiError(400, 'Folder name must not contain path separators.');
  }

  // sanitizeFilename으로 이름 정제 (제어문자, 위험문자, 선행 점 제거)
  let safeName: string;
  try {
    safeName = sanitizeFilename(trimmedName);
  } catch {
    return apiError(400, 'Invalid folder name.');
  }

  try {
    // --- 3. 부모 경로 검증 (보안 불변식 2) ---
    const absoluteParent = resolveUnderRoot(parentPath);
    await assertRealPathUnderRoot(absoluteParent);

    // 부모가 존재하고 디렉터리인지 확인
    let parentStat;
    try {
      parentStat = await fs.stat(absoluteParent);
    } catch {
      return apiError(400, 'Parent path not found.');
    }
    if (!parentStat.isDirectory()) {
      return apiError(400, 'Parent path is not a directory.');
    }

    // --- 4. 최종 경로 검증 ---
    const parentSubpath = toSubpath(absoluteParent);
    const newFolderSubpath = parentSubpath
      ? `${parentSubpath}/${safeName}`
      : safeName;
    const absoluteNew = resolveUnderRoot(newFolderSubpath);
    await assertRealPathUnderRoot(absoluteNew);

    // --- 5. 중복 확인 ---
    try {
      await fs.stat(absoluteNew);
      // stat 성공 = 이미 존재
      return apiError(409, 'Folder already exists.');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // ENOENT = 존재하지 않으므로 생성 가능
    }

    // --- 6. 폴더 생성 ---
    await fs.mkdir(absoluteNew);
    // 생성 후 실제 경로가 루트 안에 있는지 한 번 더 확인
    await assertRealPathUnderRoot(absoluteNew);

    const responseSubpath = toSubpath(absoluteNew);
    const response: CreateFolderResponse = {
      ok: true,
      subpath: responseSubpath,
      name: path.basename(absoluteNew),
    };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[folder] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('folder', error);
  }
}
