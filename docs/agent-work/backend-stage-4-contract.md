# Backend Stage 4 계약 -- 소셜 공유 (Discord / Slack Webhook)

- 작성: `tech-lead` / 2026-07-25
- 상태: **확정**
- 타입 기준: [src/types/api.ts](../../src/types/api.ts)
- 결정 참조: [stage-4-tasks.md](../plan/stage-4-tasks.md) D4-1 ~ D4-7

---

## 1. 신규 모듈: `src/lib/webhook.ts`

Discord/Slack Webhook 호출의 **단일 구현**. Stage 5(업로드 완료 알림)에서도 재사용한다.

### 1.1 공개 API

```typescript
import 'server-only';

import type { ShareTarget } from '@/types/api';

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

/**
 * Discord/Slack Webhook으로 알림을 전송한다.
 *
 * - Webhook URL은 `getServerEnv()`에서 읽는다.
 * - URL이 미설정이면 `{ ok: false, error: "..." }` 반환 (호출부가 400으로 변환).
 * - 네트워크 오류/비2xx 응답이면 `{ ok: false, error: "..." }` 반환 (호출부가 502로 변환).
 * - 타임아웃: 10초.
 *
 * @throws 절대 throw하지 않는다. 모든 실패는 `WebhookResult.ok = false`로 표현한다.
 */
export async function sendWebhook(
  target: ShareTarget,
  payload: WebhookPayload,
): Promise<WebhookResult>;
```

### 1.2 Discord Embed 형식

```typescript
// POST DISCORD_WEBHOOK_URL
// Content-Type: application/json
{
  embeds: [{
    title: `${payload.fileName}`,
    description: `경로: \`${payload.filePath}\``,
    url: payload.appUrl,
    color: 0x5865F2,  // Discord 브랜드 블루퍼플
    timestamp: new Date(payload.mtime).toISOString(),
    footer: {
      text: 'MD Workspace',
    },
  }],
}
```

Discord Webhook API 제약:
- `embeds` 최대 10개, 여기서는 항상 1개.
- `description` 최대 4096자 -- 파일 경로만 포함하므로 초과하지 않는다.
- 응답 2xx면 성공. 204(No Content)가 일반적.

### 1.3 Slack Block Kit 형식

```typescript
// POST SLACK_WEBHOOK_URL
// Content-Type: application/json
{
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${payload.appUrl}|${payload.fileName}>*\n경로: \`${payload.filePath}\`\n수정일: ${new Date(payload.mtime).toLocaleString('ko-KR')}`,
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
}
```

Slack Incoming Webhook 제약:
- 블록 최대 50개, 여기서는 2개.
- `mrkdwn` 텍스트 최대 3000자 -- 파일 경로만 포함하므로 초과하지 않는다.
- 응답 200 + 바디 "ok"면 성공.

### 1.4 내부 구현 지침

```typescript
async function sendWebhook(target: ShareTarget, payload: WebhookPayload): Promise<WebhookResult> {
  const env = getServerEnv();

  // 1. Webhook URL 존재 확인
  const url = target === 'discord' ? env.DISCORD_WEBHOOK_URL : env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { ok: false, error: `${target} webhook URL is not configured.` };
  }

  // 2. 페이로드 구성
  const body = target === 'discord'
    ? buildDiscordPayload(payload)
    : buildSlackPayload(payload);

  // 3. Webhook POST
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // 서버 로깅 — 응답 바디는 짧게만 기록
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
```

핵심 원칙:
- **절대 throw하지 않는다**. 모든 실패를 `WebhookResult`로 표현해 호출부가 500과 502를 구분할 수 있게 한다.
- Webhook URL을 로그에 기록하지 않는다 (보안 불변식 6). 로그에는 target 이름과 상태 코드만 기록한다.
- `AbortSignal.timeout(10_000)`으로 느린 Webhook 응답이 요청을 블로킹하지 않게 한다.

### 1.5 URL 미설정과 전달 실패의 구분

| 상황 | `WebhookResult` | 라우트 응답 |
|------|-----------------|-------------|
| URL 미설정 | `{ ok: false, error: "...not configured" }` | **400** "Webhook URL이 설정되지 않았습니다" |
| 네트워크 오류 | `{ ok: false, error: "...fetch failed" }` | **502** "Webhook 전달에 실패했습니다" |
| Webhook 비2xx | `{ ok: false, error: "...returned 4xx" }` | **502** "Webhook 전달에 실패했습니다" |
| 타임아웃 | `{ ok: false, error: "...timeout" }` | **502** "Webhook 전달에 실패했습니다" |

라우트에서 `WebhookResult.error` 문자열로 400과 502를 구분한다:
- `error`에 "not configured"가 포함되면 400.
- 그 외 모든 실패는 502.

---

## 2. `POST /api/share/notify`

### 경로
```
POST /api/share/notify
```

### 인증 요구사항
- 세션 인증 필수 (middleware에서 처리).

### 경로 검증
- `filePath`를 `resolveUnderRoot` + `assertRealPathUnderRoot`로 검증 (보안 불변식 2).
- 파일이 실제로 존재하는지 `fs.stat()`으로 확인.

### Rate Limit
- `checkRateLimit(rateLimitKeyFor(request, 'share'), RATE_LIMIT_POLICY.shareNotify)`.
- 정책: 60초당 10회.
- 초과 시 429 + `Retry-After` 헤더.

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | `target`이 'discord'/'slack'이 아님 |
| 400 | `filePath` 미지정 또는 빈 문자열 |
| 400 | `filePath` 경로 검증 실패 (traversal 시도 등) |
| 400 | 파일이 존재하지 않음 |
| 400 | 해당 target의 Webhook URL이 미설정 |
| 401 | 미인증 (middleware) |
| 429 | Rate limit 초과 |
| 500 | 내부 오류 (파일 메타 읽기 실패 등) |
| 502 | Webhook 전달 실패 (네트워크 오류, 비2xx 응답, 타임아웃) |

### 요청 바디

```typescript
// src/types/api.ts에 정의됨
interface ShareNotifyRequest {
  target: ShareTarget;  // 'discord' | 'slack'
  filePath: string;     // MARKDOWN_ROOT 기준 상대 경로
}
```

### 응답 바디

```typescript
// 성공 (200)
interface ShareNotifyResponse {
  ok: true;
  target: ShareTarget;
}

