# QA 통합 검증 — Stage 4 (소셜 공유 Discord/Slack Webhook)

- 검증 일시: 2026-07-25
- 검증 에이전트: qa-integration (claude-sonnet-4-6)
- 참조 문서:
  - `docs/plan/stage-4-tasks.md`
  - `docs/agent-work/backend-stage-4-contract.md`
  - `docs/agent-work/frontend-stage-4-contract.md`
  - `docs/valid/backend-stage-4-validation.md` (PASS)
  - `docs/valid/frontend-stage-4-validation.md` (PASS, MINOR 1건)
  - `CLAUDE.md`
- 종합 판정: **PASS (FAIL 0건, KNOWN-ISSUE 2건, UNVERIFIED 1건)**

---

## 종합 판정 근거

8개 보안 불변식 전체 충족. 정적 게이트(typecheck/lint/test/build) 전체 통과. 프론트-백엔드 계약 직렬화 일치. E2E 동선 코드 수준 검증 통과. 단, 서버 미기동으로 런타임 E2E 일부 UNVERIFIED 처리.

---

## 정적 게이트 결과

| 게이트 | 실행 결과 | 판정 |
|--------|-----------|------|
| `npm run typecheck` | 오류 0건 | PASS |
| `npm run lint` | 오류 0건 | PASS |
| `npm test` | 8개 파일, 139건 전체 통과, 실패 0 | PASS |
| `npm run build` | Turbopack 컴파일 성공, `.next/server/app/api/share/notify/` 생성 확인 | PASS |

**빌드 비고**: 빌드 경고 1건(`next.config.ts` NFT tracing — `src/app/api/upload/route.ts` 임포트 체인) 및 `middleware` deprecated 경고 1건은 Stage 1부터 존재하던 기존 알려진 사항으로 Stage 4 신규 변경과 무관. 신규 경고 없음.

---

## 코드 수준 검증 결과

### [T-01] POST /api/share/notify — 세션 보호 (middleware.ts)

- 검증 방법: `src/middleware.ts:33-35` — `PUBLIC_API` 목록에 `{ method: 'POST', pathname: '/api/auth/login' }` 1건만 정의. `POST /api/share/notify`는 목록에 없으므로 세션 검증 대상.
- `middleware.ts:107-109` — 미인증 API 요청은 401 + `ApiError` JSON 반환.
- `middleware.ts:149-151` — 매처는 `_next/static`, `_next/image`, favicon, 정적 확장자만 제외. `/api/share/notify`는 경로에 확장자가 없어 보호 대상에 포함.
- 판정: **PASS**

### [T-02] 경로 traversal 방어 — resolveUnderRoot + assertRealPathUnderRoot

- 검증 방법: `src/app/api/share/notify/route.ts:74-75`
  ```typescript
  absolutePath = resolveUnderRoot(filePath.trim());
  await assertRealPathUnderRoot(absolutePath);
  ```
- 2단 방어 모두 적용. `resolveUnderRoot`는 `../`, 절대경로, URL 인코딩 우회, 제어문자 처리. `assertRealPathUnderRoot`는 심볼릭 링크 탈출까지 검증.
- `path-safety.test.ts` 단독 실행: 53건 전체 통과. traversal 시도 케이스 포함.
- 모든 `path` 파라미터 라우트(files/upload/file-content/thumbnail/share-notify 5개)가 동일 단일 유틸 경유 확인.
- 판정: **PASS**

### [T-03] Rate limit 정책 — 60초/10회, Retry-After

- 검증 방법: `src/lib/rate-limit.ts:57` — `shareNotify: { max: 10, windowSec: 60 }` 정의.
- `src/app/api/share/notify/route.ts:43-48`:
  ```typescript
  const rlKey = rateLimitKeyFor(request, 'share');
  const rl = checkRateLimit(rlKey, RATE_LIMIT_POLICY.shareNotify);
  if (!rl.allowed) {
    return apiError(429, '...', { 'Retry-After': String(rl.retryAfterSec) });
  }
  ```
