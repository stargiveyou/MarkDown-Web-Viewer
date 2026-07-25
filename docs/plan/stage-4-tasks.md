# Stage 4 작업 분해 -- 소셜 공유 (Discord / Slack Webhook)

- 작성: `tech-lead` / 2026-07-25
- 계약 기준: [backend-stage-4-contract.md](../agent-work/backend-stage-4-contract.md) / [frontend-stage-4-contract.md](../agent-work/frontend-stage-4-contract.md)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) (Stage 0에서 정의 완료 -- 신규 타입 추가 불필요)
- 목표: 인증된 사용자가 뷰어/편집 페이지에서 파일을 Discord/Slack 채널로 공유 알림 전송

---

## 선행 결정 (tech-lead 확정)

### D4-1. Webhook 페이로드 형식

**결정: Discord는 Embed, Slack은 Block Kit을 사용한다.**

- **Discord**: `POST <DISCORD_WEBHOOK_URL>` 바디에 `embeds` 배열을 포함한다.
  - embed 구성: 제목(파일명), 설명(snippet 또는 경로), 색상, 타임스탬프.
  - 앱 URL 링크는 포함하되, URL 자체가 ngrok 도메인이므로 수신자도 ngrok+앱 인증이 필요하다(ADR-004).
- **Slack**: `POST <SLACK_WEBHOOK_URL>` 바디에 `blocks` 배열을 포함한다.
  - section block: 마크다운 텍스트로 파일명, 경로, 타임스탬프 포함.
  - 앱 URL 링크 동일 규칙.
- 두 플랫폼 모두 **서버에서만 호출**한다. Webhook URL은 클라이언트에 절대 노출하지 않는다(보안 불변식 6).

### D4-2. 앱 URL 구성 방식

**결정: 요청의 `Host` 헤더 + 프로토콜에서 base URL을 동적으로 구성한다.**

- ngrok 도메인은 환경에 따라 바뀔 수 있으므로 환경변수로 고정하지 않는다.
- `request.headers`에서 `x-forwarded-proto`(또는 `https` 기본값)와 `host`를 읽어 구성한다.
- 이 URL은 webhook 메시지에 "열기" 링크로 포함된다.
- 수신자는 ngrok Basic Auth + 앱 세션 인증을 거쳐야 접근할 수 있다(ADR-004, 무인증 공유 링크 금지).

### D4-3. 파일 메타 정보 포함 범위

**결정: 공유 알림에 파일명, 상대 경로, 수정일, 앱 URL을 포함한다. 본문 snippet은 포함하지 않는다.**

- 이유: webhook 메시지에 마크다운 본문을 포함하면 민감 정보가 외부 서비스에 전달될 수 있다.
- 파일이 존재하는지, `MARKDOWN_ROOT` 하위인지 검증한 뒤 메타 정보만 추출한다.
- 앱 URL을 통해 원문을 확인하도록 안내한다.

### D4-4. Webhook URL 미설정 시 동작

**결정: 해당 target에 대해 400 에러를 반환한다.**

- `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL`은 선택 환경변수이다(env.ts에서 optional).
- 사용자가 미설정 target으로 공유를 시도하면 "해당 채널의 Webhook URL이 설정되지 않았습니다" 메시지와 함께 400을 반환한다.
- 프론트엔드는 설정되지 않은 target의 버튼을 비활성화(disabled)하지 않는다 -- env 정보를 클라이언트에 노출할 수 없으므로(보안 불변식 6) 서버 응답으로 처리한다.

### D4-5. Rate Limit 정책

**결정: 기존 `RATE_LIMIT_POLICY.shareNotify` 정책을 사용한다 (60초당 10회).**

- `src/lib/rate-limit.ts`에 이미 정의되어 있다: `{ max: 10, windowSec: 60 }`.
- 세션 식별자 우선, IP 폴백 키를 사용한다.
- 429 응답에 `Retry-After` 헤더를 포함한다.

### D4-6. 에러 코드 세분화

**결정: 500(내부 오류)과 502(webhook 전달 실패)를 명확히 구분한다.**

- **400**: `target`이 유효하지 않음, `filePath`가 없음, Webhook URL 미설정, 파일 미존재, 경로 검증 실패.
- **401**: 미인증 (middleware).
- **429**: Rate limit 초과.
- **500**: 파일 메타 읽기 실패, 예기치 못한 서버 오류 등. 원인은 서버에만 로깅.
- **502**: Webhook POST 요청이 실패(네트워크 오류, HTTP 4xx/5xx 응답 등). 사용자에게 "재시도해 주세요" 안내.

### D4-7. Stage 5와의 경계

**결정: Stage 4는 사용자가 수동으로 공유 버튼을 누르는 기능이다. Stage 5의 업로드 자동 알림과 분리한다.**

