# 백엔드 검증 — Stage 4

- 검증 일시: 2026-07-25
- 검증 에이전트: backend-validator (Sonnet 4.6)
- 대상 파일:
  - `src/lib/webhook.ts`
  - `src/app/api/share/notify/route.ts`
  - `src/lib/webhook.test.ts`
  - `src/lib/env.ts` (Webhook URL 환경변수)
  - `src/lib/rate-limit.ts` (shareNotify 정책)
  - `src/middleware.ts` (세션 보호)
  - `src/lib/path-safety.ts` (경로 안전 유틸)
  - `src/lib/api-response.ts` (에러 응답 헬퍼)
  - `src/types/api.ts` (공유 타입)
- 종합 판정: **PASS** (FAIL 0건)

---

## 정적 게이트 결과

| 게이트 | 결과 | 비고 |
|--------|------|------|
| `npm run typecheck` | 오류 0 | PASS |
| `npm run lint` | 오류 0 | PASS |
| `npm test` | 139건 전체 통과 (8파일, 실패 0) | PASS |
| `npm run build` | 성공 | PASS (NFT tracing 경고 1건은 Stage 1부터 존재하던 기존 알려진 사항) |

---

## 엔드포인트별 계약 대조표

| 엔드포인트 | 인증 | 경로검증 | 상태코드 | `runtime` | 판정 |
|-----------|------|---------|---------|-----------|------|
| `POST /api/share/notify` | middleware 세션 (불변식 1) | `resolveUnderRoot` + `assertRealPathUnderRoot` (`route.ts:74-75`) | 200/400/401/429/500/502 | `'nodejs'` (`route.ts:37`) | PASS |

### 상태코드 계약 이행 상세

| 코드 | 조건 | 구현 위치 | 판정 |
|------|------|-----------|------|
| 200 | 전송 성공 | `route.ts:120-121` | PASS |
| 400 | target 무효 | `route.ts:62-64` | PASS |
| 400 | filePath 미지정/빈문자열 | `route.ts:67-69` | PASS |
| 400 | 경로 검증 실패 (traversal 등) | `route.ts:76-81` | PASS |
| 400 | 파일이 디렉터리인 경우 | `route.ts:87-89` | PASS |
| 400 | 파일 미존재 | `route.ts:91-93` | PASS |
| 400 | Webhook URL 미설정 | `route.ts:114-116` | PASS |
| 401 | 미인증 | `middleware.ts:106-110` | PASS |
| 429 | Rate limit 초과 | `route.ts:45-49` + `Retry-After` 헤더 | PASS |
| 500 | 내부 오류 | `route.ts:123` (`internalError` 경유) | PASS |
| 502 | Webhook 전달 실패 | `route.ts:117` | PASS |

---

## 보안 불변식 대조표

| # | 불변식 | 강제 위치 (파일:라인) | 판정 |
|---|--------|---------------------|------|
| 1 | 세션 보호 — `/api/auth/login` POST 제외 전체 | `middleware.ts:33-35` (PUBLIC_API 목록), `middleware.ts:86-124` (인증 검증 로직) | PASS |
| 2 | 경로 안전 단일 유틸 경유 | `route.ts:74-75` (`resolveUnderRoot` + `assertRealPathUnderRoot`) | PASS |
| 6 | Webhook URL 비노출 | `webhook.ts:13` (`import 'server-only'`), `webhook.ts:115` (error 메시지에 URL 미포함), `route.ts:115` (응답에 URL 미포함) | PASS |
| 7 | Rate limit | `rate-limit.ts:57` (`shareNotify: { max: 10, windowSec: 60 }`), `route.ts:43-49` | PASS |
| 8 | 내부 정보 비노출 | `api-response.ts:27-30` (`internalError`는 서버 로깅만), `route.ts` 전체 에러가 `apiError`/`internalError` 경유 | PASS |

---

## 검증 항목별 상세 결과

### 1. `export const runtime = 'nodejs'` 선언

`src/app/api/share/notify/route.ts:37`에 `export const runtime = 'nodejs';` 선언 확인. `webhook.ts`는 `fs`, `sharp`, `sqlite`를 직접 쓰지 않지만 `getServerEnv()`(서버 전용)를 사용하며 Node.js 내장 `fetch`가 필요하므로 nodejs 런타임이 올바르다.