- 세션 식별자 우선 키, IP 폴백 적용 확인 (`rate-limit.ts:133-137`).
- 판정: **PASS**

### [T-04] 500 vs 502 구분

- 검증 방법: `src/app/api/share/notify/route.ts:105-123`:
  - `sendWebhook`이 `ok=false` + error에 "not configured" 포함 → **400** ("Webhook URL이 설정되지 않았습니다")
  - `sendWebhook`이 `ok=false` + 그 외 error → **502** ("Webhook delivery failed. Please try again.")
  - `sendWebhook` 호출 자체가 throw (예상치 못한 예외) → `internalError()` → **500** ("Internal server error.")
- `webhook.ts`는 절대 throw하지 않으므로(`WebhookResult` 반환 보장), 502는 명확히 "Webhook 전달 실패"를 의미.
- 판정: **PASS**

### [T-05] webhook.ts — `import 'server-only'`

- 검증 방법: `src/lib/webhook.ts:13` — `import 'server-only';` 선언 확인.
- 클라이언트 컴포넌트에서 `webhook.ts`를 임포트하면 빌드 타임에 오류 발생. 빌드 성공이 이를 증명.
- 판정: **PASS**

### [T-06] Webhook URL — 클라이언트 코드 미노출

- 검증 방법: `src/components/`, `src/app/workspace/`에서 `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `NEXT_PUBLIC_` 참조 전무 (grep 결과 0건).
- `src/lib/env.ts:5` — `NEXT_PUBLIC_` 접두사 사용 금지 명시. 전체 `src/`에서 `NEXT_PUBLIC_` 접두사는 주석에만 등장.
- `webhook.ts`의 `WebhookResult.error`에 실제 URL 미포함 확인 (`webhook.ts:115, 136, 144`).
- `webhook.test.ts` 보안 불변식 6 테스트 3건 전체 통과.
- 판정: **PASS**

### [T-07] ShareModal — 기존 Modal 컴포넌트 재사용

- 검증 방법: `src/components/workspace/ShareModal.tsx:14` — `import { Modal } from '@/components/ui/Modal'`.
- `ShareModal.tsx:77` — `<Modal open={open} title="공유하기" onClose={onClose}>` 사용.
- `src/components/ui/Modal.tsx`에 포커스 트랩, Esc 닫기, `aria-modal`, `aria-labelledby` 모두 구현 확인.
- 판정: **PASS**

### [T-08] Copy Link — window.location.href (ADR-004)

- 검증 방법: `src/components/workspace/ShareModal.tsx:66` — `await navigator.clipboard.writeText(window.location.href)`.
- 토큰 기반 공개 링크 또는 별도 공유 URL 생성 없음. 현재 인증된 앱 URL을 복사하는 방식.
- 판정: **PASS**

### [T-09] 인증 필요 안내 텍스트 — ADR-004

- 검증 방법: `src/components/workspace/ShareModal.tsx:128-130`:
  ```tsx
  <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
    공유 링크를 받은 사람도 로그인이 필요합니다.
  </p>
  ```
- 계약(`frontend-stage-4-contract.md §1` 항목 7) 문구와 정확히 일치.
- 판정: **PASS**

### [T-10] 공유 버튼 — 뷰어 페이지 (`view/page.tsx`)

- 검증 방법: `src/app/workspace/view/page.tsx:18` — `import { Share2 } from 'lucide-react'`.
- `view/page.tsx:21` — `import { ShareModal } from '@/components/workspace/ShareModal'`.
- `view/page.tsx:54` — `const [shareOpen, setShareOpen] = useState(false)`.
- `view/page.tsx:123-141` — `flex gap-2` 컨테이너 안에서 공유 버튼(124-132)이 편집 버튼(133-140) 왼쪽에 위치.
- `view/page.tsx:197-202` — `<ShareModal filePath={path} fileName={fileName} open={shareOpen} onClose={...} />` 배치.
- 계약(`frontend-stage-4-contract.md §2`) 일치.
- 판정: **PASS**

### [T-11] 공유 버튼 — 편집 페이지 (`edit/page.tsx`)

- 검증 방법: `src/app/workspace/edit/page.tsx:23` — `import { Share2 } from 'lucide-react'`.
- `edit/page.tsx:27` — `import { ShareModal } from '@/components/workspace/ShareModal'`.
- `edit/page.tsx:58` — `const [shareOpen, setShareOpen] = useState(false)`.
- `edit/page.tsx:234-262` — `flex gap-2` 컨테이너 안에서 공유 버튼(235-243)이 저장 버튼(244-262) 왼쪽에 위치.
- `edit/page.tsx:274-279` — `<ShareModal>` 배치. `ConflictWarning` 아래에 위치.
- 계약(`frontend-stage-4-contract.md §3`) 일치.
- 판정: **PASS**

### [T-12] 에러 처리 — 401 자동 리다이렉트, 429 자동 토스트, 502 재시도 토스트

- 검증 방법:
  - **401**: `src/lib/fetcher.ts:83-89` — `redirectToLogin()` 자동 처리. `ShareModal.tsx`가 `apiFetch` 경유이므로 자동 적용.
  - **429**: `fetcher.ts:97-99` — `emitToast` 자동 처리. `ShareModal.tsx:54` — `err.code !== 429` 분기로 중복 토스트 방지.
  - **502**: `ShareModal.tsx:49-53` — `err.code === 502` 시 `'전송에 실패했습니다. 잠시 후 재시도해 주세요.'` 토스트.
  - **400**: `ShareModal.tsx:54-56` — `err.code !== 401 && err.code !== 429` 조건으로 `err.message` (서버 메시지) 토스트.
- 계약(`frontend-stage-4-contract.md §1` 동작 5) 일치.
- 판정: **PASS**

### [T-13] webhook 유닛 테스트 커버리지

- 검증 방법: `npx vitest run src/lib/webhook.test.ts` — 20건 전체 통과.
- 계약(`backend-stage-4-contract.md §4`)에서 요구한 12종 테스트 케이스 대비 20건 구현.
- 포함 케이스: Discord 204 성공, Slack 200 성공, Content-Type, embeds 배열, blocks 배열, 비2xx 응답, 네트워크 오류, URL 미설정("not configured"), 타임아웃 시뮬레이션, throw 없음 보장, 보안 불변식 6 (URL 미포함) 3건, AbortSignal 전달.
- 판정: **PASS**

---

## 보안 불변식 전체 점검

| # | 불변식 | 검증 위치 | 판정 |
|---|--------|-----------|------|
| 1 | 세션 보호 — 모든 라우트 (login POST 제외) | `middleware.ts:33-35, 86-124` — PUBLIC_API 1건, 나머지 전부 세션 검증 | PASS |
| 2 | 경로 traversal 방어 — 단일 유틸 경유 | `route.ts:74-75` (resolveUnderRoot + assertRealPathUnderRoot). 5개 path 라우트 전부 적용 확인 | PASS |
| 3 | 업로드 검증 (크기/확장자/파일명) — 회귀 없음 | Stage 1-3 산출물 무변경. `upload/route.ts` 미수정 | PASS |
| 4 | Atomic write — 회귀 없음 | Stage 1-3 산출물 무변경. Stage 4는 `fs.stat()` 읽기만 수행, 쓰기 없음 | PASS |
| 5 | 편집 충돌 409 — 회귀 없음 | Stage 2 산출물 무변경. `file-content/route.ts` 미수정 | PASS |
| 6 | Webhook URL 클라이언트 미노출 | `webhook.ts:13` (`import 'server-only'`), 클라이언트 코드 grep 0건, NEXT_PUBLIC_ 없음 | PASS |
| 7 | Rate limit — upload/share/notify | `RATE_LIMIT_POLICY.shareNotify: { max: 10, windowSec: 60 }`, `route.ts:43-48` | PASS |
| 8 | 내부 오류 미노출 | `internalError()`는 `console.error` + `"Internal server error."` 반환. 에러 바디에 경로/스택트레이스 없음. `webhook.ts`의 `result.error`는 클라이언트 응답에 직접 포함되지 않음 | PASS |

---

## 통합 관점 검증 (개별 검증이 놓치는 지점)

### [I-01] 프론트-백엔드 직렬화 일치

- **요청 페이로드**: `ShareModal.tsx:41` — `JSON.stringify({ target, filePath })`.
- **백엔드 파싱**: `route.ts:54, 59` — `body = await request.json()`, `const { target, filePath } = body`.
- `target`의 TypeScript 타입: 프론트 `ShareTarget` (`'discord' | 'slack'`), 백엔드 `ShareTarget` (동일). 공유 모듈 `src/types/api.ts:20`에서 단일 정의.
- `filePath`의 형식: 프론트는 URL 쿼리 `path` 값을 그대로 사용(`ShareModal.tsx`에 filePath prop으로 전달, 뷰어/편집 페이지에서 `searchParams.get('path')`). 백엔드는 `filePath.trim()`으로 받아 `resolveUnderRoot` 적용. MARKDOWN_ROOT 기준 상대 경로라는 전제가 양쪽 모두 일치.
- **응답 페이로드**: 백엔드 `{ ok: true, target }`, 프론트 `ShareNotifyResponse` 타입 — 동일 모듈에서 import. 직렬화 드리프트 없음.
- 판정: **PASS**

### [I-02] 에러 코드가 백엔드에서 프론트 UI 메시지까지 끝까지 전달되는가

- 백엔드는 `apiError(code, message)` 형태의 `ApiError` JSON을 반환. 구조: `{ code: number, message: string }`.
- `fetcher.ts:134-138` — 응답 바디를 파싱 후 `code`와 `message`를 추출해 `ApiRequestError(code, message)` throw.
- `ShareModal.tsx:47-57` — `toApiRequestError(caught)`로 정규화 후 `err.code`로 분기:
  - 502 → "전송에 실패했습니다. 잠시 후 재시도해 주세요."
  - 401 → fetcher가 자동 리다이렉트
  - 429 → fetcher가 자동 토스트
  - 나머지(400 포함) → `err.message` (서버 메시지) 그대로 토스트
- 400 "Webhook URL이 설정되지 않았습니다" 메시지가 toast로 표시되는 경로가 완전히 연결됨.
- 판정: **PASS**

### [I-03] Webhook URL이 응답 body에 절대 포함되지 않는 경로 추적

- `sendWebhook` → `WebhookResult.error` 문자열에는 URL 미포함 (`webhook.ts:115, 136, 144` 각각 target 이름 + 상태코드 + 오류메시지만).
- `route.ts:111` — `console.error`에만 `result.error` 기록.
- `route.ts:115` — 클라이언트에게는 `apiError(400, '${target} webhook URL is not configured.')` — URL 값 없음.
- `route.ts:117` — `apiError(502, 'Webhook delivery failed. Please try again.')` — URL 없음.
- 클라이언트 UI까지 Webhook URL이 노출되는 경로 없음.
- 판정: **PASS**

### [I-04] appUrl 구성 — MARKDOWN_ROOT 절대 경로 미포함 확인

- `route.ts:98-99`:
  ```typescript
  const subpath = toSubpath(absolutePath);  // 절대경로 → 상대경로 변환
  const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`;
  ```
