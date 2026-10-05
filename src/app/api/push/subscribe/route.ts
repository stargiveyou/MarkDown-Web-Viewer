/**
 * `/api/push/subscribe` — 이 기기의 Web Push 구독 관리.
 *
 *   GET    → `PushConfigResponse` (푸시 사용 가능 여부 + VAPID 공개키)
 *   POST   `{ subscription }` → 구독 저장
 *   DELETE `{ endpoint }`     → 구독 해제 (멱등)
 *
 * 보안:
 *   1. 세션 보호 — middleware가 처리한다(미인증 401).
 *   6. VAPID 개인키는 어떤 응답에도 싣지 않는다. 공개키만 내려준다.
 *   7. Rate limit — `RATE_LIMIT_POLICY.pushSubscribe`.
 *   8. 내부 오류는 서버 로그에만.
 *   + endpoint는 서버가 나중에 POST할 URL이므로 알려진 푸시 서비스 호스트만 받는다(SSRF 방지).
 */

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  getVapidPublicKey,
  isAllowedPushEndpoint,
  isPushConfigured,
  parsePushSubscription,
  removeSubscription,
  saveSubscription,
} from '@/lib/push';
import { checkRateLimit, rateLimitKeyFor, RATE_LIMIT_POLICY } from '@/lib/rate-limit';
import type {
  PushConfigResponse,
  PushOkResponse,
  PushSubscribeRequest,
  PushUnsubscribeRequest,
} from '@/types/api';

export const runtime = 'nodejs';

const NOT_CONFIGURED = '서버에 푸시 알림이 설정되지 않았습니다.';

function rateLimit(request: Request): NextResponse | null {
  const rl = checkRateLimit(rateLimitKeyFor(request, 'push'), RATE_LIMIT_POLICY.pushSubscribe);
  if (rl.allowed) return null;
  return apiError(429, 'Too many requests. Please try again later.', {
    'Retry-After': String(rl.retryAfterSec),
  });
}

export async function GET(): Promise<NextResponse> {
  try {
    const body: PushConfigResponse = {
      enabled: isPushConfigured(),
      publicKey: getVapidPublicKey(),
    };
    return NextResponse.json(body);
  } catch (error) {
    return internalError('push/subscribe GET', error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rateLimit(request);
  if (blocked) return blocked;

  try {
    if (!isPushConfigured()) return apiError(400, NOT_CONFIGURED);

    const body = (await request.json().catch(() => null)) as PushSubscribeRequest | null;
    const record = parsePushSubscription(body?.subscription);
    if (!record) return apiError(400, '올바르지 않은 푸시 구독 정보입니다.');

    saveSubscription(record);
    return NextResponse.json({ ok: true } satisfies PushOkResponse);
  } catch (error) {
    return internalError('push/subscribe POST', error);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const blocked = rateLimit(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => null)) as PushUnsubscribeRequest | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) {
      return apiError(400, '올바르지 않은 endpoint입니다.');
    }

    // VAPID를 나중에 끈 경우에도 남은 구독은 지울 수 있어야 한다.
    removeSubscription(body.endpoint);
    return NextResponse.json({ ok: true } satisfies PushOkResponse);
  } catch (error) {
    return internalError('push/subscribe DELETE', error);
  }
}