// 실패 (400 / 429 / 500 / 502)
interface ApiError {
  code: ApiErrorCode;
  message: string;
}
```

### 구현 의사코드

```typescript
import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

import { apiError, internalError } from '@/lib/api-response';
import { getServerEnv } from '@/lib/env';
import { resolveUnderRoot, assertRealPathUnderRoot, toSubpath } from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor, RATE_LIMIT_POLICY } from '@/lib/rate-limit';
import { sendWebhook, type WebhookPayload } from '@/lib/webhook';
import type { ShareNotifyRequest, ShareNotifyResponse, ShareTarget } from '@/types/api';

export const runtime = 'nodejs';

const VALID_TARGETS = new Set<ShareTarget>(['discord', 'slack']);

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Rate limit
  const rlKey = rateLimitKeyFor(request, 'share');
  const rl = checkRateLimit(rlKey, RATE_LIMIT_POLICY.shareNotify);
  if (!rl.allowed) {
    return apiError(429, 'Too many requests. Please try again later.', {
      'Retry-After': String(rl.retryAfterSec),
    });
  }

  // 2. 요청 파싱
  let body: ShareNotifyRequest;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body.');
  }

  const { target, filePath } = body;

  // 3. target 검증
  if (!target || !VALID_TARGETS.has(target)) {
    return apiError(400, 'Invalid target. Must be "discord" or "slack".');
  }

  // 4. filePath 검증
  if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
    return apiError(400, 'filePath is required.');
  }

  // 5. 경로 안전 검증 (보안 불변식 2)
  let absolutePath: string;
  try {
    absolutePath = resolveUnderRoot(filePath.trim());
    await assertRealPathUnderRoot(absolutePath);
  } catch {
    return apiError(400, 'Invalid file path.');
  }

  // 6. 파일 존재 확인 + 메타 정보
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

  // 7. 앱 URL 구성 (D4-2)
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || 'localhost:3000';
  const subpath = toSubpath(absolutePath);
  const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`;

  // 8. Webhook 호출
  const fileName = path.basename(subpath);
  const payload: WebhookPayload = { fileName, filePath: subpath, appUrl, mtime };

  try {
    const result = await sendWebhook(target, payload);

    if (!result.ok) {
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
```