- `toSubpath()`는 `MARKDOWN_ROOT`를 제거하고 상대 경로만 반환 (`path-safety.ts:234-244`). Webhook 메시지에 서버 파일시스템 절대 경로가 포함되지 않음.
- 판정: **PASS**

---

## E2E 해피패스 시나리오 (코드 수준)

아래는 서버 미기동 상태로 코드 수준에서 추적한 결과입니다.

### 시나리오 A: 뷰어 페이지 → Discord 공유

1. **로그인**: `POST /api/auth/login` (무인증 허용 라우트) → httpOnly 세션 쿠키 발급.
2. **뷰어 열기**: `GET /api/file-content?path=foo.md` → middleware 세션 검증 → `{ content, mtime }` 반환.
3. **공유 버튼 클릭**: `view/page.tsx:126` — `setShareOpen(true)` → `ShareModal` 열림.
4. **Discord 버튼 클릭**: `ShareModal.tsx:89` — `handleShare('discord')` → `setSending('discord')` → Discord 버튼 스피너 표시, 세 버튼 비활성화.
5. **API 호출**: `apiFetch('/api/share/notify', { method: 'POST', body: '{"target":"discord","filePath":"foo.md"}' })`.
6. **백엔드 처리**: rate limit 확인 → target 검증 → filePath 검증 → resolveUnderRoot → assertRealPathUnderRoot → fs.stat → appUrl 구성 → sendWebhook('discord', payload) → Discord Webhook POST → 응답 2xx → `{ ok: true, target: 'discord' }` 반환.
7. **프론트 수신**: `emitToast({ message: 'Discord에 공유되었습니다.', variant: 'success' })` → `setSending(null)`.