- Stage 4의 `/api/share/notify`는 **사용자 발의 공유**만 처리한다.
- Stage 5에서 업로드 성공 시 자동 발화하는 알림은 같은 Webhook 유틸리티를 재사용하되, 호출 시점과 트리거가 다르다.
- 이번 단계에서 Webhook 호출 유틸리티(`src/lib/webhook.ts`)를 모듈로 분리해 Stage 5에서 재사용할 수 있게 한다.

---

## 범위에 포함되는 엔드포인트

| 메서드 | 경로 | 담당 | 신규/변경 |
|--------|------|------|-----------|
| POST | `/api/share/notify` | backend-dev | **신규** |

타입은 `src/types/api.ts`에 이미 정의되어 있다:
`ShareTarget`, `ShareNotifyRequest`, `ShareNotifyResponse`.

**신규 라이브러리 모듈**: `src/lib/webhook.ts` -- Discord/Slack Webhook 호출 단일 모듈.

---

## 실행 순서 (Wave)

```
Wave 0 ── tech-lead  : 타입 확인(변경 불필요), 계약 문서 확정, 작업 계획
              |
Wave 1 ──┬── backend-dev   : webhook.ts + POST /api/share/notify + 테스트
         └── frontend-dev  : ShareModal + 뷰어/편집 페이지 공유 버튼
              |                                  (계약만 보고 병렬)
Wave 2 ──┬── backend-validator    (fable)
         └── frontend-validator   (fable)         동시 실행
              |
Wave 3 ───── qa-integration -> optimizer           (fable)
```

**임계 경로**: Wave 0(타입 변경 없음, 계약 확정) 완료 후 Wave 1 착수. 프론트/백엔드는 완전 병렬.

**의존성 확인**: Stage 1-3 산출물(`path-safety`, `session`, `api-response`, `env`, `rate-limit`, `fetcher`, `file-utils`)이 모두 완성되어 있으므로 즉시 착수 가능. 외부 라이브러리 추가 불필요(Node 내장 `fetch` 사용).

---

## Wave 0 -- tech-lead (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | 타입 확인 -- 변경 불필요 | `src/types/api.ts` (이미 정의됨) |
| 2 | 계약 문서 확정 | `docs/agent-work/backend-stage-4-contract.md`, `frontend-stage-4-contract.md` |
| 3 | 이 작업 계획 문서 | `docs/plan/stage-4-tasks.md` (본 문서) |

---

## Wave 1-A -- backend-dev (opus)

Stage 1-3의 `path-safety`, `api-response`, `env`, `rate-limit` 유틸을 그대로 사용한다.

### 보안 불변식 준수 사항

- `export const runtime = 'nodejs'` -- `/api/share/notify` 라우트
- `filePath` 파라미터: `resolveUnderRoot` -> `assertRealPathUnderRoot` (불변식 2)
- `verifySession`은 middleware가 처리 -- 라우트에서 중복 호출 불필요
- rate limit 적용: `checkRateLimit(key, RATE_LIMIT_POLICY.shareNotify)` (불변식 7)
- 에러 응답은 `apiError()` / `internalError()` 경유 (불변식 8)
- Webhook URL은 `getServerEnv()`에서만 읽고 응답에 절대 포함하지 않음 (불변식 6)
- 500(내부)과 502(webhook 실패)를 구분 (CLAUDE.md API 계약)

| # | 작업 | 산출물 | 보안 불변식 |
|---|------|--------|-------------|
| 1 | `webhook.ts` -- Webhook 호출 유틸리티 | `src/lib/webhook.ts` | 6, 8 |
| 2 | `POST /api/share/notify` -- 공유 알림 라우트 | `src/app/api/share/notify/route.ts` | 1, 2, 6, 7, 8 |
| 3 | webhook 유닛 테스트 | `src/lib/webhook.test.ts` | -- |
| 4 | share/notify 라우트 통합 테스트 | (curl E2E) | -- |

### 상세 요구사항

**1. `src/lib/webhook.ts`**

Webhook 호출의 단일 모듈. Stage 5에서 업로드 알림용으로 재사용할 수 있도록 범용적으로 설계한다.

공개 API:
```typescript
export interface WebhookPayload {
  /** 파일명 (확장자 포함). */
  fileName: string;
  /** MARKDOWN_ROOT 기준 상대 경로. */
  filePath: string;
  /** 앱에서 해당 파일을 열 수 있는 URL. */
  appUrl: string;
  /** 파일 수정일 (epoch ms). */
  mtime: number;
}

export type WebhookTarget = 'discord' | 'slack';

export interface WebhookResult {
  ok: boolean;
  /** 실패 시 사유 (서버 로깅용). 응답에 포함하지 않는다. */
  error?: string;
}

/** Discord/Slack Webhook으로 알림을 전송한다. */
export async function sendWebhook(target: WebhookTarget, payload: WebhookPayload): Promise<WebhookResult>;
```

