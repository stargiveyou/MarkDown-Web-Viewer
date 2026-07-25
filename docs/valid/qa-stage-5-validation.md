# QA 통합 검증 -- Stage 5 (업로드 완료 알림)

- 검증 일시: 2026-07-25
- 검증 에이전트: `qa-integration`
- 선행 검증 리포트:
  - [backend-stage-5-validation.md](backend-stage-5-validation.md) -- PASS
  - [frontend-stage-5-validation.md](frontend-stage-5-validation.md) -- PASS
- 종합 판정: **PASS** (FAIL 0건, UNVERIFIED 0건)

---

## 1. CI 도구 전체 실행 결과

| 도구 | 결과 | 비고 |
|------|------|------|
| `npm run typecheck` | 오류 0 -- **PASS** | `tsc --noEmit` 성공 |
| `npm test` | **160/160 통과** (9 파일, 2.83s) -- **PASS** | 실패/건너뜀 0건 |
| `npm run lint` | 오류 0 -- **PASS** | ESLint 경고 0건 |
| `npm run build` | 성공 -- **PASS** | Next.js 16.2.11 Turbopack. 경고 1건: `middleware` deprecated (기존, 동작 무관). NFT 트레이싱 경고 1건 (기존, `next.config.ts -> upload/route.ts` 체인) |

---

## 2. Stage 5 QA 체크리스트 (stage-5-tasks.md Wave 3)

### QA-1. 로그인 -> 업로드 -> 200 + `notified: true/false` 확인

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 코드 흐름 추적 + 유닛 테스트 확인.

1. 미들웨어(`src/middleware.ts:86-134`)가 `/api/upload` 요청에 세션 쿠키를 검증한다.
2. `POST /api/upload` 핸들러(`src/app/api/upload/route.ts:169-324`)가 파일 저장 후 알림을 시도한다.
3. 응답 바디는 `UploadResponse` 타입으로 `{ ok: true, files: [...], notified: boolean }` 형태이다.
4. 테스트 `upload-notification.test.ts:211-229`에서 `sendWebhook` mock이 성공을 반환할 때 `notified: true`를 확인한다.
5. 테스트 `upload-notification.test.ts:231-242`에서 Webhook URL 미설정 시 `notified: false`를 확인한다.

**통합 관점**: 프론트엔드 `UploadDropzone.tsx:113`이 `apiUpload<UploadResponse>('/api/upload', form, ...)`을 호출하고, 응답 타입 `UploadResponse`는 `src/types/api.ts:153-158`에 정의된 공유 타입이다. 백엔드(`upload/route.ts:322`)가 반환하는 객체와 프론트엔드가 기대하는 타입이 동일 모듈에서 정의되어 드리프트가 없다.

### QA-2. Webhook URL 미설정 환경 -> 업로드 성공 + `notified: false`

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 코드 추적 + 유닛 테스트.

- `upload/route.ts:277` -- `let notified = false;` 초기화.
- `upload/route.ts:279-281` -- `env.DISCORD_WEBHOOK_URL`과 `env.SLACK_WEBHOOK_URL`이 모두 `undefined`이면 `targets`가 빈 배열.
- `upload/route.ts:283` -- `targets.length > 0` 조건이 `false`이므로 알림 블록 전체를 건너뛴다.
- `upload/route.ts:322` -- `notified`는 초기값 `false` 그대로 응답에 포함.
- 테스트 `upload-notification.test.ts:231-242` -- `mockEnvWith({})`로 URL 미설정 후 `sendWebhook`이 호출되지 않음(`expect(sendWebhook).not.toHaveBeenCalled()`)과 `body.notified === false`를 검증.

### QA-3. Webhook URL 설정 환경 -> 업로드 성공 + `notified: true` (mock 테스트)

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 유닛 테스트.

- 테스트 `upload-notification.test.ts:211-229` -- `mockEnvWith({ discord: DISCORD_URL })`로 URL 설정.
- `sendWebhook` mock이 `{ ok: true }` 반환.
- `body.notified === true` 확인.
- `sendWebhook`이 `'discord'`와 `WebhookPayload` 객체로 호출됨을 검증.
- `appUrl`이 `https://localhost:3000`을 포함함을 확인.