코드 경로 완전 추적 가능. 차단 지점 없음.

### 시나리오 B: 편집 페이지 → Slack 공유

뷰어와 동일 흐름. `edit/page.tsx:237` → `ShareModal` → `handleShare('slack')` → `POST /api/share/notify { target: 'slack', filePath }` → `{ ok: true, target: 'slack' }` → "Slack에 공유되었습니다." 토스트.

### 시나리오 C: 미인증 공유 시도

`POST /api/share/notify` 세션 쿠키 없이 → `middleware.ts:107-109` → 401 `{ code: 401, message: 'Authentication required.' }` → `fetcher.ts:93-94` → `redirectToLogin()` → `/login?next=...` 리다이렉트.

### 시나리오 D: Webhook URL 미설정

`sendWebhook` → `env.DISCORD_WEBHOOK_URL === undefined` → `{ ok: false, error: 'discord webhook URL is not configured.' }` → `route.ts:114-115` → `apiError(400, 'discord webhook URL is not configured.')` → 프론트 `err.message` 토스트.

---

## UNVERIFIED 항목

| # | 항목 | 이유 |
|---|------|------|
| U-01 | 실제 Discord/Slack Webhook 전송 성공 확인 | 서버 미기동 + 실제 Webhook URL 미설정 환경. 유닛 테스트(mock fetch)로 페이로드 형식 검증 완료. 실제 네트워크 전송은 런타임 환경 필요 |

