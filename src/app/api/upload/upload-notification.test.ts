/**
 * 업로드 완료 알림 유닛 테스트 -- Stage 5.
 *
 * 확인 대상:
 *   - sanitizeProto 경계값: 'javascript:', '', 'https', 'http', 'HTTP', null
 *   - Webhook URL 설정 시 알림 발송 -> notified: true
 *   - Webhook URL 미설정 시 skip -> notified: false
 *   - Webhook 실패 시 업로드 200 유지 + notified: false
 *   - 다중 채널 부분 성공 -> notified: true
 *
 * 업로드 라우트 핸들러를 직접 호출하면 fs 의존성이 복잡하므로,
 * sendWebhook mock + sanitizeProto 로직 검증으로 분리한다.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// sanitizeProto 경계값 테스트
// ---------------------------------------------------------------------------
// 라우트 파일 안에 로컬 정의된 함수와 동일한 로직을 검증한다.
// 함수가 private이므로 동일 로직을 테스트 내에서 재현한다.
// (2줄짜리 함수라 별도 모듈 추출을 하지 않는 설계 결정에 따른다.)

function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}

describe('sanitizeProto -- 경계값 검증', () => {
  it("'https' -> 'https'", () => {
    expect(sanitizeProto('https')).toBe('https');
  });

  it("'http' -> 'http'", () => {
    expect(sanitizeProto('http')).toBe('http');
  });

  it("'HTTP' (대문자) -> 'http' (소문자 변환)", () => {
    expect(sanitizeProto('HTTP')).toBe('http');
  });

  it("'HTTPS' (대문자) -> 'https' (소문자 변환)", () => {
    expect(sanitizeProto('HTTPS')).toBe('https');
  });

  it("'Http' (혼합 대소문자) -> 'http'", () => {
    expect(sanitizeProto('Http')).toBe('http');
  });

  it("null -> 'https' (기본값)", () => {
    expect(sanitizeProto(null)).toBe('https');
  });

  it("빈 문자열 '' -> 'https' (기본값)", () => {
    expect(sanitizeProto('')).toBe('https');
  });

  it("'javascript:' -> 'https' (위험 스키마 차단)", () => {
    expect(sanitizeProto('javascript:')).toBe('https');
  });

  it("'ftp' -> 'https' (허용되지 않는 프로토콜)", () => {
    expect(sanitizeProto('ftp')).toBe('https');
  });

  it("'data:' -> 'https' (data URI 차단)", () => {
    expect(sanitizeProto('data:')).toBe('https');
  });

  it("' https ' (전후 공백) -> 'https' (trim 처리)", () => {
    expect(sanitizeProto(' https ')).toBe('https');
  });

  it("'https, http' (다중 값) -> 'https' (기본값, 유효하지 않으므로)", () => {
    expect(sanitizeProto('https, http')).toBe('https');
  });
});

// ---------------------------------------------------------------------------
// 업로드 알림 통합 테스트 (sendWebhook mock)
// ---------------------------------------------------------------------------

// env 모킹
import { getServerEnv } from '@/lib/env';

vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...original,
    getServerEnv: vi.fn(),
  };
});

// sendWebhook 모킹
import { sendWebhook } from '@/lib/webhook';

vi.mock('@/lib/webhook', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/webhook')>();
  return {
    ...original,
    sendWebhook: vi.fn(),
  };
});

// rate limit 모킹 -- 항상 허용
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSec: 0 }),
  rateLimitKeyFor: () => 'test-key',
  RATE_LIMIT_POLICY: { upload: { maxRequests: 120, windowSec: 60 }, shareNotify: { maxRequests: 10, windowSec: 60 } },
}));

// path-safety 모킹 -- 기본적으로 통과
vi.mock('@/lib/path-safety', () => {
  const MOCK_ROOT = '/tmp/test-md';
  return {
    resolveUnderRoot: (p: string) => `${MOCK_ROOT}/${p}`.replace(/\/\//g, '/'),
    assertRealPathUnderRoot: async () => undefined,
    sanitizeFilename: (name: string) => name.replace(/[^\w.\-]/g, '_'),
    toSubpath: (abs: string) => abs.replace(MOCK_ROOT, '').replace(/^\//, ''),
    PathSafetyError: class PathSafetyError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'PathSafetyError';
      }
    },
  };
});

// search-index 모킹
vi.mock('@/lib/search-index', () => ({
  indexFile: async () => undefined,
}));

// fs/promises 모킹
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: async () => undefined,
    open: async () => ({
      writeFile: async () => undefined,
      sync: async () => undefined,
      close: async () => undefined,
    }),
    stat: async () => ({
      size: 100,
      mtimeMs: Date.now(),
      isFile: () => true,
    }),
    rename: async () => undefined,
    rm: async () => undefined,
  },
}));

import type { UploadResponse } from '@/types/api';

const DISCORD_URL = 'https://discord.com/api/webhooks/123456/secret-token';
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/secret';

function mockEnvWith(overrides: { discord?: string; slack?: string } = {}): void {
  vi.mocked(getServerEnv).mockReturnValue({
    MARKDOWN_ROOT: '/tmp/test-md',
    SESSION_PASSWORD: 'scrypt:16384:8:1:salt:hash',
    SESSION_SECRET: 'x'.repeat(64),
    UPLOAD_MAX_BYTES: 20_971_520,
    ALLOWED_EXTENSIONS: ['md', 'png', 'jpg'],
    RATE_LIMIT_MAX: 120,
    RATE_LIMIT_WINDOW_SEC: 60,
    ...(overrides.discord !== undefined ? { DISCORD_WEBHOOK_URL: overrides.discord } : {}),
    ...(overrides.slack !== undefined ? { SLACK_WEBHOOK_URL: overrides.slack } : {}),
  });
}

/**
 * multipart/form-data 요청을 생성한다.
 * Next.js 라우트 핸들러에 전달할 수 있는 Request 객체를 만든다.
 */