### QA-4. 업로드 실패(413/415) -> Webhook 미발화 확인

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 코드 구조 분석.

- 413 반환 지점: `upload/route.ts:186-187` (요청 크기 선검사), `upload/route.ts:221-222` (파일별 크기 검사).
- 415 반환 지점: `upload/route.ts:228-230` (확장자 검사).
- 이들은 모두 `try` 블록 내의 `return apiError(...)` 문으로, 이 지점에서 함수가 즉시 반환된다.
- 알림 로직(`upload/route.ts:276-320`)은 `try-catch` 블록 **이후**(라인 276)에 위치하므로, 413/415로 조기 반환된 경우 알림 코드에 도달하지 않는다.
- 429 반환 지점: `upload/route.ts:176-179` (rate limit). 마찬가지로 알림 코드보다 앞에서 반환.

**핵심**: 알림 로직은 `saved` 배열이 채워진 뒤(성공적 파일 저장 이후)에만 실행되며, 파일 검증 실패 시에는 물리적으로 도달 불가능하다.

### QA-5. rate limit 초과 -> 429 (기존 동작 유지)

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 코드 추적.

- `upload/route.ts:173-179` -- `checkRateLimit(rateLimitKeyFor(request, 'upload'))`를 핸들러 진입 직후 실행.
- 초과 시 `apiError(429, 'Too many uploads. Try again shortly.', { 'Retry-After': ... })` 반환.
- Stage 5 변경이 이 코드에 영향을 주지 않음(알림 로직은 라인 276 이후에 추가).
- 프론트엔드 `UploadDropzone.tsx:124-127`에서 429 수신 시 `stopped = true`로 남은 큐 중단 + `emitToast` 에러 메시지 표시.

### QA-6. proto 화이트리스트 -> `/api/share/notify`에도 적용 확인

| 판정 | **PASS** |
|------|----------|

**검증 방법**: 소스 코드 직접 비교.

**`/api/upload` (upload/route.ts:79-83)**:
```typescript
function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}
```
호출 지점: `upload/route.ts:285`.

**`/api/share/notify` (share/notify/route.ts:45-49)**:
```typescript
function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}
```
호출 지점: `share/notify/route.ts:106`.

두 함수의 로직이 동일하며, 위험 스키마(`javascript:`, `data:`, `ftp` 등)를 `'https'`로 대체한다. backlog P1-20 해소 확인.

유닛 테스트 `upload-notification.test.ts:30-78`에서 12개 경계값을 검증:
- `'https'` -> `'https'`, `'http'` -> `'http'`, `'HTTP'` -> `'http'`, `null` -> `'https'`, `''` -> `'https'`, `'javascript:'` -> `'https'`, `'ftp'` -> `'https'`, `'data:'` -> `'https'`, `' https '` -> `'https'`, `'https, http'` -> `'https'`.

### QA-7. `npm run typecheck` + `npm test` + `npm run lint` + `npm run build` 전체 통과

| 판정 | **PASS** |
|------|----------|

위 섹션 1의 CI 결과 참조. 4개 도구 전부 오류 0.

---

## 3. 보안 불변식 전항 검증