---

## KNOWN-ISSUE (FAIL 수준 아님)

### [KI-01] 링크 복사 버튼 disabled 시각적 피드백 누락 (frontend-stage-4-validation.md MINOR 이어받기)

- 파일: `src/components/workspace/ShareModal.tsx:120`
- 현상: Discord 버튼(라인 90), Slack 버튼(라인 105)에는 `disabled:cursor-not-allowed disabled:opacity-60` CSS 클래스가 있으나, 링크 복사 버튼(라인 120)에는 미적용.
- 기능 동작: `disabled={sending !== null}` HTML 속성은 있어 전송 중 클릭 차단은 정상.
- 영향: 시각적 일관성만 결여. 접근성·기능 모두 정상.
- 계약 대조: `frontend-stage-4-contract.md §스타일` — 링크 복사 버튼 클래스 명세에 `disabled:` 수식어 누락. 계약과 구현 모두 동일하게 누락.
- 판정: FAIL 아님. `backlog.md P2-19`에 이미 기록됨.

### [KI-02] x-forwarded-proto 헤더 스키마 미검증

- 파일: `src/app/api/share/notify/route.ts:96`
- 현상: `const proto = request.headers.get('x-forwarded-proto') || 'https'` — proto를 `'https'`/`'http'`로만 허용하지 않아, 인증된 사용자가 `javascript:`, `file:` 등 위험 스키마를 Webhook 메시지의 appUrl에 삽입 가능.
- 위협 범위: **인증된 사용자로 제한**. 인증되지 않은 공격자는 이 라우트에 접근 불가. Webhook 메시지 수신자 환경(Discord/Slack 클라이언트)이 해당 URL을 클릭 시 위험 발생 가능.
- 보안 불변식 대조: CLAUDE.md §보안 불변식 8개 목록에 직접 명시된 항목은 아님. 그러나 보안 심층 방어 측면에서 P1 우선순위로 수정 권고.
- 수정 방법: `route.ts:96` 한 줄 추가 — `const proto = ['https', 'http'].includes(rawProto ?? '') ? rawProto! : 'https'`
- 판정: FAIL 아님 (보안 불변식 8개 목록 외 항목). `backlog.md P1-20`에 이미 기록됨.

