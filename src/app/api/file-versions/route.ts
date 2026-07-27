/**
 * `GET /api/file-versions?path=` — 특정 파일의 이전 버전 목록을 반환한다.
 *
 * 같은 폴더에서 `파일명_YYYYMMDD-HHmmss.ext` 패턴에 매칭되는 파일들을
 * 이전 버전으로 인식하고, 최신순으로 정렬하여 반환한다.
 *
 * 보안 불변식 2, 8이 적용된다.
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
import type { FileVersion, FileVersionsResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path') ?? '';

  if (!filePath) {
    return apiError(400, 'path is required.');
  }

  try {
    const absPath = resolveUnderRoot(filePath);
    await assertRealPathUnderRoot(absPath);

    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      return apiError(400, 'Not a file.');
    }

    const dir = path.dirname(absPath);
    const fileName = path.basename(absPath);
    const ext = path.extname(fileName);
    const base = fileName.slice(0, fileName.length - ext.length);

    // 현재 파일 정보
    const current: FileVersion = {
      name: fileName,
      subpath: toSubpath(absPath),
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
    };

    // 같은 폴더에서 `base_YYYYMMDD-HHmmss.ext` 패턴 검색
    const versionPattern = new RegExp(
      `^${escapeRegExp(base)}_(\\d{8}-\\d{6})${escapeRegExp(ext)}$`,
    );

    const entries = await fs.readdir(dir);
    const versions: FileVersion[] = [];

    for (const entry of entries) {
      if (!versionPattern.test(entry)) continue;

      const entryPath = path.join(dir, entry);
      try {
        const entryStat = await fs.stat(entryPath);
        if (!entryStat.isFile()) continue;

        versions.push({
          name: entry,
          subpath: toSubpath(entryPath),
          size: entryStat.size,
          mtime: Math.round(entryStat.mtimeMs),
        });
      } catch {
        // stat 실패 시 건너뜀
      }
    }

    // 최신순 정렬
    versions.sort((a, b) => b.mtime - a.mtime);

    const body: FileVersionsResponse = { current, versions };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      return apiError(400, 'Invalid path.');
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiError(400, 'File not found.');
    }
    return internalError('file-versions', error);
  }
}

/** 정규식 특수문자 이스케이프 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