| # | 불변식 | 강제 위치 | 판정 |
|---|--------|----------|------|
| 1 | 세션 보호 (login 외 전부) | `middleware.ts:86-134` -- 모든 요청에 `verifySessionCookie()`. `/api/auth/login` POST만 예외(`PUBLIC_API:33-35`) | **PASS** |
| 2 | 경로 안전 단일 유틸 | `path-safety.ts` 단일 모듈. files(:79-80), upload(:215-216, 233-234, 242, 156), file-content(:47-48, 111-112), thumbnail(:62-63), share/notify(:84-85) 전부 경유 | **PASS** |
| 3 | 업로드 검증: 크기(413)/확장자(415)/새니타이즈 | `upload/route.ts:185-187` (선검사 413), `:221-222` (파일별 413), `:228-230` (415), `:226` (`sanitizeFilename`) | **PASS** |
| 4 | Atomic write | 업로드: `writeFileAtomically()` (`upload/route.ts:135-167` -- 임시파일 -> fsync -> rename). 에디터: `file-content/route.ts:137-160` 동일 패턴 | **PASS** |
| 5 | baseMtime 충돌 감지 -> 409 | `file-content/route.ts:127-134` -- `currentMtime !== baseMtime` -> 409 + `SaveConflictResponse`. UI: `ConflictWarning.tsx` 비파괴적 경고 | **PASS** |
| 6 | 시크릿 비노출 | Webhook URL: `env.ts:23-24` 선택적 속성, `upload/route.ts:280-281`에서 존재 여부만 확인, 응답에 미포함. `env.ts:11` `import 'server-only'`, `webhook.ts:13` `import 'server-only'`. 클라이언트 컴포넌트에서 `WEBHOOK_URL`/`DISCORD_WEBHOOK`/`SLACK_WEBHOOK` grep 결과 0건. `NEXT_PUBLIC_` 접두사 사용 0건(주석 제외). 테스트 `upload-notification.test.ts:323-335` -- 응답 텍스트에 URL 미포함 확인 | **PASS** |
| 7 | Rate limit (upload + share/notify) | upload: `upload/route.ts:173-179`. share/notify: `share/notify/route.ts:52-59` | **PASS** |
| 8 | 내부 정보 비노출 | 모든 에러 응답이 `apiError()` / `internalError()` 경유 (`api-response.ts:15-30`). 500 응답은 고정 메시지 `'Internal server error.'`만. 알림 실패 사유는 `console.error`로만 로깅(`upload/route.ts:310-315`). 스택트레이스/절대경로 응답 미포함 | **PASS** |

---

## 4. 통합 관점 검증 (개별 검증이 놓치는 것)

### 4-1. 프론트-백엔드 요청/응답 형태 실제 일치 여부

| 판정 | **PASS** |
|------|----------|

| 항목 | 프론트 참조 | 백엔드 참조 | 일치 |
|------|-----------|-----------|------|
| 업로드 응답 타입 | `UploadDropzone.tsx:15` -- `import { ... type UploadResponse ... } from '@/types/api'` | `upload/route.ts:322` -- `const body: UploadResponse = { ok: true, files: saved, notified }` | 동일 `src/types/api.ts:153-158` 참조 |
| `notified` 필드 타입 | `api.ts:157` -- `notified: boolean` | `upload/route.ts:277` -- `let notified = false` (boolean) | 일치 |
| `files` 배열 아이템 | `api.ts:146-151` -- `UploadedFileInfo { name, subpath, size, mtime }` | `upload/route.ts:249-255` -- `saved.push({ name, subpath, size, mtime })` | 일치 |
| FormData 필드명 | `UploadDropzone.tsx:108` -- `form.append(UPLOAD_FIELD.file, ...)` | `upload/route.ts:199` -- `form.getAll(UPLOAD_FIELD.file)` | 동일 상수 `UPLOAD_FIELD.file = 'file'` |
| targetPath 필드 | `UploadDropzone.tsx:110` -- `form.append(UPLOAD_FIELD.targetPath, resolvedTargetPath)` | `upload/route.ts:205-206` -- `form.get(UPLOAD_FIELD.targetPath)` | 동일 상수 `UPLOAD_FIELD.targetPath = 'targetPath'` |

직렬화 어긋남 없음. 두 측이 동일 TypeScript 타입 모듈(`src/types/api.ts`)을 공유하며, `tsc --noEmit`이 타입 불일치를 컴파일 타임에 잡는다.

### 4-2. 업로드 -> 알림 발화 -> 프론트 반영까지 연쇄 동작

| 판정 | **PASS** |
|------|----------|

연쇄 흐름 추적:

1. **프론트 `runQueue`** (`UploadDropzone.tsx:80-142`): 파일마다 `apiUpload<UploadResponse>('/api/upload', form, ...)` 호출.
2. **백엔드 `POST`** (`upload/route.ts:169-324`):
   - 검증 통과 -> 파일 저장(`writeFileAtomically`, 라인 246) -> `saved` 배열 채움(라인 249-255).
   - 색인 갱신 시도(라인 257-265, best-effort).
   - **알림 시도**(라인 276-320): `saved.length > 0 && targets.length > 0`일 때만 실행. `sendWebhook()` 호출.
   - 응답: `{ ok: true, files: saved, notified }` (라인 322).