function createUploadRequest(
  fileName: string = 'test.md',
  content: string = '# Test',
  headers: Record<string, string> = {},
): Request {
  const formData = new FormData();
  const file = new File([content], fileName, { type: 'text/markdown' });
  formData.append('file', file);

  return new Request('http://localhost:3000/api/upload', {
    method: 'POST',
    body: formData,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  });
}

// 라우트 핸들러를 동적 import (mock 적용 후에)
let POST: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.clearAllMocks();
  // 동적 import로 mock이 적용된 상태에서 모듈을 가져온다
  const mod = await import('./route');
  POST = mod.POST;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('업로드 완료 알림 -- Webhook 통합', () => {
  it('Webhook URL 설정 시 알림 발송 -> notified: true', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    vi.mocked(sendWebhook).mockResolvedValueOnce({ ok: true });

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(true);
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect(sendWebhook).toHaveBeenCalledWith('discord', expect.objectContaining({
      fileName: expect.any(String),
      filePath: expect.any(String),
      appUrl: expect.stringContaining('https://localhost:3000'),
      mtime: expect.any(Number),
    }));
  });

  it('Webhook URL 미설정 시 skip -> notified: false', async () => {
    mockEnvWith({});

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(false);
    expect(sendWebhook).not.toHaveBeenCalled();
  });

  it('Webhook 실패 시 업로드 200 유지 + notified: false', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    vi.mocked(sendWebhook).mockResolvedValueOnce({
      ok: false,
      error: 'discord webhook returned 500: Internal Server Error',
    });

    // console.error 억제
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(false);
    expect(body.files).toBeDefined();
    expect(body.files.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('다중 채널: Discord 성공 + Slack 실패 -> notified: true', async () => {
    mockEnvWith({ discord: DISCORD_URL, slack: SLACK_URL });

    vi.mocked(sendWebhook)
      .mockResolvedValueOnce({ ok: true })                              // Discord 성공
      .mockResolvedValueOnce({ ok: false, error: 'slack rate limited' }); // Slack 실패

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.notified).toBe(true);
    expect(sendWebhook).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('다중 채널: 둘 다 실패 -> notified: false', async () => {
    mockEnvWith({ discord: DISCORD_URL, slack: SLACK_URL });

    vi.mocked(sendWebhook)
      .mockResolvedValueOnce({ ok: false, error: 'discord error' })
      .mockResolvedValueOnce({ ok: false, error: 'slack error' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notified).toBe(false);

    consoleSpy.mockRestore();
  });

  it('다중 채널: 둘 다 성공 -> notified: true', async () => {
    mockEnvWith({ discord: DISCORD_URL, slack: SLACK_URL });

    vi.mocked(sendWebhook)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const req = createUploadRequest();
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(res.status).toBe(200);
    expect(body.notified).toBe(true);
    expect(sendWebhook).toHaveBeenCalledTimes(2);
  });

  it('응답에 Webhook URL이 포함되지 않는다 (보안 불변식 6)', async () => {
    mockEnvWith({ discord: DISCORD_URL, slack: SLACK_URL });
    vi.mocked(sendWebhook).mockResolvedValue({ ok: true });

    const req = createUploadRequest();
    const res = await POST(req);
    const text = await res.clone().text();

    expect(text).not.toContain(DISCORD_URL);
    expect(text).not.toContain(SLACK_URL);
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('hooks.slack.com');
  });

  it('x-forwarded-proto 헤더가 appUrl에 반영된다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    vi.mocked(sendWebhook).mockResolvedValueOnce({ ok: true });

    const req = createUploadRequest('test.md', '# Test', {
      'x-forwarded-proto': 'http',
    });
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(body.notified).toBe(true);
    // sendWebhook에 전달된 payload의 appUrl이 http://로 시작해야 한다
    const callPayload = vi.mocked(sendWebhook).mock.calls[0][1];
    expect(callPayload.appUrl).toMatch(/^http:\/\//);
  });

  it('위험한 x-forwarded-proto는 https로 대체된다', async () => {
    mockEnvWith({ discord: DISCORD_URL });
    vi.mocked(sendWebhook).mockResolvedValueOnce({ ok: true });

    const req = createUploadRequest('test.md', '# Test', {
      'x-forwarded-proto': 'javascript:',
    });
    const res = await POST(req);
    const body = (await res.json()) as UploadResponse;

    expect(body.notified).toBe(true);
    const callPayload = vi.mocked(sendWebhook).mock.calls[0][1];
    expect(callPayload.appUrl).toMatch(/^https:\/\//);
    expect(callPayload.appUrl).not.toContain('javascript');
  });
});