- Discord: `POST DISCORD_WEBHOOK_URL` + `{ embeds: [{ title, description, url, color, timestamp }] }`
- Slack: `POST SLACK_WEBHOOK_URL` + `{ blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }`
- 타임아웃: 10초 (`AbortSignal.timeout(10_000)`)
- Webhook 응답이 2xx가 아니면 `{ ok: false, error: "..." }` 반환.
- 네트워크 오류도 동일하게 처리.
- Webhook URL은 `getServerEnv()`에서 읽는다. URL을 외부에 노출하지 않는다.

**2. `POST /api/share/notify`**

- 요청 바디: `ShareNotifyRequest = { target, filePath }`
- 경로 검증: `filePath`를 `resolveUnderRoot` + `assertRealPathUnderRoot`로 검증.
- 파일 존재 확인: `fs.stat()`으로 존재 여부 + mtime 획득.
- 앱 URL 구성: `${protocol}://${host}/workspace/view?path=${encodeURIComponent(filePath)}`.
- Webhook 호출: `sendWebhook(target, payload)`.
- 성공: `ShareNotifyResponse = { ok: true, target }`.
- 실패(webhook): `502 + { code: 502, message: "Webhook delivery failed. Please try again." }`.
- 실패(내부): `internalError()` 경유 (500).

**3. webhook 유닛 테스트**

| # | 테스트 | 설명 |
|---|--------|------|
| 1 | Discord 페이로드 구성 | embed 형태가 Discord API 스펙에 맞는지 |
| 2 | Slack 페이로드 구성 | blocks 형태가 Slack API 스펙에 맞는지 |
| 3 | 네트워크 오류 처리 | fetch 실패 시 `{ ok: false }` 반환 |
| 4 | 비2xx 응답 처리 | 404/500 응답 시 `{ ok: false }` 반환 |
| 5 | 타임아웃 처리 | 10초 초과 시 실패 처리 |
| 6 | Webhook URL 미설정 | `getServerEnv()`에서 undefined인 경우 |

---

## Wave 1-B -- frontend-dev (opus)

`fetcher.ts`의 `apiFetch`를 모든 API 호출에 사용한다.

| # | 작업 | 산출물 | 호출 API |
|---|------|--------|----------|
| 1 | ShareModal 컴포넌트 | `src/components/workspace/ShareModal.tsx` | POST /api/share/notify |
| 2 | 뷰어 페이지에 공유 버튼 추가 | `src/app/workspace/view/page.tsx` 수정 | -- |
| 3 | 편집 페이지에 공유 버튼 추가 | `src/app/workspace/edit/page.tsx` 수정 | -- |

### 상세 요구사항

**1. ShareModal 컴포넌트**

파일: `src/components/workspace/ShareModal.tsx`

Props:
```typescript
interface ShareModalProps {
  /** 공유할 파일의 MARKDOWN_ROOT 기준 상대 경로. */
  filePath: string;
  /** 모달 닫기 콜백. */
  onClose: () => void;
}
```

동작:
- 기존 `src/components/ui/Modal.tsx`를 재사용한다.
- Discord / Slack 두 개 버튼을 표시한다.
- 버튼 클릭 시 `apiFetch<ShareNotifyResponse>('/api/share/notify', { method: 'POST', body: JSON.stringify({ target, filePath }) })` 호출.
- 성공: 토스트로 "Discord에 공유되었습니다" / "Slack에 공유되었습니다" 표시.
- 실패(400): "Webhook URL이 설정되지 않았습니다" 등 서버 메시지를 토스트로 표시.
- 실패(429): fetcher가 자동 처리 (rate limit 토스트).
- 실패(502): "전송에 실패했습니다. 재시도해 주세요." 토스트.
- 전송 중 버튼 로딩 상태 표시 (스피너 + 비활성화).
- "링크 복사" 버튼도 함께 표시한다: 현재 페이지 URL(`window.location.href`)을 클립보드에 복사. 수신자도 인증이 필요하다는 안내 텍스트 포함 (ADR-004).

아이콘:
- Discord: lucide `MessageCircle` 또는 인라인 SVG 아이콘.
- Slack: lucide `Hash` 또는 인라인 SVG 아이콘.
- 링크 복사: lucide `Link`.

**2. 뷰어 페이지 공유 버튼**

- 기존 뷰어 페이지 헤더(편집 버튼 옆)에 "공유" 아이콘 버튼 추가.
- lucide `Share2` 아이콘.
- 클릭 시 `ShareModal` 열기 (`filePath`는 URL 쿼리의 `path` 값).

**3. 편집 페이지 공유 버튼**