판정: **PASS**

### 2. 세션 인증 — middleware 보호 범위

`src/middleware.ts:33-35`에서 `PUBLIC_API`는 `{ method: 'POST', pathname: '/api/auth/login' }` 1건만 정의. `POST /api/share/notify`는 이 목록에 없으므로 middleware의 세션 검증을 통과해야 한다. 미인증 API 요청은 `middleware.ts:107-109`에서 401 반환. middleware 매처(`middleware.ts:148-151`)는 `_next/static`, `_next/image`, favicon, 정적 확장자만 제외하며 `/api/share/notify`는 보호 대상에 포함된다.

판정: **PASS**

### 3. 요청 바디 검증

- `target`: `VALID_TARGETS.has(target as ShareTarget)` (`route.ts:62`) — 'discord'/'slack' 외 값은 400 반환. `VALID_TARGETS`는 `new Set<ShareTarget>(['discord', 'slack'])` (`route.ts:39`).
- `filePath`: `!filePath || typeof filePath !== 'string' || filePath.trim() === ''` (`route.ts:67`) — 누락, 비문자열, 빈 문자열 모두 400.
- JSON 파싱 실패: `route.ts:53-57` catch 블록에서 400 반환.

판정: **PASS**

### 4. 경로 안전 (보안 불변식 2)

`route.ts:74-75`:
```typescript
absolutePath = resolveUnderRoot(filePath.trim());
await assertRealPathUnderRoot(absolutePath);
```

2단 방어가 모두 적용되어 있다. `resolveUnderRoot`는 문자열 수준(`../`, 절대경로, 인코딩 traversal, 제어문자)을 처리하고 `assertRealPathUnderRoot`는 심볼릭 링크까지 해석한다. `path-safety.ts`는 단일 구현이며 files/upload/file-content/thumbnail/share-notify 5개 라우트가 모두 이를 경유한다. (`grep` 결과 확인: 모든 5개 라우트에서 `resolveUnderRoot` + `assertRealPathUnderRoot` 임포트 및 호출 확인.)

판정: **PASS**

### 5. Rate limit (보안 불변식 7)

`rate-limit.ts:57`: `shareNotify: { max: 10, windowSec: 60 }` 정의 확인. `route.ts:43-44`:
```typescript
const rlKey = rateLimitKeyFor(request, 'share');
const rl = checkRateLimit(rlKey, RATE_LIMIT_POLICY.shareNotify);
```
429 응답에 `Retry-After` 헤더 포함: `route.ts:47-48`.

판정: **PASS**

### 6. 보안 불변식 6 — Webhook URL 비노출

세 층위에서 검증:
1. `webhook.ts:13`: `import 'server-only'` 선언으로 클라이언트 번들 포함 차단.
2. `webhook.ts:115`: URL 미설정 에러 메시지는 `${target} webhook URL is not configured.`이며 실제 URL 값 미포함.
3. `webhook.ts:136-137`: 비2xx 응답 에러 메시지는 `${target} webhook returned ${status}: ${text.slice(0, 200)}`이며 URL 미포함.
4. `webhook.ts:144`: 네트워크 오류 메시지는 `${target} webhook fetch failed: ${message}`이며 `err.message`는 URL이 아닌 오류 설명.
5. `route.ts:115`: 클라이언트 응답에는 `"${target} webhook URL is not configured."`만 포함.
6. `env.ts:23-24`에서 Webhook URL은 `DISCORD_WEBHOOK_URL?`, `SLACK_WEBHOOK_URL?`(optional)이며 `NEXT_PUBLIC_` 접두사 없음. 프로젝트 전체에서 `NEXT_PUBLIC_` 변수 없음 확인.
7. webhook.test.ts의 보안 불변식 6 테스트 3건 모두 통과 (테스트:282-318).

판정: **PASS**

### 7. 보안 불변식 8 — 내부 정보 비노출

모든 에러 응답이 `apiError(code, message)` 또는 `internalError(prefix, error)` 경유. `internalError`는 `console.error`로 서버 로깅 후 `500 + "Internal server error."` 반환(스택트레이스 미포함). `apiError`의 `message`는 구현자가 직접 작성한 사용자 친화적 메시지이며 절대 경로, 스택트레이스, Webhook URL 미포함.