---

## 보안 불변식 8개 완료 조건 최종 체크

| # | 불변식 | 충족 여부 |
|---|--------|-----------|
| 1 | login POST 제외 모든 라우트 세션 보호 | 충족 |
| 2 | 모든 path 파라미터 단일 유틸 경유 | 충족 |
| 3 | 업로드 검증 회귀 없음 | 충족 |
| 4 | Atomic write 회귀 없음 | 충족 |
| 5 | 편집 충돌 409 회귀 없음 | 충족 |
| 6 | SESSION_SECRET/Webhook URL 클라이언트 미노출 | 충족 |
| 7 | upload/share-notify rate limit | 충족 |
| 8 | 내부 오류/스택트레이스 클라이언트 미노출 | 충족 |

**8개 불변식 전체 충족. 미충족 없음.**

---

## Stage 4 단계 완료 조건 최종 점검

| # | 완료 조건 | 판정 |
|---|-----------|------|
| 1 | `POST /api/share/notify` Discord Embed 전송 | PASS (유닛 테스트 20건 + 코드 검증) |
| 2 | `POST /api/share/notify` Slack Block Kit 전송 | PASS (유닛 테스트 20건 + 코드 검증) |
| 3 | 500(내부 오류)과 502(webhook 실패) 명확히 구분 | PASS |
| 4 | rate limit 적용 (60초/10회, 429 + Retry-After) | PASS |
| 5 | filePath 경로 검증 (보안 불변식 2) | PASS |
| 6 | Webhook URL이 응답/클라이언트에 노출되지 않음 (불변식 6) | PASS |
| 7 | 에러 응답에 내부 정보 없음 (불변식 8) | PASS |
| 8 | 뷰어/편집 페이지에 공유 버튼 + ShareModal 동작 | PASS |
| 9 | 링크 복사 기능 + 인증 필요 안내 (ADR-004) | PASS |
| 10 | webhook.ts 유닛 테스트 통과 (20건) | PASS |
| 11 | `npm run build` / `typecheck` / `test` / `lint` 통과 | PASS |
| 12 | 검증 리포트 FAIL 0건 | PASS |

---

## 종합 판정: PASS

Stage 4 단계 완료 조건 12개 전부 충족. 보안 불변식 8개 전부 충족. FAIL 항목 없음. KNOWN-ISSUE 2건은 기능 정상 동작 하에 발견된 개선 권고 사항으로 이미 `backlog.md`에 기록되어 있음.

Stage 4 완료. Stage 5(업로드 완료 알림) 착수 가능.
