/**
 * `/api/push/subscribe`, `/api/push/test` 라우트 테스트.
 *
 * 세션 보호(401)는 미들웨어 책임이라 여기서는 다루지 않는다 — 실서버 curl로 확인한다.
 * 여기서는 핸들러의 계약을 고정한다: 공개키만 노출 / 미설정 400 / 형식 오류 400 /
 * 등록 안 된 기기 테스트 400 / 푸시 서비스 실패 502 / rate limit 429.
 */

import { createECDH } from 'node:crypto';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerEnv, type ServerEnv } from '@/lib/env';

vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>();
  return { ...original, getServerEnv: vi.fn() };
});

const sendNotification = vi.fn();
vi.mock('web-push', async (importOriginal) => {
  // `@types/web-push`는 `export =` 선언이라 ESM default가 타입에 없다 — 런타임에는 있다.
  const original = (await importOriginal<typeof import('web-push')>()) as typeof import('web-push') & {
    default: typeof import('web-push');
  };
  return {
    ...original,
    default: { ...original.default, sendNotification: (...a: unknown[]) => sendNotification(...a) },
  };
});

import { WebPushError } from 'web-push';

import { closePushDbForTest, hasSubscription, removeSubscription } from '@/lib/push';

import * as subscribeRoute from './subscribe/route';
import * as testRoute from './test/route';

const PUBLIC_KEY = Buffer.alloc(65, 4).toString('base64url');
const PRIVATE_KEY = Buffer.alloc(32, 9).toString('base64url');
const ENDPOINT = 'https://web.push.apple.com/QGh1c2t5LXJvdXRlLXRlc3Q';
const SUBSCRIPTION = {
  endpoint: ENDPOINT,
  keys: {
    p256dh: (() => {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return ecdh.getPublicKey().toString('base64url');
    })(),
    auth: Buffer.alloc(16, 7).toString('base64url'),
  },
};

let tmpRoot = '';
let ipCounter = 0;

function mockEnv(withVapid: boolean): void {
  const env: ServerEnv = {
    MARKDOWN_ROOT: tmpRoot,
    SESSION_PASSWORD: 'scrypt:16384:8:1:salt:hash',
    SESSION_SECRET: 'x'.repeat(64),
    UPLOAD_MAX_BYTES: 1024,
    ALLOWED_EXTENSIONS: ['md'],
    RATE_LIMIT_MAX: 10,
    RATE_LIMIT_WINDOW_SEC: 60,
    ...(withVapid
      ? { VAPID: { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, subject: 'mailto:a@b.c' } }
      : {}),
  };
  vi.mocked(getServerEnv).mockReturnValue(env);
}

/** rate limit 키가 테스트끼리 섞이지 않도록 요청마다 다른 IP를 쓴다. */
function req(method: string, url: string, body?: unknown, ip?: string): Request {
  ipCounter += 1;
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip ?? `10.0.0.${ipCounter}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(() => {
  tmpRoot = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'mdws-push-route-'));
});

afterAll(() => {
  closePushDbForTest();
  nodeFs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mockEnv(true);
  sendNotification.mockReset();
  removeSubscription(ENDPOINT);
});

describe('GET /api/push/subscribe', () => {
  it('공개키만 내려주고 개인키는 어디에도 없다', async () => {
    const res = await subscribeRoute.GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ enabled: true, publicKey: PUBLIC_KEY });
    expect(text).not.toContain(PRIVATE_KEY);
  });

  it('VAPID 미설정 → enabled:false', async () => {
    mockEnv(false);
    const res = await subscribeRoute.GET();
    expect(await res.json()).toEqual({ enabled: false, publicKey: null });
  });
});

describe('POST/DELETE /api/push/subscribe', () => {
  it('구독 저장 → DELETE로 해제', async () => {
    const res = await subscribeRoute.POST(
      req('POST', '/api/push/subscribe', { subscription: SUBSCRIPTION }),
    );
    expect(res.status).toBe(200);
    expect(hasSubscription(ENDPOINT)).toBe(true);

    const del = await subscribeRoute.DELETE(
      req('DELETE', '/api/push/subscribe', { endpoint: ENDPOINT }),
    );
    expect(del.status).toBe(200);
    expect(hasSubscription(ENDPOINT)).toBe(false);
  });

  it('VAPID 미설정 → 400', async () => {
    mockEnv(false);
    const res = await subscribeRoute.POST(
      req('POST', '/api/push/subscribe', { subscription: SUBSCRIPTION }),
    );
    expect(res.status).toBe(400);
  });

  it('허용되지 않은 endpoint(SSRF) → 400, 저장 안 됨', async () => {
    const evil = { ...SUBSCRIPTION, endpoint: 'https://169.254.169.254/latest/meta-data' };
    const res = await subscribeRoute.POST(
      req('POST', '/api/push/subscribe', { subscription: evil }),
    );
    expect(res.status).toBe(400);
  });

  it('JSON이 아닌 본문 → 400', async () => {
    const r = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.9.9.9' },
      body: 'not json',
    });
    expect((await subscribeRoute.POST(r)).status).toBe(400);
  });

  it('rate limit 초과 → 429 + Retry-After', async () => {
    const ip = '10.200.0.1';
    let last: Response | undefined;
    for (let i = 0; i < 21; i += 1) {
      last = await subscribeRoute.DELETE(
        req('DELETE', '/api/push/subscribe', { endpoint: ENDPOINT }, ip),
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).not.toBeNull();
  });
});

describe('POST /api/push/test', () => {
  it('등록되지 않은 기기 → 400 (다른 기기로 보내지 않는다)', async () => {
    const res = await testRoute.POST(req('POST', '/api/push/test', { endpoint: ENDPOINT }));
    expect(res.status).toBe(400);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('등록된 기기 → 그 기기에만 발송', async () => {
    await subscribeRoute.POST(req('POST', '/api/push/subscribe', { subscription: SUBSCRIPTION }));
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const res = await testRoute.POST(req('POST', '/api/push/test', { endpoint: ENDPOINT }));
    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].endpoint).toBe(ENDPOINT);
  });

  it('푸시 서비스 실패 → 502, 내부 사유 비노출', async () => {
    await subscribeRoute.POST(req('POST', '/api/push/subscribe', { subscription: SUBSCRIPTION }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendNotification.mockRejectedValue(new WebPushError('upstream secret detail', 500, {}, '', ENDPOINT));

    const res = await testRoute.POST(req('POST', '/api/push/test', { endpoint: ENDPOINT }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('upstream secret detail');
  });

  it('구독 만료(410) → 502 + 구독 삭제', async () => {
    await subscribeRoute.POST(req('POST', '/api/push/subscribe', { subscription: SUBSCRIPTION }));
    sendNotification.mockRejectedValue(new WebPushError('gone', 410, {}, '', ENDPOINT));

    const res = await testRoute.POST(req('POST', '/api/push/test', { endpoint: ENDPOINT }));
    expect(res.status).toBe(502);
    expect(hasSubscription(ENDPOINT)).toBe(false);
  });
});
