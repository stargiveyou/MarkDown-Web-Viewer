# 백엔드 검증 -- Stage 5 (업로드 완료 알림)

- 검증 일시: 2026-07-25
- 검증 에이전트: `backend-validator` (opus)
- 대상 파일 범위:
  - `src/app/api/upload/route.ts` (수정)
  - `src/app/api/share/notify/route.ts` (수정)
  - `src/app/api/upload/upload-notification.test.ts` (신규)
  - `src/lib/webhook.ts` (변경 없음 확인 대상)
  - `src/types/api.ts` (변경 없음 확인 대상)
- 종합 판정: **PASS** (FAIL 항목 0건)

---

## CI 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 -- PASS |
| `npm test` | 160/160 통과 (9 파일) -- PASS |
| `npm run lint` | 오류 0 -- PASS |
| `npm run build` | 성공 (빌드 경고 1건: middleware deprecated, 동작 무관) -- PASS |

---

## Stage 5 체크리스트 대조표

| # | 검증 항목 | 판정 | 근거 |
|---|-----------|------|------|
| 1 | `npm run typecheck` 오류 0 | PASS | CI 결과 참조 |
| 2 | `npm test` 전체 통과 | PASS | 160/160 |
| 3 | `npm run lint` 오류 0 | PASS | CI 결과 참조 |
| 4 | `npm run build` 성공 | PASS | CI 결과 참조 |
| 5 | Webhook URL 설정 시 `notified: true` | PASS | `upload/route.ts:306-307` -- `results.some(r => r.status === 'fulfilled' && r.value.ok)` 판정. 테스트 `upload-notification.test.ts:211-229` 검증 |
| 6 | Webhook URL 미설정 시 `notified: false` | PASS | `upload/route.ts:277` -- `let notified = false` 초기화, `targets.length === 0`이면 블록 미진입. 테스트 `upload-notification.test.ts:231-242` 검증 |
| 7 | Webhook 실패 시 업로드 200 유지 | PASS | `upload/route.ts:276-320` -- 알림 로직이 업로드 성공 응답 전에 `try/catch` 내부, 200 반환 `route.ts:322-323`은 알림 블록 밖. 테스트 `upload-notification.test.ts:244-265` 검증 |
| 8 | Discord + Slack 병렬 발송 | PASS | `upload/route.ts:303-305` -- `Promise.allSettled(targets.map(...))` 사용. 테스트 `upload-notification.test.ts:267-285` (Discord 성공+Slack 실패), `307-321` (둘 다 성공) 검증 |
| 9 | proto 화이트리스트 (/api/upload) | PASS | `upload/route.ts:79-83` -- `sanitizeProto()` 정의. `'http'`/`'https'`만 허용, 그 외 `'https'` 반환. 테스트 `upload-notification.test.ts:30-78` (12개 경계값) 검증 |
| 10 | proto 화이트리스트 (/api/share/notify) | PASS | `share/notify/route.ts:45-49` -- 동일 `sanitizeProto()` 정의. `route.ts:106`에서 호출. P1-20 해소 |
| 11 | 기존 보안 불변식 유지 | PASS | 아래 보안 불변식 대조표 참조 |
| 12 | `runtime = 'nodejs'` on upload | PASS | `upload/route.ts:50` -- `export const runtime = 'nodejs'` |
| 13 | Webhook URL 응답 비노출 | PASS | `upload/route.ts:322` -- 응답 `{ ok, files, notified }`. URL 문자열 미포함. 테스트 `upload-notification.test.ts:323-335` 검증 |
| 14 | 에러 응답 내부 정보 비노출 | PASS | 모든 에러 경로가 `apiError()` 또는 `internalError()` 경유 (`api-response.ts:27-29` -- 스택트레이스는 `console.error`만). 알림 실패는 `console.error`로만 로깅 (`upload/route.ts:311-314`) |
| 15 | `sendWebhook` import from server-only module | PASS | `upload/route.ts:42` -- `import { sendWebhook, type WebhookPayload } from '@/lib/webhook'`. `webhook.ts:13` -- `import 'server-only'` 선언 |