`webhook.ts`에서 `WebhookResult.error`는 서버 내부 로깅(`console.error`)에만 사용되며 클라이언트 응답 바디에 직접 포함되지 않음 (`route.ts:111`: `console.error`, `route.ts:115-117`: `apiError`로 변환).

판정: **PASS**

### 8. Discord Embed 형식

`webhook.ts:46-59` (`buildDiscordPayload`):
```typescript
{
  embeds: [{
    title: payload.fileName,
    description: `경로: \`${payload.filePath}\``,
    url: payload.appUrl,
    color: 0x5865f2,
    timestamp: new Date(payload.mtime).toISOString(),
    footer: { text: 'MD Workspace' },
  }],
}
```

계약(`backend-stage-4-contract.md §1.2`)과 완전히 일치. 테스트(`webhook.test.ts:93-104`)에서 모든 필드 검증 통과.

판정: **PASS**

### 9. Slack Block Kit 형식

`webhook.ts:63-87` (`buildSlackPayload`):
```typescript
{
  blocks: [
    { type: 'section', text: { type: 'mrkdwn', text: `*<URL|파일명>*\n경로: ...\n수정일: ...` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: ':memo: MD Workspace' }] },
  ],
}
```

계약(`backend-stage-4-contract.md §1.3`)과 완전히 일치. 테스트(`webhook.test.ts:111-139`)에서 section, context 블록 검증 통과.

판정: **PASS**

### 10. sendWebhook 타임아웃 및 에러 처리

`webhook.ts:94`: `const WEBHOOK_TIMEOUT_MS = 10_000;`
`webhook.ts:128`: `signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)`

네트워크 오류와 비2xx 응답 모두 catch 블록에서 `{ ok: false, error: "..." }` 반환 (`webhook.ts:141-145`). 절대 throw하지 않는 설계 확인. 테스트(`webhook.test.ts:325-337`)에서 `AbortSignal` 인스턴스 전달 확인.

판정: **PASS**

### 11. 유닛 테스트 커버리지

`webhook.test.ts` 20건 전체 통과 (개별 실행 확인):

| # | 그룹 | 테스트명 | 결과 |
|---|------|---------|------|
| 1 | buildDiscordPayload | embeds 배열 포함 | PASS |
| 2 | buildDiscordPayload | 필수 필드 (title/description/url/color/timestamp/footer) | PASS |
| 3 | buildSlackPayload | blocks 배열 포함 | PASS |
| 4 | buildSlackPayload | section block 파일명/경로/수정일 | PASS |
| 5 | buildSlackPayload | context block MD Workspace | PASS |
| 6 | sendWebhook 성공 | Discord 204 | PASS |
| 7 | sendWebhook 성공 | Slack 200+"ok" | PASS |
| 8 | sendWebhook 성공 | Content-Type application/json | PASS |
| 9 | 페이로드 전달 | Discord embeds 배열 | PASS |
| 10 | 페이로드 전달 | Slack blocks 배열 | PASS |
| 11 | 실패 | 비2xx 응답 ok=false | PASS |
| 12 | 실패 | 네트워크 오류 ok=false | PASS |
| 13 | 실패 | Discord URL 미설정 "not configured" | PASS |
| 14 | 실패 | Slack URL 미설정 "not configured" | PASS |
| 15 | 실패 | 타임아웃 처리 | PASS |
| 16 | 실패 | throw 없이 ok=false 반환 | PASS |
| 17 | 불변식 6 | 에러에 Webhook URL 미포함 | PASS |
| 18 | 불변식 6 | 네트워크 오류에도 URL 미포함 | PASS |
| 19 | 불변식 6 | fetch는 URL 사용, 에러에는 미포함 | PASS |
| 20 | AbortSignal | signal 옵션 전달 | PASS |

계약(`backend-stage-4-contract.md §4`)에서 요구한 12종 테스트 케이스 대비 20건이 구현되어 있으며, 모든 필수 항목이 포함됨.

판정: **PASS**

### 12. 500 vs 502 구분

`route.ts:105-124`:
- `sendWebhook`이 `ok=false`이고 `error`에 "not configured" 포함 → 400
- `sendWebhook`이 `ok=false`이고 그 외 → 502
- `sendWebhook` 호출 자체가 throw (예상치 못한 예외) → `internalError` 경유 → 500

판정: **PASS**

### 13. 앱 URL 구성 (D4-2)

`route.ts:96-99`:
```typescript
const proto = request.headers.get('x-forwarded-proto') || 'https';
const host = request.headers.get('host') || 'localhost:3000';
const subpath = toSubpath(absolutePath);
const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`;
```