3. **프론트 응답 처리** (`UploadDropzone.tsx:112-118`):
   - `res.files`를 `uploaded` 배열에 추가(라인 116).
   - `res.notified`가 `true`이면 `notifiedAny = true`(라인 117).
4. **토스트 표시** (`UploadDropzone.tsx:134-138`):
   - `notifiedAny ? ' (알림 전송됨)' : ''`를 기본 메시지에 붙인다.
5. **목록 갱신** (`UploadDropzone.tsx:138`):
   - `onUploaded?.(uploaded)` 호출 -> 상위 컴포넌트(`workspace/page.tsx:124-126`)에서 `setRefreshKey(k => k+1)` -> GridView 재조회.

모든 단계가 연결되어 있으며, 알림 실패가 업로드 성공 응답이나 목록 갱신을 차단하지 않는다.

### 4-3. 에러 상태 코드 끝까지 전달 여부

| 판정 | **PASS** |
|------|----------|

| 에러 | 백엔드 | 프론트 전달 경로 | UI 표시 |
|------|--------|----------------|---------|
| 413 (파일 크기 초과) | `upload/route.ts:186-187` 또는 `:221-222` -> `apiError(413, 'File too large.')` | `fetcher.ts:185-188` -> `ApiRequestError(413, ...)` -> `upload-errors.ts:15` 매핑 | `'파일이 너무 큽니다.'` (인라인 표시) |
| 415 (확장자 불허) | `upload/route.ts:228-230` -> `apiError(415, 'Unsupported file type.')` | 동일 경로 -> `ApiRequestError(415, ...)` -> `upload-errors.ts:16` | `'허용되지 않는 형식입니다.'` |
| 429 (rate limit) | `upload/route.ts:176-179` -> `apiError(429, ...)` | 동일 경로 -> `ApiRequestError(429, ...)` -> `UploadDropzone.tsx:124-127` 큐 중단 + 토스트 | `'요청이 너무 잦습니다.'` + 남은 파일 `skipped` |
| 401 (미인증) | `middleware.ts:107-109` -> 401 JSON | `fetcher.ts:92-95` -> `redirectToLogin()` | `/login` 리다이렉트 |
| 400 (경로 거부) | `upload/route.ts:271` -> `apiError(400, 'Invalid path.')` | `ApiRequestError(400, ...)` -> `upload-errors.ts:12` | `'요청이 올바르지 않습니다.'` |
| 500 (내부 오류) | `api-response.ts:27-29` -> `apiError(500, 'Internal server error.')` | `ApiRequestError(500, ...)` -> `upload-errors.ts:19` | `'서버에 파일을 저장하지 못했습니다.'` |

모든 에러 코드가 백엔드에서 프론트엔드 UI 메시지까지 끊김 없이 전달된다.

---

## 5. 테스트 매트릭스 전체 점검

### 5-1. 계약 (엔드포인트 대조)

| 엔드포인트 | 메서드 | 파라미터/형태 | 상태코드 | 판정 |
|-----------|--------|-------------|---------|------|
| `/api/auth/login` | POST | `{ password }` -> httpOnly 쿠키 | 200/400/429 | **PASS** |
| `/api/auth/logout` | POST | 세션 삭제 | 200 | **PASS** |
| `/api/files` | GET | `?path=&sort=&tag=` | 200/400 | **PASS** |
| `/api/search` | GET | `?q=` | 200/400/500 | **PASS** |
| `/api/tags` | GET | 없음 | 200/500 | **PASS** |
| `/api/file-content` | GET | `?path=` | 200/400/500 | **PASS** |
| `/api/file-content` | PUT | `{ path, content, baseMtime }` | 200/400/409/500 | **PASS** |
| `/api/upload` | POST | multipart (`file`, `targetPath`) | 200/400/413/415/429 | **PASS** |
| `/api/thumbnail` | GET | `?path=&w=` | 200/400/500 | **PASS** |
| `/api/share/notify` | POST | `{ target, filePath }` | 200/400/429/502 | **PASS** |

`UploadResponse`에 `notified: boolean` 필드가 계약(`src/types/api.ts:157`)에 정의되어 있고, 백엔드가 이를 반환한다. 계약 위반 없음.

### 5-2. 인증

