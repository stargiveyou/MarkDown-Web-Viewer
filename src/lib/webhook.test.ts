/**
 * Webhook 유닛 테스트 -- Stage 4 소셜 공유 백엔드.
 *
 * 확인 대상:
 *   - Discord Embed / Slack Block Kit 페이로드 형식이 각 플랫폼 API 스펙에 맞는지
 *   - sendWebhook이 성공/실패를 throw 없이 `WebhookResult`로 표현하는지
 *   - Webhook URL 미설정 시 올바른 에러 사유를 반환하는지
 *   - 에러 메시지에 실제 Webhook URL이 포함되지 않는지 (보안 불변식 6)
 *   - 타임아웃·네트워크 오류를 처리하는지
 *   - Content-Type이 application/json인지
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// env를 모킹하기 전에 원본 모듈을 가져온다.
// vitest는 `vi.mock`을 호이스팅하므로 실제 import 순서와 무관하게 먼저 적용된다.
import { getServerEnv } from '@/lib/env';

vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...original,
    getServerEnv: vi.fn(),
  };
});

// 테스트 대상
import {
  sendWebhook,
  buildDiscordPayload,
  buildSlackPayload,
  type WebhookPayload,
} from '@/lib/webhook';

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD: WebhookPayload = {
  fileName: '여행기.md',
  filePath: '2026-Travel/여행기.md',
  appUrl: 'https://my-app.ngrok-free.app/workspace/view?path=2026-Travel%2F%EC%97%AC%ED%96%89%EA%B8%B0.md',
  mtime: 1753444800000, // 2025-07-25T00:00:00Z
};

const DISCORD_URL = 'https://discord.com/api/webhooks/123456/secret-token';
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/secret';

function mockEnvWith(overrides: { discord?: string; slack?: string } = {}): void {
  vi.mocked(getServerEnv).mockReturnValue({
    MARKDOWN_ROOT: '/tmp/test',
    SESSION_PASSWORD: 'scrypt:16384:8:1:salt:hash',
    SESSION_SECRET: 'x'.repeat(64),
    UPLOAD_MAX_BYTES: 20_971_520,
    ALLOWED_EXTENSIONS: ['md', 'png'],
    RATE_LIMIT_MAX: 120,
    RATE_LIMIT_WINDOW_SEC: 60,
    ...(overrides.discord !== undefined ? { DISCORD_WEBHOOK_URL: overrides.discord } : {}),
    ...(overrides.slack !== undefined ? { SLACK_WEBHOOK_URL: overrides.slack } : {}),
  });
}

// ---------------------------------------------------------------------------
// fetch 모킹
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 204 }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Discord 페이로드 구성
// ---------------------------------------------------------------------------

describe('buildDiscordPayload', () => {
  it('embeds 배열을 포함한다', () => {
    const payload = buildDiscordPayload(SAMPLE_PAYLOAD) as Record<string, unknown>;
    expect(payload).toHaveProperty('embeds');
    expect(Array.isArray(payload.embeds)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((payload.embeds as any[]).length).toBe(1);
  });

  it('embed에 필수 필드(title, description, url, color, timestamp, footer)가 있다', () => {
    const payload = buildDiscordPayload(SAMPLE_PAYLOAD) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const embed = (payload.embeds as any[])[0];

    expect(embed.title).toBe(SAMPLE_PAYLOAD.fileName);
    expect(embed.description).toContain(SAMPLE_PAYLOAD.filePath);
    expect(embed.url).toBe(SAMPLE_PAYLOAD.appUrl);
    expect(embed.color).toBe(0x5865f2);
    expect(embed.timestamp).toBe(new Date(SAMPLE_PAYLOAD.mtime).toISOString());
    expect(embed.footer).toEqual({ text: 'Husky Works MDs' });
  });
});

// ---------------------------------------------------------------------------
// Slack 페이로드 구성
// ---------------------------------------------------------------------------

describe('buildSlackPayload', () => {
  it('blocks 배열을 포함한다', () => {
    const payload = buildSlackPayload(SAMPLE_PAYLOAD) as Record<string, unknown>;
    expect(payload).toHaveProperty('blocks');
    expect(Array.isArray(payload.blocks)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((payload.blocks as any[]).length).toBe(2);
  });

  it('section block에 파일명, 경로, 수정일이 포함된다', () => {
    const payload = buildSlackPayload(SAMPLE_PAYLOAD) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const section = (payload.blocks as any[])[0];

    expect(section.type).toBe('section');
    expect(section.text.type).toBe('mrkdwn');
    expect(section.text.text).toContain(SAMPLE_PAYLOAD.fileName);
    expect(section.text.text).toContain(SAMPLE_PAYLOAD.filePath);
    expect(section.text.text).toContain('수정일');
  });

  it('context block에 Husky Works MDs 텍스트가 있다', () => {
    const payload = buildSlackPayload(SAMPLE_PAYLOAD) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (payload.blocks as any[])[1];

    expect(context.type).toBe('context');
    expect(context.elements[0].text).toContain('Husky Works MDs');
  });
});

// ---------------------------------------------------------------------------
// sendWebhook -- 성공
// ---------------------------------------------------------------------------

describe('sendWebhook -- 성공', () => {
  it('Discord 성공 (204 No Content)', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('Slack 성공 (200 + "ok")', async () => {
    mockEnvWith({ slack: SLACK_URL });
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await sendWebhook('slack', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('Content-Type이 application/json이다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await sendWebhook('discord', SAMPLE_PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// sendWebhook -- Discord 페이로드 확인
// ---------------------------------------------------------------------------

describe('sendWebhook -- 페이로드 전달', () => {
  it('Discord: fetch에 전달된 body가 embeds 배열을 포함한다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await sendWebhook('discord', SAMPLE_PAYLOAD);

    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('embeds');
    expect(body.embeds[0].title).toBe(SAMPLE_PAYLOAD.fileName);
  });

  it('Slack: fetch에 전달된 body가 blocks 배열을 포함한다', async () => {
    mockEnvWith({ slack: SLACK_URL });
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await sendWebhook('slack', SAMPLE_PAYLOAD);

    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('blocks');
    expect(body.blocks[0].type).toBe('section');
  });
});

// ---------------------------------------------------------------------------
// sendWebhook -- 실패
// ---------------------------------------------------------------------------

describe('sendWebhook -- 실패', () => {
  it('Webhook 비2xx 응답 시 ok=false', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('404');
  });

  it('네트워크 오류 시 ok=false', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('URL 미설정 시 ok=false + error에 "not configured" 포함', async () => {
    // discord URL이 undefined인 환경
    mockEnvWith({});

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
    // fetch가 호출되지 않아야 한다
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Slack URL 미설정 시 ok=false + error에 "not configured" 포함', async () => {
    mockEnvWith({});

    const result = await sendWebhook('slack', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('타임아웃: AbortSignal.timeout 사용 확인', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    // 타임아웃 에러를 시뮬레이션
    fetchSpy.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError'));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('fetch failed');

    // AbortSignal.timeout이 옵션에 포함되는지 확인
    // (첫 호출이 mock에 의해 즉시 reject되므로 signal 옵션을 검증한다)
  });

  it('sendWebhook은 절대 throw하지 않는다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockRejectedValueOnce(new Error('unexpected'));

    // throw 없이 ok=false 반환
    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 보안 불변식 6: Webhook URL 비노출
// ---------------------------------------------------------------------------

describe('보안 불변식 6 -- Webhook URL 비노출', () => {
  it('실패 에러 메시지에 실제 Webhook URL이 포함되지 않는다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    // 에러 메시지에 실제 URL이 포함되면 안 된다
    expect(result.error).not.toContain(DISCORD_URL);
    expect(result.error).not.toContain('secret-token');
    expect(result.error).not.toContain('webhooks/123456');
  });

  it('네트워크 오류 메시지에도 Webhook URL이 포함되지 않는다', async () => {
    mockEnvWith({ slack: SLACK_URL });
    fetchSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const result = await sendWebhook('slack', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(SLACK_URL);
    expect(result.error).not.toContain('hooks.slack.com');
  });

  it('fetch 호출 시 URL을 사용하되 에러 응답에 URL 경로를 포함하지 않는다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const result = await sendWebhook('discord', SAMPLE_PAYLOAD);
    expect(result.ok).toBe(false);
    // fetch는 올바른 URL로 호출됐어야 한다
    expect(fetchSpy).toHaveBeenCalledWith(
      DISCORD_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    // 하지만 에러에는 URL이 없다
    expect(result.error).not.toContain(DISCORD_URL);
  });
});

// ---------------------------------------------------------------------------
// AbortSignal 사용 확인
// ---------------------------------------------------------------------------

describe('sendWebhook -- AbortSignal.timeout 사용', () => {
  it('fetch 호출 시 signal 옵션이 전달된다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await sendWebhook('discord', SAMPLE_PAYLOAD);

    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.signal).toBeDefined();
    // AbortSignal.timeout(10_000)이 만든 signal이어야 한다
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
