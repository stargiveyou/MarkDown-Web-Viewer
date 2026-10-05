/**
 * `POST /api/push/test` — **요청한 기기 하나에만** 테스트 알림을 보낸다.
 *
 * 알림 켜기 직후 "실제로 도착하는지" 확인하는 용도다. 다른 기기로는 보내지 않으므로
 * 요청 본문의 endpoint가 이미 등록된 구독이어야 한다.
 *
 * 응답:
 *   200 `{ ok: true }`  — 푸시 서비스가 수락함 (기기 도착은 별개)
 *   400 — 미설정 / endpoint 형식 오류 / 등록되지 않은 endpoint
 *   429 — rate limit (`RATE_LIMIT_POLICY.pushTest`)
 *   502 — 푸시 서비스 전달 실패 (재시도 의미 있음)
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  hasSubscription,
  isAllowedPushEndpoint,
  isPushConfigured,
  sendPush,
} from '@/lib/push';
import { checkRateLimit, rateLimitKeyFor, RATE_LIMIT_POLICY } from '@/lib/rate-limit';
import type { PushOkResponse, PushTestRequest } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const rl = checkRateLimit(rateLimitKeyFor(request, 'push-test'), RATE_LIMIT_POLICY.pushTest);
  if (!rl.allowed) {
    return apiError(429, 'Too many requests. Please try again later.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }

  try {
    if (!isPushConfigured()) return apiError(400, '서버에 푸시 알림이 설정되지 않았습니다.');

    const body = (await request.json().catch(() => null)) as PushTestRequest | null;
    if (!isAllowedPushEndpoint(body?.endpoint) || !hasSubscription(body.endpoint)) {
      return apiError(400, '이 기기는 알림이 등록되어 있지 않습니다.');
    }

    const result = await sendPush(
      {
        title: '🔔 알림이 켜졌습니다',
        body: '새 문서가 업로드되면 이 기기로 알려 드립니다.',
        url: '/workspace',
        tag: 'push-test',
      },
      body.endpoint,
    );

    if (result.sent === 0) {
      return apiError(
        502,
        result.removed > 0
          ? '구독이 만료되었습니다. 알림을 다시 켜 주세요.'
          : '푸시 서비스에 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
    return NextResponse.json({ ok: true } satisfies PushOkResponse);
  } catch (error) {
    return internalError('push/test', error);
  }
}