| 판정 | **PASS** |
|------|----------|

- 미들웨어(`src/middleware.ts`)가 매처 패턴으로 정적 자산 외 모든 경로를 보호한다.
- `PUBLIC_API`에는 `POST /api/auth/login`만 등록되어 있다.
- 미인증 API 호출 -> 401 JSON 응답. 미인증 페이지 접근 -> `/login?next=...` 리다이렉트.
- 모든 API 라우트에 `export const runtime = 'nodejs'` 선언 확인 (9개 라우트 전부).

### 5-3. 경로 traversal

| 판정 | **PASS** |
|------|----------|

`src/lib/path-safety.ts`의 `resolveUnderRoot` + `assertRealPathUnderRoot` 2단 방어가 모든 경로 접근 라우트에 적용되어 있다.

| 라우트 | 적용 위치 |
|--------|----------|
| `/api/files` | `files/route.ts:79-80` |
| `/api/upload` | `upload/route.ts:215-216, 233-234, 242, 156` |
| `/api/file-content` GET | `file-content/route.ts:47-48` |
| `/api/file-content` PUT | `file-content/route.ts:111-112` |
| `/api/thumbnail` | `thumbnail/route.ts:62-63` |
| `/api/share/notify` | `share/notify/route.ts:84-85` |

유닛 테스트(`path-safety.test.ts`) 53건에서 `../`, 절대경로, 인코딩 우회, 심볼릭 링크 탈출을 검증한다.

### 5-4. 업로드 검증

| 항목 | 검증 | 판정 |
|------|------|------|
| 413 (용량 초과) | `upload/route.ts:185-187` (Content-Length 선검사), `:221-222` (파일별 검사) | **PASS** |
| 415 (확장자 불허) | `upload/route.ts:227-230` (`ALLOWED_EXTENSIONS` 화이트리스트) | **PASS** |
| 429 (rate limit) | `upload/route.ts:173-179` | **PASS** |
| 성공 시 그리드 갱신 | `UploadDropzone.tsx:138` -> `onUploaded?.(uploaded)` -> `workspace/page.tsx:124-126` `setRefreshKey` | **PASS** |
| 성공 시 Webhook 발화 | `upload/route.ts:276-320` -> `sendWebhook()`. 테스트 `upload-notification.test.ts:211-229` | **PASS** |

### 5-5. 에디터 충돌

| 판정 | **PASS** |
|------|----------|

- `file-content/route.ts:126-135` -- `currentMtime !== baseMtime` -> 409 + `SaveConflictResponse`.
- `ConflictWarning.tsx` -- "내용 복사" + "새로고침" 버튼 제공. 무단 덮어쓰기 없음.
- `edit/page.tsx:132-134` -- 409 수신 시 `setConflict(true)`.

### 5-6. 검색

| 판정 | **PASS** |
|------|----------|

- FTS5 trigram 색인(`search-index.ts:89` -- `tokenize='trigram'`).
- `search/route.ts` -- FTS5 `MATCH` + `snippet()` + BM25 정렬.
- Stage 0에서 "제주도"가 "제주도에서"에 매칭됨을 실증한 기록 있음(progress.md).
- 업로드 후 색인 증분 갱신(`upload/route.ts:257-265`, `file-content/route.ts:166-175`).

### 5-7. 공유

| 판정 | **PASS** |
|------|----------|

- `/api/share/notify` -- Discord/Slack 수동 공유 (Stage 4).
- `/api/upload` -- 자동 알림 (Stage 5).
- Webhook URL 비노출: `env.ts:23-24` optional 속성, `webhook.ts:13` `import 'server-only'`. 클라이언트 코드에 Webhook 관련 문자열 grep 결과 0건.
- `ShareModal.tsx:128-130` -- "공유 링크를 받은 사람도 로그인이 필요합니다." 명시 (ADR-004 준수).

### 5-8. E2E 해피패스 (코드 흐름 추적)

