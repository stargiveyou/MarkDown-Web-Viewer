/**
 * Web Push 서버 모듈 테스트.
 *
 * 확인 대상:
 *   - endpoint 허용 목록 (SSRF 방지): 알려진 푸시 서비스 https URL만 통과
 *   - 구독 키 형식 검증 (p256dh 65바이트, auth 16바이트)
 *   - 업로드 알림 페이로드: 단일/다중, md/비md, 루트 폴더, 잠금 화면 길이 제한
 *   - 구독 저장소: 저장·중복·삭제·상한
 *   - 발송: 성공 / 404·410 시 구독 삭제 / 기타 실패 집계 / VAPID 미설정 시 무동작
 */

import { createECDH } from 'node:crypto';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    default: { ...original.default, sendNotification: (...args: unknown[]) => sendNotification(...args) },
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  };
});

import { WebPushError } from 'web-push';

import {
  MAX_SUBSCRIPTIONS,
  buildUploadPushPayload,
  closePushDbForTest,
  countSubscriptions,
  hasSubscription,
  isAllowedPushEndpoint,
  notifyUploadPush,
  parsePushSubscription,
  removeSubscription,
  saveSubscription,
  sendPush,
} from '@/lib/push';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

/** 실제 P-256 공개키 (곡선 위의 점이어야 검증을 통과한다). */
const P256DH = (() => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey().toString('base64url');
})();
const AUTH = Buffer.alloc(16, 7).toString('base64url');
const APPLE = 'https://web.push.apple.com/QGh1c2t5LXRlc3QtdG9rZW4';

function sub(endpoint: string) {
  return { endpoint, keys: { p256dh: P256DH, auth: AUTH } };
}

let tmpRoot = '';

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
      ? {
          VAPID: {
            publicKey: Buffer.alloc(65, 4).toString('base64url'),
            privateKey: Buffer.alloc(32, 9).toString('base64url'),
            subject: 'mailto:test@example.com',
          },
        }
      : {}),
  };
  vi.mocked(getServerEnv).mockReturnValue(env);
}

beforeAll(() => {
  tmpRoot = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'mdws-push-'));
});