계약(`backend-stage-4-contract.md §3`)과 일치. `toSubpath`로 절대 경로를 상대 경로로 변환해 파일시스템 구조 노출 방지.

판정: **PASS**

### 14. 스코프 드리프트 검사

`package.json`과 `src/` 전체에서 `basic-ftp`, `ftps`, `kakao` 참조 없음. `ShareTarget`은 'discord'|'slack'만 정의 (`types/api.ts:20`). 카카오 관련 코드 없음.

판정: **PASS**

### 15. os.homedir() 하드코딩 폴백

`env.ts:6` 주석으로 명시적 금지 선언. 구현 전체(`getServerEnv` 함수)에서 `os.homedir()`이나 `path.join(homedir(), ...)` 패턴 없음.

판정: **PASS**

---

## 주의 사항 (FAIL 아님)

### W-1. 썸네일 캐시 쓰기가 atomic write가 아님

`src/app/api/thumbnail/route.ts:116`: `await fs.writeFile(cachePath, buffer);`를 임시 파일 → rename 없이 직접 사용.

그러나 이는 보안 불변식 4의 적용 범위("업로드와 에디터 저장")에 해당하지 않는다. 썸네일 캐시는 파생 데이터이며 실패 시 원본 이미지에서 재생성 가능하다. 계약과 CLAUDE.md에서도 썸네일 캐시에 대한 atomic write 요구가 없으며, `thumbnail/route.ts:117-120` 주석에서 "캐시 저장 실패는 응답에 영향을 주지 않는다"로 명시됨. Stage 1-3 검증에서도 동일 패턴이 PASS 판정되었음.

권고: 현재 구현 유지. FAIL 아님.

### W-2. webhook.ts에서 URL이 포함될 수 있는 간접 경로 이론적 검토

`webhook.ts:136-137`: 비2xx 응답 에러에 `text.slice(0, 200)`이 포함된다. Webhook 서버(Discord/Slack)가 응답 바디에 요청 URL을 반영해 돌려보낼 가능성이 이론적으로 존재하나, 실제로 Discord/Slack Webhook API는 그런 응답을 반환하지 않는다. 또한 이 `error` 값은 서버 `console.error` 로깅에만 사용되며 클라이언트 응답 바디에 포함되지 않는다 (`route.ts:111-117`). 따라서 보안 불변식 6 위반이 아님.

---

## FAIL 상세

없음. 모든 검증 항목 PASS.

---

## Stage 4 단계 완료 조건 점검

| # | 조건 | 상태 |
|---|------|------|
| 1 | `POST /api/share/notify` Discord Embed 전송 | PASS |
| 2 | `POST /api/share/notify` Slack Block Kit 전송 | PASS |
| 3 | 500(내부 오류)과 502(webhook 실패) 명확히 구분 | PASS |
| 4 | rate limit 적용 (60초/10회, 429 + Retry-After) | PASS |
| 5 | filePath 경로 검증 (보안 불변식 2) | PASS |
| 6 | Webhook URL이 응답/클라이언트에 노출되지 않음 (불변식 6) | PASS |
| 7 | 에러 응답에 내부 정보 없음 (불변식 8) | PASS |
| 8 | webhook.ts 유닛 테스트 통과 (20건) | PASS |
| 9 | `npm run build` / `typecheck` / `test` / `lint` 통과 | PASS |
| 10 | 검증 리포트 FAIL 0건 | PASS |

항목 8 (뷰어/편집 페이지 공유 버튼 + ShareModal), 9 (링크 복사 기능 + ADR-004 안내)는 프론트엔드 범위이므로 frontend-validator가 검증한다.
