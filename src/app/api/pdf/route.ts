/**
 * `GET /api/pdf?path=<subpath>` — PDF 원본 바이트를 **inline**으로 내보낸다.
 *
 * `/api/download`와 나눠 둔 이유
 * -----------------------------
 * 다운로드 라우트는 `Content-Disposition: attachment`로 응답한다 — 브라우저가 무조건
 * 파일로 저장하므로 뷰어가 그 URL을 쓸 수 없다. 여기서는 `inline`으로 내보내
 * (1) `/workspace/pdf` 뷰어가 바이트를 받아 pdf.js로 렌더하고,
 * (2) 이 URL을 직접 열면 브라우저 기본 PDF 뷰어로도 볼 수 있게 한다
 *     (iPhone Safari에서 "공유·인쇄"로 넘기는 경로).
 *
 * 프레임에 넣지 않는 이유: 미들웨어가 모든 응답에 `X-Frame-Options: DENY`를 붙이므로
 * `<iframe>`/`<embed>` 삽입은 애초에 차단된다. 뷰어는 fetch로 바이트만 받아 canvas에 그린다.
 *
 * 보안 불변식 2·7·8이 적용된다.
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { isPdf } from '@/lib/file-utils';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
} from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/** 열람 rate limit: 분당 60회. 문서 1건을 열 때 요청 1건이므로 정상 사용을 막지 않는다. */
const PDF_RATE_LIMIT = { max: 60, windowSec: 60 };

/**
 * 서빙 상한(200MB). 상한을 두는 이유는 메모리가 아니라(아래처럼 스트리밍한다)
 * 느린 회선(ngrok)으로 수백 MB를 내려보내며 세션을 묶어 두지 않기 위해서다.
 * 이보다 큰 파일은 `/api/download`로 받아 로컬 뷰어에서 보는 쪽이 빠르다.
 */
const MAX_PDF_BYTES = 200 * 1024 * 1024;

/**
 * RFC 5987 인코딩으로 파일명을 헤더에 실는다. 한글·특수문자가 포함되어도 깨지지 않는다.
 *
 * `/api/download`의 같은 헬퍼와 한 가지가 다르다 — 공백을 `%20`으로 **남겨 둔다**.
 * ext-value에 raw 공백은 문법상 허용되지 않아, 엄격한 파서는 그 지점에서 파라미터를 끊고
 * 파일명을 잘라 버린다. 공백을 그대로 두는 것은 따옴표로 감싼 ASCII 폴백뿐이다.
 */
function inlineDisposition(filename: string): string {
  // 따옴표·역슬래시는 quoted-string을 깨뜨리므로 ASCII 폴백에서 함께 치환한다.
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  // --- rate limit (보안 불변식 7) ---
  const limit = checkRateLimit(rateLimitKeyFor(request, 'pdf'), PDF_RATE_LIMIT);
  if (!limit.allowed) {
    return apiError(429, 'Too many requests. Try again shortly.', {
      'Retry-After': String(limit.retryAfterSec),
    });
  }

  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path');

  if (!userPath || userPath.trim() === '') {
    return apiError(400, 'Path is required.');
  }

  // 확장자 검사가 먼저다 — PDF가 아닌 파일을 이 라우트로 흘려보내지 않는다.
  if (!isPdf(userPath)) {
    return apiError(400, 'Not a PDF file.');
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

    if (!stat.isFile()) {
      return apiError(400, 'Not a file.');
    }

    if (stat.size > MAX_PDF_BYTES) {
      return apiError(413, 'PDF is too large to display. Download it instead.');
    }

    // 스트리밍으로 내보낸다 — 전량을 버퍼에 올리면 큰 문서 몇 건이 동시에 열릴 때
    // 상주 프로세스의 RSS가 그대로 뛴다.
    const nodeStream = createReadStream(absolutePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inlineDisposition(path.basename(absolutePath)),
        'Content-Length': String(stat.size),
        // 인증이 필요한 사용자 문서다. 공용 캐시(ngrok 등 중간 계층)에 남기지 않는다.
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[pdf] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('pdf', error);
  }
}