---

## 변경 범위 무결성 확인

| 파일 | 기대 | 실제 | 판정 |
|------|------|------|------|
| `src/lib/webhook.ts` | Stage 5에서 변경 없음 | git status: 새 파일(Stage 4 산출물), Stage 5 diff 없음 | PASS |
| `src/types/api.ts` | Stage 5에서 변경 없음 | git diff: `SortKey`에 `'ctime'` 추가 + `ApiErrorCode`에 `500` 추가 = Stage 3/4 변경분. Stage 5 관련 변경 없음. `UploadResponse.notified: boolean`은 Stage 0부터 존재 | PASS |

---

## 엔드포인트별 계약 대조표

| 엔드포인트 | 인증 | 경로검증 | 상태코드 | 판정 |
|-----------|------|---------|---------|------|
| POST /api/auth/login | 미들웨어 예외 (`middleware.ts:33-35`) | N/A | 200/400/401/429 | PASS |
| POST /api/auth/logout | 미들웨어 보호 (`middleware.ts:102-104`) | N/A | 200/401 | PASS |
| GET /api/files | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`files/route.ts:79-80`) | 200/400 | PASS |
| GET /api/search | 미들웨어 보호 | FTS5 색인 경유 (fs 직접 접근 없음) | 200/400/500 | PASS |
| GET /api/tags | 미들웨어 보호 | FTS5 색인 경유 | 200/500 | PASS |
| GET /api/file-content | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`file-content/route.ts:47-48`) | 200/400/500 | PASS |
| PUT /api/file-content | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`file-content/route.ts:111-112`) | 200/400/409/500 | PASS |
| POST /api/upload | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`upload/route.ts:215-216, 233-234, 242`) | 200/400/413/415/429 | PASS |
| GET /api/thumbnail | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`thumbnail/route.ts:62-63`) | 200/400/500 | PASS |
| POST /api/share/notify | 미들웨어 보호 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`share/notify/route.ts:84-85`) | 200/400/429/502 | PASS |

---

## 보안 불변식 대조표

| # | 불변식 | 강제 위치(파일:라인) | 판정 |
|---|--------|---------------------|------|
| 1 | 세션 보호 (login 외 전부) | `middleware.ts:86-134` -- 모든 요청에 `verifySessionCookie()` 실행. `PUBLIC_API` = login만 | PASS |
| 2 | 경로 안전 단일 유틸 | `path-safety.ts` 단일 모듈. files(:79-80), upload(:215-216, 233-234, 242), file-content(:47-48, 111-112), thumbnail(:62-63), share/notify(:84-85) 전부 경유 | PASS |
| 3 | 업로드 검증: 크기(413)/확장자(415)/새니타이즈 | `upload/route.ts:221-230` -- 크기 `UPLOAD_MAX_BYTES`, 확장자 `ALLOWED_EXTENSIONS`, `sanitizeFilename()` | PASS |
| 4 | Atomic write | 업로드: `writeFileAtomically()` (`upload/route.ts:135-167` -- 임시파일 -> fsync -> rename). 에디터: `file-content/route.ts:137-160` -- 동일 패턴 | PASS |
| 5 | baseMtime 충돌 감지 -> 409 | `file-content/route.ts:127-135` -- `currentMtime !== baseMtime` -> 409 + `SaveConflictResponse` | PASS |
| 6 | 시크릿 비노출 | Webhook URL: `upload/route.ts:280-281`에서 존재 여부만 확인, 응답에 미포함. `SESSION_SECRET`: `session.ts:75-76` 내부 전용. `env.ts:11` -- `import 'server-only'` | PASS |
| 7 | Rate limit (upload + share/notify) | upload: `upload/route.ts:174-179`. share/notify: `share/notify/route.ts:53-59` | PASS |
| 8 | 내부 정보 비노출 | 모든 에러 응답이 `apiError()` / `internalError()` 경유. `api-response.ts:27-29` -- 500 응답은 고정 메시지만. 스택트레이스는 `console.error`만 | PASS |

