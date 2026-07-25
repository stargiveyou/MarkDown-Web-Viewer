/**
 * `GET /api/thumbnail` -- sharp로 이미지를 리사이즈해 webp 썸네일을 반환한다.
 *
 * 디스크 캐시 전략:
 *   - 캐시 디렉터리: `MARKDOWN_ROOT/.thumbcache/`
 *   - 캐시 키: `sha256(subpath + ':' + mtime + ':' + w).hex + '.webp'`
 *   - 원본 파일의 mtime이 바뀌면 캐시 미스가 발생해 새로 생성된다.
 *
 * 보안 불변식 2, 8이 적용된다.
 *
 * 담당: backend-dev / Stage 2
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { apiError, internalError } from '@/lib/api-response';
import { getServerEnv } from '@/lib/env';
import { isThumbnailable } from '@/lib/file-utils';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';

export const runtime = 'nodejs';

/** 최대 허용 폭(px). */
const MAX_WIDTH = 1200;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path');
  const wParam = searchParams.get('w');

  // --- 필수 파라미터 검증 ---
  if (!userPath || userPath.trim() === '') {
    return apiError(400, 'Path is required.');
  }

  if (!wParam) {
    return apiError(400, 'Width (w) is required.');
  }

  const w = Number(wParam);
  if (!Number.isInteger(w) || w < 1 || w > MAX_WIDTH) {
    return apiError(400, `Width must be an integer between 1 and ${MAX_WIDTH}.`);
  }

  // --- 썸네일 가능 여부 ---
  if (!isThumbnailable(userPath)) {
    return apiError(400, 'Not a thumbnailable file.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    // 파일 존재 + stat 확인
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'File not found.');
    }

    if (stat.isDirectory()) {
      return apiError(400, 'Not a file.');
    }

    const mtime = Math.round(stat.mtimeMs);
    const subpath = toSubpath(absolutePath);

    // --- 디스크 캐시 ---
    const env = getServerEnv();
    const cacheDir = path.join(env.MARKDOWN_ROOT, '.thumbcache');
    const cacheKey =
      createHash('sha256')
        .update(`${subpath}:${mtime}:${w}`)
        .digest('hex') + '.webp';
    const cachePath = path.join(cacheDir, cacheKey);

    // 캐시 히트 확인
    try {
      const cached = await fs.readFile(cachePath);
      return new NextResponse(new Uint8Array(cached), {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      });
    } catch {
      // 캐시 미스 -- 아래에서 생성한다
    }

    // --- sharp 리사이즈 ---
    let buffer: Buffer;
    try {
      buffer = await sharp(absolutePath)
        .resize(w, null, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (sharpError) {
      return internalError('thumbnail', sharpError);
    }

    // --- 캐시에 저장 ---
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachePath, buffer);
    } catch (cacheWriteError) {
      // 캐시 저장 실패는 응답에 영향을 주지 않는다. 서버 로깅만.
      console.error('[thumbnail] cache write failed:', cacheWriteError);
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[thumbnail] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('thumbnail', error);
  }
}