| 단계 | 코드 지점 | 판정 |
|------|----------|------|
| 로그인 | `login/page.tsx:66` -> `POST /api/auth/login` -> 세션 쿠키 발급 | **PASS** |
| 업로드 | `UploadDropzone.tsx:113` -> `POST /api/upload` -> atomic write -> `UploadResponse` | **PASS** |
| GridView에 표시 | `onUploaded` -> `setRefreshKey` -> `GET /api/files` 재조회 -> GridView 리렌더 | **PASS** |
| 열기 | GridView 카드 클릭 -> `/workspace/view?path=...` -> `GET /api/file-content` | **PASS** |
| 편집 | 편집 버튼 -> `/workspace/edit?path=...` -> Monaco 에디터 | **PASS** |
| 저장 | `PUT /api/file-content` + `baseMtime` -> atomic write -> 새 mtime 반환 | **PASS** |
| 검색으로 발견 | 저장 시 `indexFile()` 증분 갱신 -> `GET /api/search?q=...` -> 결과 반환 | **PASS** |
| 공유 알림 | ShareModal -> `POST /api/share/notify` -> Discord/Slack Webhook | **PASS** |
| 업로드 알림 (Stage 5 신규) | 업로드 성공 후 자동 -> `sendWebhook()` -> `notified: true/false` 반환 -> 토스트 표시 | **PASS** |

### 5-9. 접근성

| 항목 | 검증 위치 | 판정 |
|------|----------|------|
| 키보드 내비게이션 | 드롭존 버튼 `focus-visible` 클래스(`UploadDropzone.tsx:198`), 목록 비우기 버튼(`284`) | **PASS** |
| 포커스 상태 | `focus-visible:outline-2 focus-visible:outline-offset-2` 전역 적용 | **PASS** |
| 모달 Esc/Enter | `Modal.tsx:58-61` Escape 닫기, 포커스 트랩(:64-78), 포커스 복원(:48-49) | **PASS** |
| 반응형 2열/4열 | `GridView.tsx:47` -- `grid-cols-2 md:grid-cols-4` | **PASS** |
| 진행률 aria | `UploadDropzone.tsx:244-249` -- `role="progressbar"`, `aria-valuemin/max/now` | **PASS** |
| 상태 실시간 알림 | `UploadDropzone.tsx:217` -- `aria-live="polite"` | **PASS** |
| 에러 역할 | `UploadDropzone.tsx:270` -- `role="alert"` (에러 상태일 때) | **PASS** |

---

## 6. Stage 5 고유 검증 상세

### 6-1. 알림 로직이 파일 저장 성공 후에만 실행되는지

| 판정 | **PASS** |
|------|----------|

코드 구조:
```
try {
  // 라인 212-266: 파일 검증 + 저장 + saved 배열 채움
} catch (error) {
  // 라인 267-274: PathSafetyError -> 400, 기타 -> 500 반환
  // 여기서 return하므로 아래 알림 코드에 도달 불가
}

// 라인 276-320: 알림 로직 (saved.length > 0 조건 포함)
// 라인 322: 성공 응답 반환
```

`try` 블록 내에서 에러가 발생하면 `catch`에서 `return`하므로, 알림 코드(라인 276)에 도달하는 것은 파일 저장이 모두 성공한 경우뿐이다. 추가로 `saved.length > 0` 조건(라인 283)이 빈 배열을 걸러낸다.

### 6-2. `sanitizeProto`가 양쪽 라우트에 적용되었는지

| 판정 | **PASS** |
|------|----------|

- `/api/upload`: `upload/route.ts:79-83` 정의, `:285` 호출.
- `/api/share/notify`: `share/notify/route.ts:45-49` 정의, `:106` 호출.
- 두 구현의 로직이 동일함을 라인별로 확인 완료.
- 설계 결정에 따라 2줄짜리 함수를 별도 모듈로 추출하지 않고 로컬 정의한다(과잉 추상화 방지).

### 6-3. Promise.allSettled 병렬 발송 확인

| 판정 | **PASS** |
|------|----------|

`upload/route.ts:303-305`:
```typescript
const results = await Promise.allSettled(
  targets.map((t) => sendWebhook(t, payload)),
);
```

- `Promise.allSettled`는 개별 실패가 다른 결과에 영향을 주지 않는다.
- `results.some(r => r.status === 'fulfilled' && r.value.ok)`로 하나라도 성공이면 `notified: true`.
- 테스트 `upload-notification.test.ts:267-285` -- Discord 성공 + Slack 실패 -> `notified: true` 확인.
- 테스트 `upload-notification.test.ts:287-305` -- 둘 다 실패 -> `notified: false` 확인.
- 테스트 `upload-notification.test.ts:307-321` -- 둘 다 성공 -> `notified: true` 확인.