afterAll(() => {
  closePushDbForTest();
  nodeFs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// endpoint 허용 목록
// ---------------------------------------------------------------------------

describe('isAllowedPushEndpoint — SSRF 방지', () => {
  it.each([
    APPLE,
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('허용: %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['http 평문', 'http://web.push.apple.com/abc'],
    ['임의 호스트', 'https://evil.example.com/push'],
    ['내부망', 'https://127.0.0.1/push'],
    ['localhost', 'https://localhost:3000/api/upload'],
    ['접미사 위장', 'https://push.apple.com.evil.com/abc'],
    ['점 없는 접미사 일치', 'https://evilpush.apple.com/abc'],
    ['포트 지정', 'https://web.push.apple.com:8443/abc'],
    ['자격 증명 포함', 'https://user:pw@web.push.apple.com/abc'],
    ['URL 아님', 'not a url'],
    ['문자열 아님', 42],
    ['너무 김', `https://web.push.apple.com/${'a'.repeat(1100)}`],
  ])('거부: %s', (_label, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('parsePushSubscription', () => {
  it('올바른 구독을 레코드로 바꾼다', () => {
    expect(parsePushSubscription(sub(APPLE))).toEqual({
      endpoint: APPLE,
      p256dh: P256DH,
      auth: AUTH,
    });
  });

  it.each([
    ['null', null],
    ['keys 없음', { endpoint: APPLE }],
    ['p256dh 길이 틀림', { endpoint: APPLE, keys: { p256dh: Buffer.alloc(33).toString('base64url'), auth: AUTH } }],
    ['auth 길이 틀림', { endpoint: APPLE, keys: { p256dh: P256DH, auth: Buffer.alloc(8).toString('base64url') } }],
    ['base64url 아님', { endpoint: APPLE, keys: { p256dh: '***', auth: AUTH } }],
    ['65바이트지만 곡선 위의 점 아님', { endpoint: APPLE, keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: AUTH } }],
    ['허용되지 않은 endpoint', sub('https://evil.example.com/x')],
  ])('거부: %s', (_label, input) => {
    expect(parsePushSubscription(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 업로드 알림 페이로드
// ---------------------------------------------------------------------------

function file(subpath: string) {
  return { name: path.posix.basename(subpath), subpath, size: 10, mtime: 0 };
}

describe('buildUploadPushPayload', () => {
  it('파일이 없으면 null', () => {
    expect(buildUploadPushPayload([], 'docs')).toBeNull();
  });

  it('md 1개 → 해당 문서 뷰어로 연결', () => {
    const p = buildUploadPushPayload([file('프로젝트/작업 기록.md')], '프로젝트');
    expect(p).toMatchObject({
      body: '작업 기록.md · 프로젝트',
      url: `/workspace/view?path=${encodeURIComponent('프로젝트/작업 기록.md')}`,
    });
  });

  it('이미지 1개 → 폴더로 연결', () => {
    const p = buildUploadPushPayload([file('img/a.png')], 'img');
    expect(p?.url).toBe('/workspace?path=img');
  });

  it('루트 업로드는 /workspace 로 연결하고 "루트 폴더"로 표시', () => {
    const p = buildUploadPushPayload([file('a.png'), file('b.md')], '');
    expect(p).toMatchObject({ url: '/workspace', body: 'a.png 외 1개 · 루트 폴더' });
    expect(p?.title).toContain('2개');
  });

  it('잠금 화면 본문은 120자로 자른다', () => {
    const long = `${'가'.repeat(200)}.md`;
    const p = buildUploadPushPayload([file(long)], '');
    expect(p?.body.length).toBe(120);
    expect(p?.body.endsWith('…')).toBe(true);
  });

  it('URL은 항상 앱 내부 상대 경로다', () => {
    const p = buildUploadPushPayload([file('x/../../evil.md')], 'x');
    expect(p?.url.startsWith('/workspace')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 저장소 + 발송
// ---------------------------------------------------------------------------

describe('구독 저장소와 발송', () => {
  beforeEach(() => {
    mockEnv(true);
    sendNotification.mockReset();
    for (let i = 0; i < MAX_SUBSCRIPTIONS + 5; i += 1) {
      removeSubscription(`${APPLE}${i}`);
    }
    removeSubscription(APPLE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('저장·조회·삭제가 멱등하게 동작한다', () => {
    const rec = parsePushSubscription(sub(APPLE))!;
    saveSubscription(rec);
    saveSubscription(rec);
    expect(hasSubscription(APPLE)).toBe(true);
    expect(countSubscriptions()).toBe(1);

    removeSubscription(APPLE);
    removeSubscription(APPLE);
    expect(hasSubscription(APPLE)).toBe(false);
  });

  it(`상한(${MAX_SUBSCRIPTIONS})을 넘으면 가장 오래된 구독부터 지운다`, () => {
    for (let i = 0; i < MAX_SUBSCRIPTIONS + 2; i += 1) {
      saveSubscription(parsePushSubscription(sub(`${APPLE}${i}`))!, 1_000 + i);
    }
    expect(countSubscriptions()).toBe(MAX_SUBSCRIPTIONS);
    expect(hasSubscription(`${APPLE}0`)).toBe(false);
    expect(hasSubscription(`${APPLE}1`)).toBe(false);
    expect(hasSubscription(`${APPLE}${MAX_SUBSCRIPTIONS + 1}`)).toBe(true);
  });

  it('성공 / 410(만료 → 삭제) / 500(실패 집계)을 구분한다', async () => {
    saveSubscription(parsePushSubscription(sub(`${APPLE}ok`))!);
    saveSubscription(parsePushSubscription(sub(`${APPLE}gone`))!);
    saveSubscription(parsePushSubscription(sub(`${APPLE}err`))!);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith('gone')) throw new WebPushError('gone', 410, {}, '', s.endpoint);
      if (s.endpoint.endsWith('err')) throw new WebPushError('boom', 500, {}, '', s.endpoint);
      return { statusCode: 201 };
    });

    const result = await sendPush({ title: 't', body: 'b', url: '/workspace' });
    expect(result).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect(hasSubscription(`${APPLE}gone`)).toBe(false);
    expect(hasSubscription(`${APPLE}err`)).toBe(true);

    // 로그에 endpoint 전체(= 기기로 보낼 권한)가 남지 않는다.
    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(`${APPLE}err`);
    expect(logged).toContain('web.push.apple.com');
    errSpy.mockRestore();

    removeSubscription(`${APPLE}ok`);
    removeSubscription(`${APPLE}err`);
  });

  it('VAPID 개인키와 TTL을 넘겨 암호화 발송한다', async () => {
    saveSubscription(parsePushSubscription(sub(APPLE))!);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await sendPush({ title: 't', body: 'b', url: '/workspace' }, APPLE);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [target, body, options] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: APPLE, keys: { p256dh: P256DH, auth: AUTH } });
    expect(JSON.parse(body as string)).toEqual({ title: 't', body: 'b', url: '/workspace' });
    expect(options).toMatchObject({
      TTL: 86_400,
      vapidDetails: { subject: 'mailto:test@example.com' },
    });
  });

  it('VAPID 미설정이면 아무것도 보내지 않는다', async () => {
    saveSubscription(parsePushSubscription(sub(APPLE))!);
    mockEnv(false);

    expect(await sendPush({ title: 't', body: 'b', url: '/' })).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    notifyUploadPush([file('a.md')], '');
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('notifyUploadPush는 응답을 막지 않고 발송을 띄운다', async () => {
    saveSubscription(parsePushSubscription(sub(APPLE))!);
    let resolveSend: () => void = () => {};
    sendNotification.mockImplementation(
      () => new Promise<void>((r) => { resolveSend = r; }),
    );

    // 반환값이 없고(void), 발송이 끝나기 전에 돌아온다.
    expect(notifyUploadPush([file('docs/a.md')], 'docs')).toBeUndefined();
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    resolveSend();
  });
});