---

## 3. 앱 URL 구성 상세 (D4-2)

### 프로토콜 + 호스트 결정

```typescript
const proto = request.headers.get('x-forwarded-proto') || 'https';
const host = request.headers.get('host') || 'localhost:3000';
```

- ngrok은 `x-forwarded-proto: https`와 `host: <subdomain>.ngrok-free.app`을 전달한다.
- 로컬 개발 시에는 `host: localhost:3000`이 된다.
- 이렇게 구성된 URL은 수신자가 ngrok Basic Auth + 앱 세션 인증을 거쳐야 접근할 수 있다 (ADR-004).

### URL 패턴

```
https://<ngrok-domain>/workspace/view?path=<encodeURIComponent(subpath)>
```

예시:
```
https://my-app.ngrok-free.app/workspace/view?path=2026-Travel%2F%EC%A0%9C%EC%A3%BC%EB%8F%84.md
```

---

## 4. 유닛 테스트: `src/lib/webhook.test.ts`

### 테스트 전략

`sendWebhook` 내부에서 글로벌 `fetch`를 호출하므로, `vi.spyOn(globalThis, 'fetch')`로 모킹한다.

### 필수 테스트 케이스

| # | 테스트 | 설명 |
|---|--------|------|
| 1 | Discord 성공 | fetch가 204 반환 -> `{ ok: true }` |
| 2 | Slack 성공 | fetch가 200 + "ok" 반환 -> `{ ok: true }` |
| 3 | Discord 페이로드 형태 | fetch에 전달된 body가 `embeds` 배열 포함 |
| 4 | Slack 페이로드 형태 | fetch에 전달된 body가 `blocks` 배열 포함 |
| 5 | Discord embed 필드 | title, description, url, color, timestamp 포함 |
| 6 | Slack section 필드 | mrkdwn text에 파일명, 경로, 수정일 포함 |
| 7 | Webhook 비2xx 응답 | fetch가 404 반환 -> `{ ok: false }` |
| 8 | 네트워크 오류 | fetch가 throw -> `{ ok: false }` |
| 9 | URL 미설정 | env에 URL이 없으면 -> `{ ok: false, error: "...not configured" }` |
| 10 | 타임아웃 | `AbortSignal.timeout` 사용 확인 |
| 11 | Webhook URL 비노출 | error 메시지에 실제 URL이 포함되지 않음 |
| 12 | Content-Type | fetch 헤더에 `application/json` 설정 |

### 테스트 환경

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// env 모킹
vi.mock('@/lib/env', () => ({
  getServerEnv: vi.fn(),
}));

// 각 테스트 전에 fetch를 모킹
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('', { status: 204 }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});
```

---

## 5. 보안 체크리스트

| # | 불변식 | 적용 대상 | 확인 사항 |
|---|--------|-----------|-----------|
| 1 | 세션 보호 | /api/share/notify | middleware에서 자동 적용 |
| 2 | 경로 검증 | filePath 파라미터 | `resolveUnderRoot` + `assertRealPathUnderRoot` |
| 6 | 시크릿 비노출 | webhook.ts | Webhook URL을 응답/로그에 포함하지 않음 |
| 7 | Rate limit | /api/share/notify | `RATE_LIMIT_POLICY.shareNotify` (60초/10회) |
| 8 | 내부 정보 비노출 | 모든 응답 | 절대 경로/스택트레이스/Webhook URL 포함 금지 |

### 보안 불변식 6 구체적 확인 사항

- `sendWebhook`의 `WebhookResult.error`에 실제 Webhook URL이 포함되지 않는다.
  - 올바른 예: `"discord webhook returned 404: ..."`
  - 금지 예: `"POST https://discord.com/api/webhooks/xxx/yyy returned 404"`
- `apiError()` 응답에 Webhook URL 문자열이 포함되지 않는다.
- 프론트엔드 번들에 `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` 참조가 없다.
  - `webhook.ts`는 `import 'server-only'`를 선언한다.
  - `env.ts`도 `import 'server-only'`를 이미 선언하고 있다.