- 기존 편집 페이지 헤더(저장 버튼 옆)에 "공유" 아이콘 버튼 추가.
- 동일한 `ShareModal` 사용.
- `filePath`는 URL 쿼리의 `path` 값.

---

## Wave 2 -- 검증 (fable)

`backend-validator`와 `frontend-validator`가 동시에 실행한다.

### backend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | `npm run typecheck` | 오류 0 |
| 2 | `npm test` | 전체 통과, 실패 0 |
| 3 | `npm run lint` | 오류 0 |
| 4 | `npm run build` | 성공 |
| 5 | POST /api/share/notify Discord 성공 | 200 + `ShareNotifyResponse` 형태 |
| 6 | POST /api/share/notify Slack 성공 | 200 + `ShareNotifyResponse` 형태 |
| 7 | 미인증 요청 | 401 |
| 8 | 잘못된 target | 400 |
| 9 | filePath 미지정 | 400 |
| 10 | 존재하지 않는 파일 | 400 |
| 11 | 경로 traversal 시도 | 400 |
| 12 | Webhook URL 미설정 target | 400 |
| 13 | Webhook 전달 실패 | 502 |
| 14 | rate limit 초과 | 429 + Retry-After 헤더 |
| 15 | 보안 불변식 2 | filePath 경로 검증 (`resolveUnderRoot` + `assertRealPathUnderRoot`) |
| 16 | 보안 불변식 6 | 응답에 Webhook URL 포함 없음 |
| 17 | 보안 불변식 7 | rate limit 적용 확인 |
| 18 | 보안 불변식 8 | 에러 응답에 내부 정보 없음 |
| 19 | `runtime = 'nodejs'` | share/notify 라우트에 선언 |
| 20 | 500 vs 502 구분 | webhook 실패=502, 서버 오류=500 |
| 21 | webhook.ts 유닛 테스트 | 페이로드 구성, 에러 처리, 타임아웃 |

### frontend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | 빌드 성공 | `npm run build` 에러 없음 |
| 2 | ShareModal 렌더 | 모달이 올바르게 열리고 닫힘 |
| 3 | Discord 공유 버튼 | 클릭 시 API 호출 + 성공 토스트 |
| 4 | Slack 공유 버튼 | 클릭 시 API 호출 + 성공 토스트 |
| 5 | 링크 복사 | 클립보드에 URL 복사 + 안내 토스트 |
| 6 | 502 에러 처리 | 재시도 안내 토스트 |
| 7 | 400 에러 처리 | 서버 메시지 토스트 |
| 8 | 로딩 상태 | 전송 중 버튼 비활성화 + 스피너 |
| 9 | 뷰어 페이지 공유 버튼 | 헤더에 공유 아이콘 표시 |
| 10 | 편집 페이지 공유 버튼 | 헤더에 공유 아이콘 표시 |
| 11 | 모든 API 호출이 `apiFetch` 경유 | raw fetch 사용 없음 |
| 12 | ADR-004 준수 | "링크 복사" 시 인증 필요 안내 포함, 카카오 없음 |
| 13 | Modal 컴포넌트 재사용 | 기존 UI Modal 활용 |

---

## Wave 3 -- qa-integration + optimizer (fable)

- qa-integration: 전체 흐름 E2E
  - 로그인 -> 파일 뷰어 -> 공유 버튼 클릭 -> Discord 공유 -> 성공 확인
  - 로그인 -> 파일 편집 -> 공유 버튼 클릭 -> Slack 공유 -> 성공 확인
  - 미인증 상태에서 /api/share/notify POST -> 401
  - rate limit 확인: 연속 11회 호출 시 429
  - 경로 traversal 시도 -> 400
  - 존재하지 않는 파일 -> 400
  - 링크 복사 -> 클립보드 + 안내 텍스트
- optimizer: Webhook 호출 타임아웃, 에러 경로 최적화, 불필요한 리렌더 점검

---

## 단계 완료 조건

1. `POST /api/share/notify` Discord Embed 전송 동작
2. `POST /api/share/notify` Slack Block Kit 전송 동작
3. 500(내부 오류)과 502(webhook 실패) 명확히 구분
4. rate limit 적용 (60초/10회, 429 + Retry-After)
5. filePath 경로 검증 (보안 불변식 2)
6. Webhook URL이 응답/클라이언트에 노출되지 않음 (보안 불변식 6)
7. 에러 응답에 내부 정보 없음 (보안 불변식 8)
8. 뷰어/편집 페이지에 공유 버튼 + ShareModal 동작
9. 링크 복사 기능 + 인증 필요 안내 (ADR-004)
10. webhook.ts 유닛 테스트 통과
11. `npm run build` / `typecheck` / `test` / `lint` 통과
12. 검증 리포트 FAIL 0건
