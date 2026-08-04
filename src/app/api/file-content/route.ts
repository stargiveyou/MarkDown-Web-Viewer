/**
 * `GET /api/file-content` -- 파일 내용을 frontmatter 포함 원본 전체로 반환한다.
 * `PUT /api/file-content` -- 파일을 atomic write로 저장한다 (baseMtime 충돌 감지 포함).
 *
 * 보안 불변식 2, 4, 5, 8이 적용된다.
 *
 * 담당: backend-dev / Stage 2
 */

import { randomBytes } from 'node:crypto';
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
import { indexFile } from '@/lib/search-index';
import type {
  FileContentResponse,
  SaveConflictResponse,
  SaveFileRequest,
  SaveFileResponse,
} from '@/types/api';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/file-content?path=
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path');

  if (!userPath || userPath.trim() === '') {
    return apiError(400, 'Path is required.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    // 존재 확인 + 디렉터리 여부 확인
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'File not found.');
    }

    if (stat.isDirectory()) {
      return apiError(400, 'Not a file.');
    }

    // --- 파일 읽기 ---
    const content = await fs.readFile(absolutePath, 'utf8');
    const mtime = Math.round(stat.mtimeMs);

    const response: FileContentResponse = { content, mtime };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[file-content:GET] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('file-content:GET', error);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/file-content
// ---------------------------------------------------------------------------

export async function PUT(request: Request): Promise<NextResponse> {
  // --- 바디 파싱 ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  // 타입 검증
  if (typeof body !== 'object' || body === null) {
    return apiError(400, 'Invalid request body.');
  }

  const { path: userPath, content, baseMtime } = body as SaveFileRequest;

  if (typeof userPath !== 'string' || userPath.trim() === '') {
    return apiError(400, 'Path is required.');
  }

  if (typeof content !== 'string') {
    return apiError(400, 'Content must be a string.');
  }

  if (typeof baseMtime !== 'number' || !Number.isFinite(baseMtime) || baseMtime <= 0) {
    return apiError(400, 'baseMtime must be a positive number.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    // --- 파일 존재 확인 ---
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'File does not exist.');
    }

    if (stat.isDirectory()) {
      return apiError(400, 'Not a file.');
    }

    // --- 충돌 감지 (보안 불변식 5) ---
    const currentMtime = Math.round(stat.mtimeMs);
    if (currentMtime !== baseMtime) {
      const conflictResponse: SaveConflictResponse = {
        code: 409,
        message: 'File has been modified externally.',
        currentMtime,
      };
      return NextResponse.json(conflictResponse, { status: 409 });
    }

    // --- Atomic write (보안 불변식 4) ---
    const directory = path.dirname(absolutePath);
    const tempPath = path.join(
      directory,
      `.mdws-edit-${randomBytes(12).toString('hex')}.tmp`,
    );

    try {
      // 임시 파일에 기록 + fsync
      const handle = await fs.open(tempPath, 'wx');
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      // 기존 파일이 있으면 버전 백업(Update Log)으로 리네임
      try {
        const existingStat = await fs.stat(absolutePath);
        if (existingStat.isFile()) {
          const fileName = path.basename(absolutePath);
          const ext = path.extname(fileName);
          const base = fileName.slice(0, fileName.length - ext.length);
          const timestamp = formatTimestamp(new Date(existingStat.mtimeMs));
          const backupName = `${base}_${timestamp}${ext}`;
          const backupPath = path.join(directory, backupName);
          await fs.rename(absolutePath, backupPath);
        }
      } catch (err) {
        // ENOENT = 기존 파일이 없는 경우이므로 정상 진행
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      // rename으로 원자적 교체
      await fs.rename(tempPath, absolutePath);
    } catch (writeError) {
      // 실패 시 임시 파일 정리
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw writeError;
    }

    // --- 갱신된 mtime 조회 ---
    const newStat = await fs.stat(absolutePath);
    const newMtime = Math.round(newStat.mtimeMs);

    // 색인 증분 갱신 (실패해도 저장 성공에 영향 없음)
    try {
      const userSubpath = toSubpath(absolutePath);
      // .md 파일만 색인 대상
      if (userSubpath.endsWith('.md') || userSubpath.endsWith('.markdown')) {
        await indexFile(userSubpath);
      }
    } catch (indexError) {
      console.error('[file-content:PUT] index update failed:', indexError);
    }

    const response: SaveFileResponse = { ok: true, mtime: newMtime };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[file-content:PUT] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('file-content:PUT', error);
  }
}

/**
 * 날짜 포맷: `YYYYMMDD-HHmmss` (로컬 시간 기준).
 * 버전 백업 파일명에 사용한다.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
