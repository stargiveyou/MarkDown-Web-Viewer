/**
 * `GET /api/download?path=<subpath>` — 파일 또는 폴더를 다운로드한다.
 *
 * - 파일: 바이너리 그대로 + `Content-Disposition: attachment`
 * - 폴더: `archiver`로 ZIP 스트리밍 + `Content-Disposition: attachment; filename="폴더명.zip"`
 *
 * 보안 불변식 2·7·8이 적용된다.
 */

import { ZipArchive } from 'archiver';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
} from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** 다운로드 rate limit: 분당 30회. */
const DOWNLOAD_RATE_LIMIT = { max: 30, windowSec: 60 };

/** ZIP에서 제외할 숨김 디렉터리/파일. */
const EXCLUDED_NAMES = new Set(['.mdws', '.thumbcache', '.DS_Store', '.gitkeep']);

/** 확장자 → Content-Type 매핑. */
const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * RFC 5987 인코딩으로 파일명을 안전하게 헤더에 실는다.
 * 한글·특수문자가 포함되어도 깨지지 않는다.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/%20/g, ' ');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 재귀적으로 폴더 내 파일을 수집한다. 각 파일의 경로 안전성을 검증한다. */
async function collectFiles(
  dirPath: string,
  baseDir: string,
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const results: Array<{ absolutePath: string; relativePath: string }> = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;

    const absolutePath = path.join(dirPath, entry.name);

    // 심볼릭 링크 탈출 차단 (보안 불변식 2)
    await assertRealPathUnderRoot(absolutePath);

    const relativePath = path.relative(baseDir, absolutePath);

    if (entry.isDirectory()) {
      const nested = await collectFiles(absolutePath, baseDir);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push({ absolutePath, relativePath });
    }
  }

  return results;
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  // --- rate limit (보안 불변식 7) ---
  const limit = checkRateLimit(rateLimitKeyFor(request, 'download'), DOWNLOAD_RATE_LIMIT);
  if (!limit.allowed) {
    return apiError(429, 'Too many downloads. Try again shortly.', {
      'Retry-After': String(limit.retryAfterSec),
    });
  }

  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path');

  if (!userPath || userPath.trim() === '') {
    return apiError(400, 'Path is required.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'File not found.');
    }

    // --- 파일 다운로드 ---
    if (stat.isFile()) {
      const data = await fs.readFile(absolutePath);
      const ext = path.extname(absolutePath).slice(1).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const filename = path.basename(absolutePath);

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': contentDisposition(filename),
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-cache',
        },
      });
    }

    // --- 폴더 ZIP 다운로드 ---
    if (stat.isDirectory()) {
      const files = await collectFiles(absolutePath, absolutePath);

      if (files.length === 0) {
        return apiError(400, 'Folder is empty.');
      }

      const folderName = path.basename(absolutePath);
      const archive = new ZipArchive({ zlib: { level: 6 } });

      for (const file of files) {
        archive.file(file.absolutePath, { name: file.relativePath });
      }

      // archiver → Node Readable → Web ReadableStream
      const nodeStream = archive as unknown as Readable;

      const webStream = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          nodeStream.on('end', () => {
            controller.close();
          });
          nodeStream.on('error', (err) => {
            controller.error(err);
          });
        },
        cancel() {
          archive.abort();
        },
      });

      // finalize를 호출해야 실제 압축이 시작된다.
      archive.finalize();

      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': contentDisposition(`${folderName}.zip`),
          'Cache-Control': 'no-cache',
        },
      });
    }

    return apiError(400, 'Not a file or directory.');
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[download] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('download', error);
  }
}