---

## Stage 5 고유 검증 상세

### 1. sanitizeProto 구현 일치 확인

두 라우트 파일에 동일 로직이 로컬 정의되어 있다.

- `upload/route.ts:79-83`:
  ```typescript
  function sanitizeProto(raw: string | null): string {
    const lower = (raw ?? '').toLowerCase().trim();
    if (lower === 'http' || lower === 'https') return lower;
    return 'https';
  }
  ```

- `share/notify/route.ts:45-49`: 동일 구현

설계 결정에 따라 2줄짜리 함수를 별도 모듈로 추출하지 않고 각 파일에 로컬 정의한다. 로직 동일성 확인 완료.

### 2. Promise.allSettled 병렬 발송 확인

`upload/route.ts:303-305`:
```typescript
const results = await Promise.allSettled(
  targets.map((t) => sendWebhook(t, payload)),
);
```

`targets` 배열은 `upload/route.ts:279-281`에서 설정된 채널만 추가:
```typescript
const targets: ShareTarget[] = [];
if (env.DISCORD_WEBHOOK_URL) targets.push('discord');
if (env.SLACK_WEBHOOK_URL) targets.push('slack');
```

병렬 발송이 정상적으로 구현되어 있다. `Promise.allSettled`는 개별 실패가 다른 결과에 영향을 주지 않는다.

### 3. 알림 실패 비차단 확인

알림 로직 전체가 `try/catch` (`upload/route.ts:302-319`) 내부에 있으며, 응답 생성 (`route.ts:322-323`)은 그 밖에서 실행된다. `notified` 변수의 기본값은 `false` (`route.ts:277`)이므로, 어떤 예외가 발생해도 업로드 성공 응답(200)이 반환된다.

### 4. P1-20 해소 확인

`share/notify/route.ts:106`:
```typescript
const proto = sanitizeProto(request.headers.get('x-forwarded-proto'));
```

기존 코드 `request.headers.get('x-forwarded-proto') || 'https'`가 `sanitizeProto()` 호출로 교체되어 `javascript:` 등 위험 스키마 주입이 차단된다. backlog P1-20 해소.

### 5. 테스트 커버리지

`upload-notification.test.ts`에 21개 테스트가 포함되어 있다:

- sanitizeProto 경계값: 12건 (https, http, HTTP, HTTPS, Http, null, '', javascript:, ftp, data:, 공백 trim, 다중 값)
- Webhook 통합: 9건 (설정시 발송, 미설정시 skip, 실패시 200 유지, 부분 성공, 전부 실패, 전부 성공, URL 비노출, proto 반영, 위험 proto 차단)

---

## 스코프 드리프트 확인

| 점검 항목 | 결과 |
|-----------|------|
| `basic-ftp` 패키지 | package.json에 없음 -- PASS |
| 카카오 관련 코드/의존성 | 없음 -- PASS |
| `os.homedir()` 하드코딩 루트 | `env.ts:6`에 주석으로 "금지" 기술만, 실제 사용 없음 -- PASS |
| 실시간 재귀 fs 스캔 검색 | `search/route.ts` -- FTS5 색인 경유, `tokenize='trigram'` (`search-index.ts:89`) -- PASS |

---

## FAIL 상세

없음.

---

## 결론

Stage 5 백엔드 구현은 모든 체크리스트 항목을 충족한다. `sanitizeProto` 화이트리스트가 `/api/upload`와 `/api/share/notify` 양쪽에 적용되어 P1-20이 해소되었고, `Promise.allSettled`를 사용한 병렬 Webhook 발송이 정상 구현되었다. 알림 실패가 업로드 성공 응답을 차단하지 않으며, 기존 보안 불변식(1-8) 전항이 유지된다.
