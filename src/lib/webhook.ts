/**
 * Discord / Slack Webhook 호출 단일 모듈 -- Stage 4 소셜 공유 + Stage 5 업로드 알림 공용.
 *
 * 핵심 원칙:
 *   - **절대 throw하지 않는다.** 모든 실패를 `WebhookResult`로 표현해
 *     호출부가 500(내부)과 502(webhook 전달 실패)를 구분한다.
 *   - Webhook URL을 로그/응답에 절대 포함하지 않는다 (보안 불변식 6).
 *   - 타임아웃: 10초 (`AbortSignal.timeout`).
 *
 * 담당: backend-dev / Stage 4
 */

import 'server-only';

import { getServerEnv } from './env';
import type { ShareTarget } from '@/types/api';

// ---------------------------------------------------------------------------
// 공개 타입
// ---------------------------------------------------------------------------

/** Webhook에 전달할 파일 정보. */
export interface WebhookPayload {
  /** 파일명 (확장자 포함). 예: "여행기.md" */
  fileName: string;
  /** MARKDOWN_ROOT 기준 상대 경로. 예: "2026-Travel/여행기.md" */
  filePath: string;
  /** 앱에서 해당 파일을 열 수 있는 URL. */
  appUrl: string;
  /** 파일 수정일 (epoch ms). */
  mtime: number;
}

export interface WebhookResult {
  ok: boolean;
  /** 실패 시 사유 (서버 로깅용, 응답에 포함 금지). */
  error?: string;
}

// ---------------------------------------------------------------------------
// 페이로드 빌더 (내부)
// ---------------------------------------------------------------------------

/** Discord Embed 페이로드. */
export function buildDiscordPayload(payload: WebhookPayload): object {
  return {
    embeds: [
      {
        title: payload.fileName,
        description: `경로: \`${payload.filePath}\``,
        url: payload.appUrl,
        color: 0x5865f2, // Discord 브랜드 블루퍼플
        timestamp: new Date(payload.mtime).toISOString(),
        footer: {
          text: 'MD Workspace',
        },
      },
    ],
  };
}

/** Slack Block Kit 페이로드. */
export function buildSlackPayload(payload: WebhookPayload): object {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*<${payload.appUrl}|${payload.fileName}>*\n` +
            `경로: \`${payload.filePath}\`\n` +
            `수정일: ${new Date(payload.mtime).toLocaleString('ko-KR')}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':memo: MD Workspace',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Webhook 전송
// ---------------------------------------------------------------------------

/** Webhook POST 타임아웃(ms). */
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Discord/Slack Webhook으로 알림을 전송한다.
 *
 * - Webhook URL은 `getServerEnv()`에서 읽는다.
 * - URL이 미설정이면 `{ ok: false, error: "...not configured" }` 반환 (호출부가 400으로 변환).
 * - 네트워크 오류/비2xx 응답이면 `{ ok: false, error: "..." }` 반환 (호출부가 502로 변환).
 * - 타임아웃: 10초.
 *
 * 절대 throw하지 않는다. 모든 실패는 `WebhookResult.ok = false`로 표현한다.
 */
export async function sendWebhook(
  target: ShareTarget,
  payload: WebhookPayload,
): Promise<WebhookResult> {
  const env = getServerEnv();

  // 1. Webhook URL 존재 확인
  const url = target === 'discord' ? env.DISCORD_WEBHOOK_URL : env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { ok: false, error: `${target} webhook URL is not configured.` };
  }

  // 2. 페이로드 구성
  const body =
    target === 'discord' ? buildDiscordPayload(payload) : buildSlackPayload(payload);

  // 3. Webhook POST
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 서버 로깅 -- 응답 바디는 짧게만 기록. URL은 절대 포함하지 않는다(보안 불변식 6).
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `${target} webhook returned ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    // 네트워크 오류 / 타임아웃
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${target} webhook fetch failed: ${message}` };
  }
}