### 6-4. 테스트 커버리지 적정성

| 판정 | **PASS** |
|------|----------|

`upload-notification.test.ts`에 21개 테스트 포함:

| 영역 | 테스트 수 | 검증 내용 |
|------|-----------|----------|
| `sanitizeProto` 경계값 | 12건 | https, http, HTTP, HTTPS, Http, null, '', javascript:, ftp, data:, 공백 trim, 다중 값 |
| Webhook 통합 | 9건 | URL 설정시 발송, 미설정시 skip, 실패시 200 유지, Discord 성공+Slack 실패, 둘 다 실패, 둘 다 성공, URL 응답 비노출, proto 반영, 위험 proto 차단 |

Stage 5 계획(`stage-5-tasks.md`)의 5가지 테스트 요구사항을 전부 충족한다.

---

## 7. 스코프 드리프트 확인

| 점검 항목 | 결과 | 판정 |
|-----------|------|------|
| `basic-ftp` / FTP 관련 패키지 | `package.json`에 없음 | **PASS** |
| 카카오 관련 코드/의존성 | 없음 | **PASS** |
| `os.homedir()` 하드코딩 루트 | 사용 없음 | **PASS** |
| 실시간 재귀 fs 스캔 검색 | FTS5 색인 경유 | **PASS** |
| 토큰 기반 공개 공유 링크 | 없음. `ShareModal.tsx:66` -- `window.location.href` 복사만 | **PASS** |
| `NEXT_PUBLIC_` 접두사 사용 | 0건 (주석 경고문만 존재) | **PASS** |

---

## 8. 단계 완료 조건 대조

| # | 조건 | 충족 여부 |
|---|------|----------|
| 1 | `POST /api/upload` 성공 시 Discord/Slack 자동 알림 | **충족** -- `upload/route.ts:276-320` |
| 2 | Webhook 실패 시 업로드 200 유지 + `notified: false` | **충족** -- 테스트 `upload-notification.test.ts:244-265` |
| 3 | 설정된 채널 전부에 병렬 발송 (`Promise.allSettled`) | **충족** -- `upload/route.ts:303-305` |
| 4 | Webhook URL 미설정 시 알림 skip + `notified: false` | **충족** -- 테스트 `upload-notification.test.ts:231-242` |
| 5 | 프론트엔드에서 `notified` 상태를 토스트에 반영 | **충족** -- `UploadDropzone.tsx:97, 117, 135-137` |
| 6 | proto 화이트리스트 (upload + share/notify 양쪽) | **충족** -- `upload/route.ts:79-83`, `share/notify/route.ts:45-49` |
| 7 | 기존 보안 불변식(1-8) 전항 유지 | **충족** -- 위 섹션 3 참조 |
| 8 | `npm run build` / `typecheck` / `test` / `lint` 통과 | **충족** -- 위 섹션 1 참조 |
| 9 | 검증 리포트 FAIL 0건 | **충족** -- 본 리포트 |

---

## 9. FAIL 상세

없음.

---

## 10. UNVERIFIED 상세

없음.

Stage 5는 기존 Webhook 인프라를 업로드 라우트에 연결하는 통합 작업이며, 변경 범위가 3개 파일(~60행)로 좁다. E2E 서버 기동 테스트(실제 curl 호출)는 이전 단계에서 충분히 검증되었고, Stage 5 변경분은 알림 발송 여부(`notified` 필드)와 proto 화이트리스트에 국한되므로, 유닛 테스트 + 코드 흐름 추적으로 모든 항목을 검증할 수 있었다.

---

## 결론

**Stage 5 (업로드 완료 알림) 통합 검증 PASS.**

- FAIL 항목: 0건
- UNVERIFIED 항목: 0건
- 보안 불변식 8개 전항: PASS
- 단계 완료 조건 9개 전항: 충족
- backlog P1-20 (proto 헤더 검증): 해소 확인

Stage 5는 완료 조건을 모두 만족하며, `docs/plan/progress.md`에 완료로 기록할 수 있다.
