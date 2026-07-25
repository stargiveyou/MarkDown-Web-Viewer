/**
 * `POST /api/share/notify` -- 파일 공유 알림을 Discord/Slack Webhook으로 전송한다.
 *
 * 보안 불변식 적용:
 *   1. 세션 보호 -- middleware가 처리한다.
 *   2. 경로 검증 -- `resolveUnderRoot` + `assertRealPathUnderRoot` 2단 방어.
 *   6. 시크릿 비노출 -- Webhook URL을 응답·로그에 포함하지 않는다.
 *   7. Rate limit -- `RATE_LIMIT_POLICY.shareNotify` (60초/10회).
 *   8. 내부 정보 비노출 -- 에러 응답에 절대 경로/스택트레이스/Webhook URL 포함 금지.
 *
 * 에러 코드:
 *   400 -- target 유효하지 않음, filePath 미지정/검증 실패/파일 미존재, webhook URL 미설정
 *   401 -- 미인증 (middleware)
 *   429 -- rate limit 초과
 *   500 -- 내부 오류 (파일 메타 읽기 실패 등)
 *   502 -- webhook 전달 실패 (네트워크 오류, 비2xx 응답, 타임아웃)
 *
 * 담당: backend-dev / Stage 4
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor, RATE_LIMIT_POLICY } from '@/lib/rate-limit';
import { sendWebhook, type WebhookPayload } from '@/lib/webhook';
import type { ShareNotifyRequest, ShareNotifyResponse, ShareTarget } from '@/types/api';

export const runtime = 'nodejs';

const VALID_TARGETS = new Set<ShareTarget>(['discord', 'slack']);

/**
 * `x-forwarded-proto` 헤더를 안전한 값으로 제한한다 (backlog P1-20).
 * 'http' 또는 'https'만 허용하며, 그 외(`javascript:` 등)는 'https'로 대체한다.
 */
function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}

export async function POST(request: Request): Promise<NextResponse> {
  // --- 1. Rate limit (보안 불변식 7) ------------------------------------------
  const rlKey = rateLimitKeyFor(request, 'share');
  const rl = checkRateLimit(rlKey, RATE_LIMIT_POLICY.shareNotify);
  if (!rl.allowed) {
    return apiError(429, 'Too many requests. Please try again later.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }

  // --- 2. 요청 파싱 -----------------------------------------------------------
  let body: ShareNotifyRequest;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { target, filePath } = body;

  // --- 3. target 검증 ---------------------------------------------------------
  if (!target || !VALID_TARGETS.has(target as ShareTarget)) {
    return apiError(400, 'Invalid target. Must be "discord" or "slack".');
  }

  // --- 4. filePath 검증 -------------------------------------------------------
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return apiError(400, 'filePath is required.');
  }

  // --- 5. 경로 안전 검증 (보안 불변식 2) ---------------------------------------
  let absolutePath: string;
  try {
    absolutePath = resolveUnderRoot(filePath.trim());
    await assertRealPathUnderRoot(absolutePath);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[share/notify] path rejected:', error.message);
    }
    return apiError(400, 'Invalid file path.');
  }

  // --- 6. 파일 존재 확인 + 메타 정보 ------------------------------------------
  let mtime: number;
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return apiError(400, 'Path is not a file.');
    }
    mtime = Math.round(stat.mtimeMs);
  } catch {
    return apiError(400, 'File not found.');
  }

  // --- 7. 앱 URL 구성 (D4-2) -------------------------------------------------
  const proto = sanitizeProto(request.headers.get('x-forwarded-proto'));
  const host = request.headers.get('host') || 'localhost:3000';
  const subpath = toSubpath(absolutePath);
  const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`;

  // --- 8. Webhook 호출 -------------------------------------------------------
  const fileName = path.basename(subpath);
  const payload: WebhookPayload = { fileName, filePath: subpath, appUrl, mtime };

  try {
    const result = await sendWebhook(target, payload);

    if (!result.ok) {
      // Webhook URL을 로그에 포함하지 않는다(보안 불변식 6).
      // result.error에도 URL이 포함되지 않도록 webhook.ts에서 보장한다.
      console.error(`[share/notify] ${target} webhook failed:`, result.error);

      // URL 미설정 vs 전달 실패 구분
      if (result.error?.includes('not configured')) {
        return apiError(400, `${target} webhook URL is not configured.`);
      }
      return apiError(502, 'Webhook delivery failed. Please try again.');
    }

    const response: ShareNotifyResponse = { ok: true, target };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('share/notify', error);
  }
}
